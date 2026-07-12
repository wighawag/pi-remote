import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import type {WhereverState} from '../src/types.js';
import {makeWSFactory} from './harness.js';

// When a running tool is ABORTED (e.g. the web "abort" button kills it mid-run),
// pi surfaces it as an errored result with a trailing "...aborted" status. That
// is NOT a tool failure, so the UI must render a neutral "interrupted" state,
// not a red error. A tool that genuinely completed (or genuinely failed) before
// the abort keeps its real success/error state.

function setup(ws: ReturnType<typeof makeWSFactory>, isStreaming = true) {
	const client = new WhereverClient({
		host: 'localhost',
		port: 1234,
		secure: false,
		WebSocketCtor: ws.ctor,
	});
	client.connect();
	ws.last().open();
	client.joinSession('/tmp/project/session.jsonl');
	ws.last().receive({
		type: 'session_created',
		sessionId: 'sid-1',
		sessionFile: '/tmp/project/session.jsonl',
		cwd: '/tmp/project',
		model: 'fake:model',
		isStreaming,
	});
	return client;
}

describe('aborted tool call rendering', () => {
	let ws: ReturnType<typeof makeWSFactory>;
	let client: WhereverClient;
	const state = () => get<WhereverState>(client.stateStore);

	beforeEach(() => {
		vi.useFakeTimers();
		ws = makeWSFactory();
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	it('live tool_end: an aborted result is interrupted, not an error', () => {
		client = setup(ws);
		ws.last().receive({type: 'tool_start', sessionId: 'sid-1', toolName: 'bash', args: {command: 'sleep 8'}});
		ws.last().receive({
			type: 'tool_end',
			sessionId: 'sid-1',
			toolName: 'bash',
			isError: true,
			result: 'Command aborted',
		});
		const tool = state().messages.find((m) => m.role === 'tool')!;
		expect(tool.interrupted).toBe(true);
		expect(tool.isError).toBe(false);
	});

	it('live tool_end: a genuine error stays an error', () => {
		client = setup(ws);
		ws.last().receive({type: 'tool_start', sessionId: 'sid-1', toolName: 'bash', args: {command: 'false'}});
		ws.last().receive({
			type: 'tool_end',
			sessionId: 'sid-1',
			toolName: 'bash',
			isError: true,
			result: 'boom\n\nCommand exited with code 1',
		});
		const tool = state().messages.find((m) => m.role === 'tool')!;
		expect(tool.isError).toBe(true);
		expect(tool.interrupted).toBeFalsy();
	});

	it('live tool_end: a genuine success stays a success', () => {
		client = setup(ws);
		ws.last().receive({type: 'tool_start', sessionId: 'sid-1', toolName: 'bash', args: {command: 'echo quick'}});
		ws.last().receive({
			type: 'tool_end',
			sessionId: 'sid-1',
			toolName: 'bash',
			isError: false,
			result: 'quick',
		});
		const tool = state().messages.find((m) => m.role === 'tool')!;
		expect(tool.isError).toBe(false);
		expect(tool.interrupted).toBeFalsy();
	});

	it('history: two parallel tools, one completed (green) and one aborted (interrupted)', () => {
		client = setup(ws, false);
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{role: 'user', content: 'go', timestamp: 1_000},
				{role: 'tool_call', content: '{"command":"echo quick"}', timestamp: 2_000, toolName: 'bash'},
				{role: 'tool_call', content: '{"command":"sleep 8"}', timestamp: 2_001, toolName: 'bash'},
				{role: 'tool_result', content: 'quick', timestamp: 3_000, toolName: 'bash', isError: false},
				{role: 'tool_result', content: 'Command aborted', timestamp: 3_100, toolName: 'bash', isError: true},
			],
			totalCount: 5,
			offset: 0,
		});
		const tools = state().messages.filter((m) => m.role === 'tool');
		expect(tools.length).toBe(2);
		// FIFO pairing by tool name: first result -> first call (echo, success),
		// second result -> second call (sleep, aborted -> interrupted).
		const succeeded = tools.find((t) => t.toolOutput === 'quick')!;
		const aborted = tools.find((t) => (t.toolOutput || '').includes('aborted'))!;
		expect(succeeded.isError).toBeFalsy();
		expect(succeeded.interrupted).toBeFalsy();
		expect(aborted.isError).toBe(false);
		expect(aborted.interrupted).toBe(true);
	});

	it('two parallel same-named tools both aborted: BOTH interrupted (no stray green)', () => {
		client = setup(ws);
		// Two parallel bash calls start (same tool name).
		ws.last().receive({type: 'tool_start', sessionId: 'sid-1', toolName: 'bash', args: {command: 'sleep 8'}});
		ws.last().receive({type: 'tool_start', sessionId: 'sid-1', toolName: 'bash', args: {command: 'sleep 8'}});
		// Both settle as aborted. FIFO matching must route each tool_end to a
		// DISTINCT streaming message, so neither is left to be finalized green.
		ws.last().receive({type: 'tool_end', sessionId: 'sid-1', toolName: 'bash', isError: true, result: 'Command aborted'});
		ws.last().receive({type: 'tool_end', sessionId: 'sid-1', toolName: 'bash', isError: true, result: 'Command aborted'});

		const tools = state().messages.filter((m) => m.role === 'tool');
		expect(tools.length).toBe(2);
		for (const t of tools) {
			expect(t.isStreaming).toBe(false);
			expect(t.interrupted).toBe(true);
			expect(t.isError).toBe(false);
		}
	});

	it('a tool still streaming at agent_end is interrupted, not a green success', () => {
		client = setup(ws);
		vi.useFakeTimers();
		ws.last().receive({type: 'tool_start', sessionId: 'sid-1', toolName: 'bash', args: {command: 'sleep 8'}});
		// The turn ends WITHOUT a tool_end for this tool (e.g. aborted, or the
		// result frame was lost). agent_end finalizes after a 300ms debounce.
		ws.last().receive({type: 'agent_end', sessionId: 'sid-1'});
		vi.advanceTimersByTime(350);

		const tool = state().messages.find((m) => m.role === 'tool')!;
		expect(tool.isStreaming).toBe(false);
		expect(tool.interrupted).toBe(true);
		expect(tool.isError).toBeFalsy();
	});

	it('an "aborted" substring in normal output is NOT treated as an abort', () => {
		client = setup(ws);
		ws.last().receive({type: 'tool_start', sessionId: 'sid-1', toolName: 'bash', args: {command: 'echo'}});
		ws.last().receive({
			type: 'tool_end',
			sessionId: 'sid-1',
			toolName: 'bash',
			isError: true,
			result: 'the build was aborted by the linter\n\nCommand exited with code 2',
		});
		const tool = state().messages.find((m) => m.role === 'tool')!;
		// Trailing status line is "Command exited with code 2", so it is a real error.
		expect(tool.isError).toBe(true);
		expect(tool.interrupted).toBeFalsy();
	});
});

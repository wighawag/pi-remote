import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import type {WhereverState} from '../src/types.js';
import {makeWSFactory} from './harness.js';

// A tool call with NO matching tool_result in loaded history is ambiguous:
//   - if the session is streaming (live tail), the tool is STILL RUNNING;
//   - otherwise the call is FROZEN with no result, i.e. it was interrupted
//     (e.g. a CLI took over the session and killed the running tool).
// The frozen case must be flagged `interrupted` so the UI shows a neutral
// "no result" state instead of a bogus green success tick.

function makeClient(ws: ReturnType<typeof makeWSFactory>) {
	const client = new WhereverClient({
		host: 'localhost',
		port: 1234,
		secure: false,
		WebSocketCtor: ws.ctor,
	});
	client.connect();
	ws.last().open();
	client.joinSession('/tmp/project/session.jsonl');
	return client;
}

describe('interrupted (result-less) tool call from loaded history', () => {
	let ws: ReturnType<typeof makeWSFactory>;
	let client: WhereverClient;
	const state = () => get<WhereverState>(client.stateStore);

	beforeEach(() => {
		vi.useFakeTimers();
		ws = makeWSFactory();
		client = makeClient(ws);
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	it('marks a dangling tool_call as interrupted when the session is NOT streaming', () => {
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/project/session.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
			isStreaming: false,
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{role: 'user', content: 'go', timestamp: 1_000},
				{
					role: 'tool_call',
					content: '{"command":"sleep 10"}',
					timestamp: 10_000,
					toolName: 'bash',
				},
			],
			totalCount: 2,
			offset: 0,
		});

		const tool = state().messages.find((m) => m.role === 'tool')!;
		expect(tool.interrupted).toBe(true);
		expect(tool.isStreaming).toBe(false);
		expect(tool.isError).toBeFalsy();
		// No result: outcome unknown, so no end timestamp either.
		expect(tool.endedAt).toBeUndefined();
	});

	it('does NOT mark it interrupted when the session IS streaming (still running)', () => {
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/project/session.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
			isStreaming: true,
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{role: 'user', content: 'go', timestamp: 1_000},
				{
					role: 'tool_call',
					content: '{"command":"sleep 10"}',
					timestamp: 10_000,
					toolName: 'bash',
				},
			],
			totalCount: 2,
			offset: 0,
		});

		const tool = state().messages.find((m) => m.role === 'tool')!;
		expect(tool.interrupted).toBeFalsy();
		expect(tool.isStreaming).toBe(true);
	});

	it('renders a dangling mid-conversation tool_call IN PLACE, not hoisted to the end', () => {
		// Recoverability case: an interrupted long-running bash call, superseded by
		// a new user turn and later assistant replies. The dangling call must stay
		// where it was issued (between "start it" and "never mind"), NOT be moved
		// below the final reply as a phantom trailing "aborted tool call".
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/project/session.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
			isStreaming: false,
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{role: 'user', content: 'start it', timestamp: 1_000},
				{
					role: 'tool_call',
					content: '{"command":"sleep 300"}',
					timestamp: 2_000,
					toolName: 'bash',
				},
				{role: 'user', content: 'never mind', timestamp: 3_000},
				{role: 'assistant', content: 'ok, stopped', timestamp: 4_000},
				{role: 'user', content: 'hello', timestamp: 5_000},
				{role: 'assistant', content: 'hi there', timestamp: 6_000},
			],
			totalCount: 6,
			offset: 0,
		});

		const roles = state().messages.map((m) => m.role);
		// The tool sits at index 1 (right after the first user message), not last.
		expect(roles).toEqual([
			'user',
			'tool',
			'user',
			'assistant',
			'user',
			'assistant',
		]);
		const tool = state().messages[1];
		expect(tool.interrupted).toBe(true);
		expect(tool.isStreaming).toBe(false);
		// The final message is the assistant reply, NOT a trailing tool call.
		expect(state().messages[state().messages.length - 1].role).toBe(
			'assistant',
		);
	});

	it('with multiple dangling calls, only the newest streams on the live tail; earlier ones are interrupted in place', () => {
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/project/session.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
			isStreaming: true,
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{
					role: 'tool_call',
					content: '{"command":"sleep 1"}',
					timestamp: 1_000,
					toolName: 'bash',
				},
				{role: 'user', content: 'again', timestamp: 2_000},
				{
					role: 'tool_call',
					content: '{"command":"sleep 2"}',
					timestamp: 3_000,
					toolName: 'bash',
				},
			],
			totalCount: 3,
			offset: 0,
		});

		const tools = state().messages.filter((m) => m.role === 'tool');
		expect(tools).toHaveLength(2);
		// First (older) dangling call: interrupted, not streaming.
		expect(tools[0].interrupted).toBe(true);
		expect(tools[0].isStreaming).toBe(false);
		// Newest dangling call: still running on the live tail.
		expect(tools[1].interrupted).toBeFalsy();
		expect(tools[1].isStreaming).toBe(true);
	});

	it('pairs a tool_result to its exact call by id, leaving the correct earlier same-named call dangling', () => {
		// Two bash calls issued back-to-back; only the SECOND gets a result. With
		// tool-call ids the result must resolve call #2 (by id), leaving call #1
		// dangling/interrupted. Name-FIFO alone would wrongly resolve call #1 and
		// leave call #2 dangling.
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/project/session.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
			isStreaming: false,
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{
					role: 'tool_call',
					content: '{"command":"sleep 300"}',
					timestamp: 1_000,
					toolName: 'bash',
					toolCallId: 'call-A',
				},
				{
					role: 'tool_call',
					content: '{"command":"echo hi"}',
					timestamp: 1_100,
					toolName: 'bash',
					toolCallId: 'call-B',
				},
				{
					role: 'tool_result',
					content: 'hi',
					timestamp: 1_200,
					toolName: 'bash',
					toolCallId: 'call-B',
					isError: false,
				},
			],
			totalCount: 3,
			offset: 0,
		});

		const tools = state().messages.filter((m) => m.role === 'tool');
		expect(tools).toHaveLength(2);
		// Call A (sleep 300) is the dangling/interrupted one.
		const callA = tools.find((t) => t.toolArgs?.includes('sleep 300'))!;
		const callB = tools.find((t) => t.toolArgs?.includes('echo hi'))!;
		expect(callA.interrupted).toBe(true);
		expect(callA.toolOutput).toBe('');
		// Call B got its result.
		expect(callB.interrupted).toBeFalsy();
		expect(callB.toolOutput).toBe('hi');
		// Order in the transcript is preserved (A before B).
		expect(state().messages.indexOf(callA)).toBeLessThan(
			state().messages.indexOf(callB),
		);
	});

	it('a matched tool_call + tool_result is NOT interrupted', () => {
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/project/session.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
			isStreaming: false,
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{
					role: 'tool_call',
					content: '{"command":"ls"}',
					timestamp: 10_000,
					toolName: 'bash',
				},
				{
					role: 'tool_result',
					content: 'a\nb',
					timestamp: 11_000,
					toolName: 'bash',
					isError: false,
				},
			],
			totalCount: 2,
			offset: 0,
		});

		const tool = state().messages.find((m) => m.role === 'tool')!;
		expect(tool.interrupted).toBeFalsy();
		expect(tool.isError).toBe(false);
	});
});

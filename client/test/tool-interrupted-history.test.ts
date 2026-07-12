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

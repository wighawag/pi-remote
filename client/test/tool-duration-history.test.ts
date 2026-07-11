import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import type {WhereverState} from '../src/types.js';
import {makeWSFactory} from './harness.js';

// A tool call reconstructed from LOADED history must carry the same duration as
// a live-streamed one, so "Took N.Ns" survives a reload. The server sends the
// tool_call and tool_result as separate HistoryMessages, each with its own
// timestamp; the client pairs them and computes startedAt/endedAt.

describe('tool duration from loaded history', () => {
	let ws: ReturnType<typeof makeWSFactory>;
	let client: WhereverClient;
	const state = () => get<WhereverState>(client.stateStore);

	beforeEach(() => {
		vi.useFakeTimers();
		ws = makeWSFactory();
		client = new WhereverClient({
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
			isStreaming: false,
		});
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	it('pairs a tool_call + tool_result into a duration', () => {
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{role: 'user', content: 'go', timestamp: 1_000},
				{
					role: 'tool_call',
					content: '{"command":"ls"}',
					timestamp: 10_000,
					toolName: 'bash',
				},
				{
					role: 'tool_result',
					content: 'a\nb',
					timestamp: 13_400,
					toolName: 'bash',
					isError: false,
				},
			],
			totalCount: 3,
			offset: 0,
		});

		const tool = state().messages.find((m) => m.role === 'tool')!;
		expect(tool.startedAt).toBe(10_000);
		expect(tool.endedAt).toBe(13_400);
		expect(((tool.endedAt! - tool.startedAt!) / 1000).toFixed(1)).toBe('3.4');
	});

	it('leaves duration unset for an unmatched (result-less) tool_call', () => {
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{
					role: 'tool_call',
					content: '{}',
					timestamp: 10_000,
					toolName: 'bash',
				},
			],
			totalCount: 1,
			offset: 0,
		});
		const tool = state().messages.find((m) => m.role === 'tool')!;
		expect(tool.startedAt).toBe(10_000);
		expect(tool.endedAt).toBeUndefined();
	});
});

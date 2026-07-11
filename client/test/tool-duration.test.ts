import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import type {WhereverState} from '../src/types.js';

// The tool-call timing the UI needs to show "Elapsed N.Ns" (running) and
// "Took N.Ns" (done), like the pi CLI: tool_start stamps startedAt, tool_end
// stamps endedAt, and a turn that ends without a tool_end freezes the running
// tool's endedAt so its duration stops ticking.

function makeClient() {
	const c = new WhereverClient({host: 'x', port: 1, secure: false});
	const feed = (msg: unknown) =>
		(c as unknown as {handleMessage(m: unknown): void}).handleMessage(msg);
	const state = () => get<WhereverState>(c.stateStore);
	const lastTool = () =>
		[...state().messages].reverse().find((m) => m.role === 'tool');
	return {feed, state, lastTool};
}

const SESSION = 'sess-1';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('tool call timing', () => {
	it('stamps startedAt on tool_start and endedAt on tool_end', () => {
		const {feed, lastTool} = makeClient();
		feed({type: 'agent_start', sessionId: SESSION});

		vi.setSystemTime(1_000);
		feed({
			type: 'tool_start',
			sessionId: SESSION,
			toolName: 'bash',
			args: {command: 'ls'},
		});
		const running = lastTool()!;
		expect(running.startedAt).toBe(1_000);
		expect(running.endedAt).toBeUndefined();
		expect(running.isStreaming).toBe(true);

		vi.setSystemTime(3_500);
		feed({type: 'tool_end', sessionId: SESSION, toolName: 'bash', result: 'a\nb'});
		const done = lastTool()!;
		expect(done.startedAt).toBe(1_000);
		expect(done.endedAt).toBe(3_500);
		expect(done.isStreaming).toBe(false);
		// 2.5s took.
		expect(((done.endedAt! - done.startedAt!) / 1000).toFixed(1)).toBe('2.5');
	});

	it('freezes a running tool endedAt when the turn ends without tool_end', () => {
		const {feed, lastTool} = makeClient();
		feed({type: 'agent_start', sessionId: SESSION});
		vi.setSystemTime(1_000);
		feed({type: 'tool_start', sessionId: SESSION, toolName: 'bash', args: {}});
		expect(lastTool()!.endedAt).toBeUndefined();

		// Turn ends between steps with no tool_end for the running tool.
		vi.setSystemTime(2_000);
		feed({type: 'agent_end', sessionId: SESSION});
		// The 300ms agent_end debounce fires; fake time advances to 2_300 and the
		// callback stamps endedAt = Date.now() at that point.
		vi.advanceTimersByTime(300);

		const frozen = lastTool()!;
		expect(frozen.isStreaming).toBe(false);
		expect(frozen.endedAt).toBe(2_300);
	});

	it('freezes a running tool endedAt on abort', () => {
		const {feed, lastTool} = makeClient();
		feed({type: 'agent_start', sessionId: SESSION});
		vi.setSystemTime(1_000);
		feed({type: 'tool_start', sessionId: SESSION, toolName: 'bash', args: {}});
		vi.setSystemTime(5_000);
		feed({type: 'aborted', sessionId: SESSION});
		const frozen = lastTool()!;
		expect(frozen.isStreaming).toBe(false);
		expect(frozen.endedAt).toBe(5_000);
	});
});

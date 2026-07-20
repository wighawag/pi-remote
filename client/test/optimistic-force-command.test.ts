import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import type {WhereverState} from '../src/types.js';
import {makeWSFactory} from './harness.js';

// A web `!command` / `!!command` (force command) is intercepted by the server
// and run as a bash tool call; it is NOT echoed back as a user message. Without
// any local feedback the tool bubble only appeared after a full server
// round-trip (client -> server -> tool_start -> client), so the command did not
// show up instantly. The client now renders an OPTIMISTIC bash tool bubble at
// send time and RECONCILES the server's real tool_start onto it (no duplicate).

function setup(ws: ReturnType<typeof makeWSFactory>, isStreaming = false) {
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

describe('optimistic force-command tool bubble', () => {
	let ws: ReturnType<typeof makeWSFactory>;
	let client: WhereverClient;
	const state = () => get<WhereverState>(client.stateStore);
	const tools = () => state().messages.filter((m) => m.role === 'tool');

	beforeEach(() => {
		vi.useFakeTimers();
		ws = makeWSFactory();
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	it('renders an optimistic bash bubble instantly on a !command (no user echo)', () => {
		client = setup(ws);
		client.sendMessage('!ls -la');

		const t = tools();
		expect(t.length).toBe(1);
		expect(t[0].toolName).toBe('bash');
		expect(t[0].forceCommand).toBe(true);
		expect(t[0].optimistic).toBe(true);
		expect(t[0].isStreaming).toBe(true);
		expect(t[0].content).toBe('$ bash command="ls -la"');
		// It is NOT a user message (no user echo, no delivery tracking).
		expect(state().messages.some((m) => m.role === 'user')).toBe(false);
	});

	it('strips the !! prefix for an excluded-from-context command', () => {
		client = setup(ws);
		client.sendMessage('!!git status');
		const t = tools();
		expect(t.length).toBe(1);
		expect(t[0].content).toBe('$ bash command="git status"');
		expect(t[0].optimistic).toBe(true);
	});

	it('reconciles the server tool_start onto the optimistic bubble (no duplicate)', () => {
		client = setup(ws);
		client.sendMessage('!ls -la');
		expect(tools().length).toBe(1);

		// The server runs it and emits the real tool_start (forceCommand).
		ws.last().receive({
			type: 'tool_start',
			sessionId: 'sid-1',
			toolName: 'bash',
			args: {command: 'ls -la'},
			forceCommand: true,
		});

		const t = tools();
		expect(t.length).toBe(1); // reconciled, not duplicated
		expect(t[0].optimistic).toBeFalsy(); // flag cleared
		expect(t[0].forceCommand).toBe(true);
		expect(t[0].isStreaming).toBe(true);

		// Output then streams and settles onto the SAME bubble.
		ws.last().receive({type: 'tool_update', sessionId: 'sid-1', toolName: 'bash', delta: 'total 0\n'});
		ws.last().receive({
			type: 'tool_end',
			sessionId: 'sid-1',
			toolName: 'bash',
			isError: false,
			result: 'total 0\n',
			forceCommand: true,
		});
		const done = tools();
		expect(done.length).toBe(1);
		expect(done[0].isStreaming).toBe(false);
		expect(done[0].toolOutput).toContain('total 0');
	});

	it('does NOT render an optimistic bubble for !sudo (deferred behind a password prompt)', () => {
		client = setup(ws);
		client.sendMessage('!sudo apt update');
		expect(tools().length).toBe(0);
		expect(state().sessionError).toBeNull();
	});

	it('an agent-issued bash tool_start still appends its own bubble', () => {
		client = setup(ws);
		// No optimistic bubble exists; a plain agent tool_start (no forceCommand).
		ws.last().receive({type: 'tool_start', sessionId: 'sid-1', toolName: 'bash', args: {command: 'echo hi'}});
		const t = tools();
		expect(t.length).toBe(1);
		expect(t[0].forceCommand).toBeFalsy();
		expect(t[0].optimistic).toBeFalsy();
	});
});

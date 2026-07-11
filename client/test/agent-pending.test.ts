import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// Fast-first load reducer contract: a `pending` session_created paints history
// but keeps the composer blocked (agentPending) until session_ready; a
// non-pending create is immediately sendable; a session_error while pending
// degrades to readable-but-not-sendable.

describe('agentPending (fast-first load)', () => {
	let ws: ReturnType<typeof makeWSFactory>;
	let client: WhereverClient;

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
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	function loadPending() {
		client.joinSession('/tmp/p/session.jsonl');
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/p/session.jsonl',
			cwd: '/tmp/p',
			model: '',
			isStreaming: false,
			pending: true,
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{role: 'user', content: 'hi', timestamp: 1},
				{role: 'assistant', content: 'hello', timestamp: 2},
			],
			totalCount: 2,
			offset: 0,
		});
	}

	it('paints history but stays agentPending until session_ready', () => {
		loadPending();
		let s = get(client.stateStore);
		// History is readable now.
		expect(s.messages.length).toBe(2);
		expect(s.loadingSession).toBe(false);
		// But sending is blocked until the agent is ready.
		expect(s.agentPending).toBe(true);
		expect(client.sendMessage('nope')).toBe(false);

		ws.last().receive({
			type: 'session_ready',
			sessionId: 'sid-1',
			sessionFile: '/tmp/p/session.jsonl',
			model: 'fake:model',
			isStreaming: false,
		});
		s = get(client.stateStore);
		expect(s.agentPending).toBe(false);
		expect(s.activeModel).toBe('fake:model');
		// Now a send goes out over the open socket.
		expect(client.sendMessage('now it works')).toBe(true);
		expect(ws.last().lastSentOfType('message')?.message).toBe('now it works');
	});

	it('a non-pending create is immediately sendable', () => {
		client.createSession('/tmp/new');
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-2',
			sessionFile: '/tmp/new/session.jsonl',
			cwd: '/tmp/new',
			model: 'fake:model',
			isStreaming: false,
			// no pending flag
		});
		const s = get(client.stateStore);
		expect(s.agentPending).toBe(false);
		expect(client.sendMessage('hi')).toBe(true);
	});

	it('session_error while pending degrades to readable-but-not-sendable', () => {
		loadPending();
		expect(get(client.stateStore).agentPending).toBe(true);
		ws.last().receive({type: 'session_error', sessionId: 'sid-1', error: 'agent build failed'});
		const s = get(client.stateStore);
		expect(s.agentPending).toBe(false);
		expect(s.sessionError).toBe('agent build failed');
		// History is still there to read.
		expect(s.messages.length).toBe(2);
	});
});

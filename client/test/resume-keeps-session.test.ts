import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// Bug 2 (client-level invariant): on tab-background suspend() and return
// resume(), the client must KEEP the cached session (activeSessionFile +
// messages) and mark it resyncing, NOT drop to a no-session state. The UI keys
// the "new session / search box" empty-state on activeSessionFile being null; if
// suspend/resume nulled it, the search box would flash on every resume. These
// tests pin the client contract the UI relies on.

function createAndLoad(ws: ReturnType<typeof makeWSFactory>, client: WhereverClient) {
	client.joinSession('/tmp/project/session.jsonl');
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
			{role: 'user', content: 'hello', timestamp: 1},
			{role: 'assistant', content: 'hi there', timestamp: 2},
		],
		totalCount: 2,
		offset: 0,
	});
}

describe('suspend/resume keeps the session visible', () => {
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
		createAndLoad(ws, client);
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	it('starts with an active session and messages', () => {
		const s = get(client.stateStore);
		expect(s.activeSessionFile).toBe('/tmp/project/session.jsonl');
		expect(s.messages.length).toBe(2);
	});

	it('suspend() preserves activeSessionFile and messages (does not drop to no-session)', () => {
		client.suspend();
		const s = get(client.stateStore);
		expect(s.connected).toBe(false);
		// The cached session and its messages must survive the suspend so the UI
		// keeps showing the conversation, not the search/new-session empty-state.
		expect(s.activeSessionFile).toBe('/tmp/project/session.jsonl');
		expect(s.messages.length).toBe(2);
		expect(client.hasSuspendedSession()).toBe(true);
	});

	it('resume() marks the session resyncing while keeping it visible', () => {
		client.suspend();
		client.resume();
		const s = get(client.stateStore);
		// resyncing drives the "Reconnecting and syncing session..." banner; the
		// session must still be present so no search box flashes.
		expect(s.resyncing).toBe(true);
		expect(s.activeSessionFile).toBe('/tmp/project/session.jsonl');
		expect(s.messages.length).toBe(2);
	});

	it('resume() rejoins in place and clears resyncing on the fresh history', () => {
		client.suspend();
		client.resume();
		// A brand-new socket was created by resume(); open it.
		ws.last().open();
		// The client should have re-issued session_load for the cached session.
		expect(ws.last().lastSentOfType('session_load')?.sessionFile).toBe(
			'/tmp/project/session.jsonl',
		);
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
				{role: 'user', content: 'hello', timestamp: 1},
				{role: 'assistant', content: 'hi there', timestamp: 2},
			],
			totalCount: 2,
			offset: 0,
		});
		const s = get(client.stateStore);
		expect(s.resyncing).toBe(false);
		expect(s.connected).toBe(true);
		expect(s.activeSessionFile).toBe('/tmp/project/session.jsonl');
	});
});

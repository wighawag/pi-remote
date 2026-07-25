import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// Bug: while a session was slow to load, tapping a DIFFERENT session in the
// sidebar could result in the old, slow session suddenly replacing the one the
// user had switched to. The user is looking at session B, then session A's late
// reply lands and clobbers B.
//
// Cause: session_load's reply (session_created + message_history) was applied
// UNCONDITIONALLY. A switch to B reset the store and issued a fresh load, but
// A's in-flight replies were still on the wire; when they arrived they set
// activeSessionFile/sessionId/messages back to A.
//
// Fix: stamp pendingLoadFile on every session_load and reject a session_created
// whose sessionFile no longer matches (the latest tap wins). message_history for
// a non-active sessionId is likewise dropped, and it must not disarm the
// watchdog still guarding B's in-flight load.

function newClient(ws: ReturnType<typeof makeWSFactory>) {
	const client = new WhereverClient({
		host: 'localhost',
		port: 1234,
		secure: false,
		WebSocketCtor: ws.ctor,
	});
	client.connect();
	ws.last().open();
	return client;
}

describe('a superseded (slow) session load never clobbers the switched-to session', () => {
	let ws: ReturnType<typeof makeWSFactory>;
	let client: WhereverClient;

	beforeEach(() => {
		vi.useFakeTimers();
		ws = makeWSFactory();
		client = newClient(ws);
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	it("drops session A's late session_created after the user switched to B", () => {
		// Start loading the slow session A.
		client.joinSession('/tmp/project/A.jsonl');
		expect(get(client.stateStore).loadingSession).toBe(true);

		// Before A replies, the user taps session B in the sidebar.
		client.switchSession('/tmp/project/B.jsonl');

		// B loads normally.
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-B',
			sessionFile: '/tmp/project/B.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-B',
			messages: [{role: 'user', content: 'work on B', timestamp: 1}],
			totalCount: 1,
			offset: 0,
		});

		expect(get(client.stateStore).activeSessionFile).toBe('/tmp/project/B.jsonl');
		expect(get(client.stateStore).sessionId).toBe('sid-B');

		// NOW session A's slow reply finally arrives. It must be ignored: the user
		// is on B, and A should not suddenly take over.
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-A',
			sessionFile: '/tmp/project/A.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-A',
			messages: [{role: 'user', content: 'work on A', timestamp: 1}],
			totalCount: 1,
			offset: 0,
		});

		const s = get(client.stateStore);
		expect(s.activeSessionFile).toBe('/tmp/project/B.jsonl');
		expect(s.sessionId).toBe('sid-B');
		expect(s.messages.map((m) => m.content)).toContain('work on B');
		expect(s.messages.map((m) => m.content)).not.toContain('work on A');
	});

	it('accepts the switched-to session B normally (the happy path is unaffected)', () => {
		client.joinSession('/tmp/project/A.jsonl');
		client.switchSession('/tmp/project/B.jsonl');

		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-B',
			sessionFile: '/tmp/project/B.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-B',
			messages: [{role: 'user', content: 'work on B', timestamp: 1}],
			totalCount: 1,
			offset: 0,
		});

		const s = get(client.stateStore);
		expect(s.activeSessionFile).toBe('/tmp/project/B.jsonl');
		expect(s.loadingSession).toBe(false);
	});

	it("a stale session A history does not disarm the watchdog guarding B's load", () => {
		client.joinSession('/tmp/project/A.jsonl');
		client.switchSession('/tmp/project/B.jsonl');

		// B is accepted...
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-B',
			sessionFile: '/tmp/project/B.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
		});
		// ...but B's own message_history has NOT arrived yet, so B is still loading
		// and its load watchdog is armed. A stale A history now shows up.
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-A',
			messages: [{role: 'user', content: 'work on A', timestamp: 1}],
			totalCount: 1,
			offset: 0,
		});

		// The stale A history must NOT have resolved B's load: still loading, and
		// the watchdog is still able to fire as a last resort.
		expect(get(client.stateStore).loadingSession).toBe(true);

		// B's real history finally lands and resolves the load.
		ws.last().receive({
			type: 'message_history',
			sessionId: 'sid-B',
			messages: [{role: 'user', content: 'work on B', timestamp: 1}],
			totalCount: 1,
			offset: 0,
		});
		expect(get(client.stateStore).loadingSession).toBe(false);
	});

	it('a brand-new session (session_new) is never rejected by a stale pendingLoadFile', () => {
		// A slow load is in flight...
		client.joinSession('/tmp/project/A.jsonl');
		// ...then the user creates a NEW session instead. pendingLoadFile must be
		// cleared so the new session's created (with an unrelated sessionFile) is
		// accepted.
		client.createSession('/tmp/project');
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-N',
			sessionFile: '/tmp/project/new.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
		});

		const s = get(client.stateStore);
		expect(s.activeSessionFile).toBe('/tmp/project/new.jsonl');
		expect(s.sessionId).toBe('sid-N');
		expect(s.creatingSession).toBe(false);
	});
});

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// Bug: opening the app on a deep link like `https://host/#<sessionId>` hung
// forever on "Loading session...", while clicking the SAME session in the
// sidebar loaded instantly.
//
// Cause: the sidebar joins by session FILE path, but the URL hash carries the
// session ID. `session_load` accepts either (the server resolves an ID to its
// file), yet the reply always carries the resolved FILE. The superseded-load
// guard compared `msg.sessionFile === pendingLoadFile`, so an ID-issued load
// never matched its own reply: session_created was dropped as "stale", no
// session ever became active, and the hash-driven spinner never cleared.
//
// Fix: the pending load target matches its reply by sessionFile OR sessionId.

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

const SESSION_ID = '019fa1e9-0e62-795f-bee9-f2e1fcdc39d5';
const SESSION_FILE = '/tmp/project/019fa1e9-0e62-795f-bee9-f2e1fcdc39d5.jsonl';

describe('loading a session by ID (URL hash deep link)', () => {
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

	it('accepts the reply whose sessionFile is the resolved path of the requested ID', () => {
		client.joinSession(SESSION_ID);
		expect(get(client.stateStore).loadingSession).toBe(true);

		ws.last().receive({
			type: 'session_created',
			sessionId: SESSION_ID,
			sessionFile: SESSION_FILE,
			cwd: '/tmp/project',
			model: 'fake:model',
			pending: true,
		});
		ws.last().receive({
			type: 'message_history',
			sessionId: SESSION_ID,
			messages: [{role: 'user', content: 'hello', timestamp: 1}],
			totalCount: 1,
			offset: 0,
		});

		const s = get(client.stateStore);
		expect(s.sessionId).toBe(SESSION_ID);
		expect(s.activeSessionFile).toBe(SESSION_FILE);
		expect(s.loadingSession).toBe(false);
		expect(s.messages.map((m) => m.content)).toContain('hello');
	});

	it('still drops a late reply for a different session after switching by ID', () => {
		client.joinSession('other-session-id');
		client.switchSession(SESSION_ID);

		ws.last().receive({
			type: 'session_created',
			sessionId: SESSION_ID,
			sessionFile: SESSION_FILE,
			cwd: '/tmp/project',
			model: 'fake:model',
		});
		// The abandoned load finally answers; it must not take over.
		ws.last().receive({
			type: 'session_created',
			sessionId: 'other-session-id',
			sessionFile: '/tmp/project/other.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
		});

		const s = get(client.stateStore);
		expect(s.sessionId).toBe(SESSION_ID);
		expect(s.activeSessionFile).toBe(SESSION_FILE);
	});
});

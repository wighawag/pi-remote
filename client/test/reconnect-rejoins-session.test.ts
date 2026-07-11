import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// Bug: after an UNSOLICITED reconnect (the socket dropped on its own -- tab
// switch, network blip, laptop sleep, half-open reap -- NOT via suspend()), the
// client reconnected to the relay but did NOT re-issue session_load, so the new
// socket was attached to NO session server-side. The frontend kept showing the
// stale conversation (a frozen tool call as the last message, "Abort" disabled)
// and followed nothing, with no "connecting"/"loading" affordance, while the
// agent kept running behind the scenes. Only a full reload recovered it.
//
// The server is stateless per-connection: every new socket gets a fresh clientId
// with sessionId=null and the old socket's close removes the client from the
// pool. So the CLIENT must re-attach by re-issuing session_load on ANY reconnect
// that still holds an active session -- not only on the suspend/resume path.

function createAndLoad(
	ws: ReturnType<typeof makeWSFactory>,
	client: WhereverClient,
	{streaming = false}: {streaming?: boolean} = {},
) {
	client.joinSession('/tmp/project/session.jsonl');
	ws.last().receive({
		type: 'session_created',
		sessionId: 'sid-1',
		sessionFile: '/tmp/project/session.jsonl',
		cwd: '/tmp/project',
		model: 'fake:model',
		isStreaming: streaming,
	});
	ws.last().receive({
		type: 'message_history',
		sessionId: 'sid-1',
		messages: [{role: 'user', content: 'go build it', timestamp: 1}],
		totalCount: 1,
		offset: 0,
	});
}

describe('unsolicited reconnect re-attaches to the active session', () => {
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
		createAndLoad(ws, client, {streaming: true});
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	it('re-issues session_load after the socket drops and reconnects', () => {
		const firstWs = ws.last();
		// The socket dies on its own (no suspend). onClose schedules a reconnect.
		firstWs.close();

		// The reconnect backoff timer fires and opens a brand-new socket.
		vi.advanceTimersByTime(5000);
		const secondWs = ws.last();
		expect(secondWs).not.toBe(firstWs);
		secondWs.open();

		// The client MUST re-attach to the previously-active session so the live
		// stream resumes; otherwise it is silently detached and frozen.
		const load = secondWs.lastSentOfType('session_load');
		expect(load).toBeTruthy();
		expect(load.sessionFile).toBe('/tmp/project/session.jsonl');
	});

	it('shows a resyncing affordance during the reconnect, not a silent frozen view', () => {
		const firstWs = ws.last();
		firstWs.close();
		vi.advanceTimersByTime(5000);
		const secondWs = ws.last();
		secondWs.open();

		// While re-attaching, resyncing is true (drives the "Reconnecting and
		// syncing session..." banner + blocks sending) and the cached conversation
		// stays visible.
		const s = get(client.stateStore);
		expect(s.resyncing).toBe(true);
		expect(s.activeSessionFile).toBe('/tmp/project/session.jsonl');
		expect(s.messages.length).toBeGreaterThan(0);
	});

	it('clears resyncing and resumes the stream once fresh history arrives', () => {
		ws.last().close();
		vi.advanceTimersByTime(5000);
		const secondWs = ws.last();
		secondWs.open();

		secondWs.receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/project/session.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
			isStreaming: true,
		});
		secondWs.receive({
			type: 'message_history',
			sessionId: 'sid-1',
			messages: [
				{role: 'user', content: 'go build it', timestamp: 1},
				{role: 'assistant', content: 'on it', timestamp: 2},
			],
			totalCount: 2,
			offset: 0,
		});

		const s = get(client.stateStore);
		expect(s.resyncing).toBe(false);
		expect(s.connected).toBe(true);
		// Re-attach restores the true streaming state from the server, so "Abort"
		// re-enables if the agent is still working (the reported symptom: Abort
		// disabled with a stale tool call as last message).
		expect(s.isStreaming).toBe(true);
		// Live stream is following again: a new event after resync lands.
		secondWs.receive({type: 'agent_end'});
		vi.advanceTimersByTime(400);
		expect(get(client.stateStore).isStreaming).toBe(false);
	});
});

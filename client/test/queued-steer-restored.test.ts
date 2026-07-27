import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// Bug: after a reload, a message queued mid-stream (a STEER) was invisible. The
// server now snapshots pi's queue on attach (queue_update), but the queued text
// is NOT in the session file yet, so message_history cannot contain it: with
// only `pendingSteering` set and no matching message, the UI had nothing to
// badge and the user's text simply vanished until pi injected it at the next
// step.
//
// Fix: queue_update re-materializes any queued text with no matching user
// message, so a reloaded client shows the queued messages (badged "Queued") and
// can still cancel them.

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

function attach(ws: ReturnType<typeof makeWSFactory>, client: WhereverClient) {
	client.joinSession('/tmp/project/session.jsonl');
	ws.last().receive({
		type: 'session_created',
		sessionId: 'sid-1',
		sessionFile: '/tmp/project/session.jsonl',
		cwd: '/tmp/project',
		model: 'fake:model',
	});
	ws.last().receive({
		type: 'message_history',
		sessionId: 'sid-1',
		messages: [{role: 'user', content: 'do the first thing', timestamp: 1}],
		totalCount: 1,
		offset: 0,
	});
}

describe('a queued steer is restored into the conversation on reload', () => {
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

	it('renders a queued message the freshly-loaded history does not contain', () => {
		attach(ws, client);

		ws.last().receive({
			type: 'queue_update',
			sessionId: 'sid-1',
			steering: ['actually do X instead'],
		});

		const s = get(client.stateStore);
		expect(s.pendingSteering).toEqual(['actually do X instead']);
		const restored = s.messages.filter(
			(m) => m.role === 'user' && m.content === 'actually do X instead',
		);
		expect(restored).toHaveLength(1);
		// It is server-side queued, not an unconfirmed local send: no retry banner.
		expect(restored[0].delivery).toBeUndefined();
	});

	it('does not duplicate a queued message we sent ourselves this session', () => {
		attach(ws, client);
		client.sendMessage('actually do X instead');

		ws.last().receive({
			type: 'queue_update',
			sessionId: 'sid-1',
			steering: ['actually do X instead'],
		});

		const s = get(client.stateStore);
		expect(
			s.messages.filter((m) => m.content === 'actually do X instead'),
		).toHaveLength(1);
	});

	it('does not duplicate when the queued message is finally delivered', () => {
		attach(ws, client);
		ws.last().receive({
			type: 'queue_update',
			sessionId: 'sid-1',
			steering: ['actually do X instead'],
		});
		// pi injects it: the queue empties and the server echoes the user message.
		ws.last().receive({type: 'queue_update', sessionId: 'sid-1', steering: []});
		ws.last().receive({
			type: 'message_end',
			sessionId: 'sid-1',
			role: 'user',
			content: 'actually do X instead',
		});

		const s = get(client.stateStore);
		expect(s.pendingSteering).toEqual([]);
		expect(
			s.messages.filter((m) => m.content === 'actually do X instead'),
		).toHaveLength(1);
	});

	it('restores every queued message, including repeats of the same text', () => {
		attach(ws, client);
		ws.last().receive({
			type: 'queue_update',
			sessionId: 'sid-1',
			steering: ['ping', 'ping'],
		});

		const s = get(client.stateStore);
		expect(s.messages.filter((m) => m.content === 'ping')).toHaveLength(2);
	});

	it('does not duplicate when the OLDER of two queued messages is delivered', () => {
		attach(ws, client);
		ws.last().receive({
			type: 'queue_update',
			sessionId: 'sid-1',
			steering: ['first queued', 'second queued'],
		});
		// pi injects the oldest: the queue drops it and the server echoes it. The
		// echoed message is NOT the last user bubble ('second queued' is), so a
		// naive last-message dedupe would append a duplicate.
		ws.last().receive({
			type: 'queue_update',
			sessionId: 'sid-1',
			steering: ['second queued'],
		});
		ws.last().receive({
			type: 'message_end',
			sessionId: 'sid-1',
			role: 'user',
			content: 'first queued',
		});

		const s = get(client.stateStore);
		expect(s.messages.filter((m) => m.content === 'first queued')).toHaveLength(1);
		expect(s.messages.filter((m) => m.content === 'second queued')).toHaveLength(1);
		expect(s.pendingSteering).toEqual(['second queued']);
	});

	it('leaves an already-restored queue alone on a repeated snapshot', () => {
		attach(ws, client);
		const snapshot = {
			type: 'queue_update',
			sessionId: 'sid-1',
			steering: ['actually do X instead'],
		};
		ws.last().receive(snapshot);
		ws.last().receive(snapshot);

		const s = get(client.stateStore);
		expect(
			s.messages.filter((m) => m.content === 'actually do X instead'),
		).toHaveLength(1);
	});
});

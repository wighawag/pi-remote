import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// A message submitted WHILE the agent is streaming must be sent to the relay
// IMMEDIATELY (the server turns a mid-stream `message` into a steer, injected at
// the next tool/step boundary). This is the pi-CLI default (Enter -> steer). It
// must NOT be held locally waiting for the turn to finish -- the old behaviour
// that also mis-fired mid-turn on the flaky isStreaming debounce (docs/adr/0003).

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

describe('mid-stream submit steers immediately', () => {
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

	it('sends the message frame NOW while the agent is mid-turn', () => {
		createAndLoad(ws, client, {streaming: true});
		const sock = ws.last();
		expect(get(client.stateStore).isStreaming).toBe(true);

		// User submits mid-stream. sendMessage must hand a `message` frame to the
		// OPEN socket right away, not park it.
		const ok = client.sendMessage('actually, do X instead');
		expect(ok).toBe(true);

		const frame = sock.lastSentOfType('message');
		expect(frame).toBeTruthy();
		expect(frame.message).toBe('actually, do X instead');

		// The optimistic user echo is committed immediately (not withheld pending
		// a later drain), and the turn is still in flight.
		const s = get(client.stateStore);
		expect(s.messages.some((m) => m.role === 'user' && m.content === 'actually, do X instead')).toBe(true);
		expect(s.isStreaming).toBe(true);
	});

	it('returns false and keeps no phantom echo when disconnected mid-stream', () => {
		createAndLoad(ws, client, {streaming: true});
		const sock = ws.last();
		// Socket drops just as the user submits.
		sock.close();

		const before = get(client.stateStore).messages.length;
		const ok = client.sendMessage('do X instead');
		expect(ok).toBe(false);
		// No optimistic echo for a send that never left; caller keeps the text.
		expect(get(client.stateStore).messages.length).toBe(before);
		expect(get(client.stateStore).sessionError).toBeTruthy();
	});
});

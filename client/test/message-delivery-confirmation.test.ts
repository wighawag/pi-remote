import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import type {WhereverState} from '../src/types.js';
import {makeWSFactory} from './harness.js';

// The half-open loss: the socket reports OPEN, ws.send() succeeds (buffers, no
// throw), but the frame never reaches the server. The optimistic user echo must
// NOT be treated as delivered: it stays unconfirmed, is recoverable on reload,
// and flips to a "failed / needs retry" state instead of vanishing.

// A localStorage shim so persistence works under the node test env.
function installLocalStorage() {
	const store = new Map<string, string>();
	(globalThis as any).localStorage = {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear(),
	};
	return store;
}

function createAndLoad(
	ws: ReturnType<typeof makeWSFactory>,
	client: WhereverClient,
	messages: any[] = [],
) {
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
		messages,
		totalCount: messages.length,
		offset: 0,
	});
}

describe('outbound message delivery confirmation', () => {
	let ws: ReturnType<typeof makeWSFactory>;
	let client: WhereverClient;
	const state = () => get<WhereverState>(client.stateStore);

	beforeEach(() => {
		vi.useFakeTimers();
		installLocalStorage();
		(globalThis as any).localStorage.clear();
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

	it('marks a sent message as unconfirmed (sending), not delivered', () => {
		const ok = client.sendMessage('hello there');
		expect(ok).toBe(true);
		const m = state().messages.find((x) => x.content === 'hello there')!;
		expect(m.delivery).toBe('sending');
	});

	it('confirms the message when the server echoes it back', () => {
		client.sendMessage('confirm me');
		ws.last().receive({
			type: 'message_end',
			sessionId: 'sid-1',
			role: 'user',
			content: 'confirm me',
		});
		const m = state().messages.find((x) => x.content === 'confirm me')!;
		expect(m.delivery).toBeUndefined();
		// No duplicate echo added.
		expect(
			state().messages.filter((x) => x.content === 'confirm me').length,
		).toBe(1);
	});

	it('confirms on a message_ack, before any user echo (the steer case)', () => {
		// A mid-stream steer is accepted immediately but pi only echoes it back
		// (message_end role:user) at the NEXT model call, which can be far beyond
		// the confirmation window. The server sends message_ack the moment it hands
		// the message to the agent, so delivery is confirmed right away.
		client.sendMessage('steer me now');
		expect(
			state().messages.find((x) => x.content === 'steer me now')!.delivery,
		).toBe('sending');

		ws.last().receive({
			type: 'message_ack',
			sessionId: 'sid-1',
			content: 'steer me now',
		});
		expect(
			state().messages.find((x) => x.content === 'steer me now')!.delivery,
		).toBeUndefined();

		// The watchdog is cleared: even past the window it stays confirmed.
		vi.advanceTimersByTime(12_000);
		expect(
			state().messages.find((x) => x.content === 'steer me now')!.delivery,
		).toBeUndefined();
		// No duplicate bubble.
		expect(
			state().messages.filter((x) => x.content === 'steer me now').length,
		).toBe(1);
	});

	it('a message_ack for the same content later (the user echo) adds no duplicate', () => {
		client.sendMessage('acked then echoed');
		ws.last().receive({
			type: 'message_ack',
			sessionId: 'sid-1',
			content: 'acked then echoed',
		});
		// The real pi user-echo arrives at the next turn; it must not duplicate.
		ws.last().receive({
			type: 'message_end',
			sessionId: 'sid-1',
			role: 'user',
			content: 'acked then echoed',
		});
		expect(
			state().messages.filter((x) => x.content === 'acked then echoed').length,
		).toBe(1);
	});

	// A `/skill:<name> <args>` invocation is optimistically echoed RAW, but the
	// server confirms it via a RAW message_ack (mid-stream steer) and then echoes
	// the EXPANDED skill block back as message_end role:user. Both refer to the
	// same invocation: the client must confirm the one bubble and rewrite it to
	// the expanded form, NEVER leave the raw one orphaned as failed nor append the
	// expanded one as a duplicate.
	const EXPANDED_SETUP =
		'<skill name="setup" location="/a/b/SKILL.md">\nReferences are relative to /a/b.\n\nBody here.\n</skill>';

	it('skill: message_end (expanded) confirms the raw optimistic bubble, no duplicate', () => {
		client.sendMessage('/skill:setup');
		expect(
			state().messages.find((x) => x.content === '/skill:setup')!.delivery,
		).toBe('sending');

		// Server echoes the EXPANDED block (no prior message_ack, e.g. not streaming).
		ws.last().receive({
			type: 'message_end',
			sessionId: 'sid-1',
			role: 'user',
			content: EXPANDED_SETUP,
		});

		const users = state().messages.filter((x) => x.role === 'user');
		expect(users.length).toBe(1);
		expect(users[0].delivery).toBeUndefined();
		// Rewritten to the expanded form so the skill chip renders.
		expect(users[0].content).toBe(EXPANDED_SETUP);

		// Even past the window it stays confirmed (watchdog cleared).
		vi.advanceTimersByTime(12_000);
		expect(
			state().messages.find((x) => x.role === 'user')!.delivery,
		).toBeUndefined();
	});

	it('skill: raw message_ack then expanded message_end yields one confirmed chip', () => {
		client.sendMessage('/skill:setup');
		// Mid-stream steer path: server acks the RAW content immediately.
		ws.last().receive({
			type: 'message_ack',
			sessionId: 'sid-1',
			content: '/skill:setup',
		});
		expect(
			state().messages.find((x) => x.role === 'user')!.delivery,
		).toBeUndefined();

		// Later, pi echoes the EXPANDED block at the next model call.
		ws.last().receive({
			type: 'message_end',
			sessionId: 'sid-1',
			role: 'user',
			content: EXPANDED_SETUP,
		});

		const users = state().messages.filter((x) => x.role === 'user');
		expect(users.length).toBe(1);
		expect(users[0].delivery).toBeUndefined();
		expect(users[0].content).toBe(EXPANDED_SETUP);
	});

	it('skill: preserves the trailing args when matching raw to expanded', () => {
		client.sendMessage('/skill:setup do the thing');
		const expandedWithArgs = `${EXPANDED_SETUP}\n\ndo the thing`;
		ws.last().receive({
			type: 'message_end',
			sessionId: 'sid-1',
			role: 'user',
			content: expandedWithArgs,
		});
		const users = state().messages.filter((x) => x.role === 'user');
		expect(users.length).toBe(1);
		expect(users[0].delivery).toBeUndefined();
		expect(users[0].content).toBe(expandedWithArgs);
	});

	it('flips to failed when no echo arrives within the window (half-open loss)', () => {
		// Half-open: send() reports success but the server never processes it, so
		// no echo is ever received.
		client.sendMessage('lost message');
		expect(
			state().messages.find((x) => x.content === 'lost message')!.delivery,
		).toBe('sending');

		vi.advanceTimersByTime(12_000);
		const m = state().messages.find((x) => x.content === 'lost message')!;
		expect(m.delivery).toBe('failed');
	});

	it('persists an unconfirmed message so a reload can recover it', () => {
		client.sendMessage('recover me on reload');
		// Simulate a reload: a fresh client instance against the same localStorage.
		const ws2 = makeWSFactory();
		const client2 = new WhereverClient({
			host: 'localhost',
			port: 1234,
			secure: false,
			WebSocketCtor: ws2.ctor,
		});
		client2.connect();
		ws2.last().open();
		// History comes back WITHOUT the message (the server never got it).
		createAndLoad(ws2, client2, []);

		const recovered = get<WhereverState>(client2.stateStore).messages.find(
			(x) => x.content === 'recover me on reload',
		);
		expect(recovered).toBeTruthy();
		expect(recovered!.delivery).toBe('failed');
		client2.disconnect(true);
	});

	it('does NOT re-surface a message that history confirms was delivered', () => {
		client.sendMessage('this one landed');
		// Reload; history DOES contain it (it was delivered before the drop).
		const ws2 = makeWSFactory();
		const client2 = new WhereverClient({
			host: 'localhost',
			port: 1234,
			secure: false,
			WebSocketCtor: ws2.ctor,
		});
		client2.connect();
		ws2.last().open();
		createAndLoad(ws2, client2, [
			{role: 'user', content: 'this one landed', timestamp: 1_000},
		]);

		const msgs = get<WhereverState>(client2.stateStore).messages.filter(
			(x) => x.content === 'this one landed',
		);
		// Exactly one, and delivered (no failed duplicate).
		expect(msgs.length).toBe(1);
		expect(msgs[0].delivery).toBeUndefined();
		client2.disconnect(true);
	});

	it('resendMessage re-sends a failed message and re-arms confirmation', () => {
		client.sendMessage('retry me');
		vi.advanceTimersByTime(12_000);
		const failed = state().messages.find((x) => x.content === 'retry me')!;
		expect(failed.delivery).toBe('failed');

		const sock = ws.last();
		const before = sock.sent.filter((f) => f.type === 'message').length;
		const ok = client.resendMessage(failed.id);
		expect(ok).toBe(true);
		expect(sock.sent.filter((f) => f.type === 'message').length).toBe(before + 1);
		expect(
			state().messages.find((x) => x.id === failed.id)!.delivery,
		).toBe('sending');

		// The echo now confirms it.
		sock.receive({
			type: 'message_end',
			sessionId: 'sid-1',
			role: 'user',
			content: 'retry me',
		});
		expect(
			state().messages.find((x) => x.id === failed.id)!.delivery,
		).toBeUndefined();
	});

	it('discardMessage removes a failed message and clears it from persistence', () => {
		client.sendMessage('drop me');
		vi.advanceTimersByTime(12_000);
		const failed = state().messages.find((x) => x.content === 'drop me')!;
		client.discardMessage(failed.id);
		expect(state().messages.find((x) => x.content === 'drop me')).toBeUndefined();
		expect(
			(globalThis as any).localStorage.getItem('wherever-pending:sid-1'),
		).toBeNull();
	});
});

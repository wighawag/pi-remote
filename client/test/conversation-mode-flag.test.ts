import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import type {WhereverState} from '../src/types.js';
import {makeWSFactory} from './harness.js';

// The per-turn CONVERSATION-MODE SIGNAL on the wire: a spoken conversation is
// state that lives in the web app's knobs registry, and a dictated message is
// byte-identical to a typed one, so the agent could never tell the mode was on
// and never called `say`. The client now stamps an OPTIONAL `conversationMode`
// boolean on the EXISTING `message` payload (no new message type, no new chat
// role); when off the field is absent, so the frame is exactly what it was before
// and an older server ignores it.

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
		messages: [],
		totalCount: 0,
		offset: 0,
	});
}

describe('conversation-mode flag on the message payload', () => {
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

	it('omits the field entirely for a normal send (no options)', () => {
		expect(client.sendMessage('plain send')).toBe(true);
		const frame = ws.last().lastSentOfType('message');
		expect(frame.message).toBe('plain send');
		expect('conversationMode' in frame).toBe(false);
	});

	it('omits the field when the caller passes conversationMode: false', () => {
		client.sendMessage('mode off', {conversationMode: false});
		const frame = ws.last().lastSentOfType('message');
		expect('conversationMode' in frame).toBe(false);
	});

	it('stamps conversationMode: true when the caller asks for it', () => {
		client.sendMessage('speak this back', {conversationMode: true});
		const frame = ws.last().lastSentOfType('message');
		expect(frame.type).toBe('message');
		expect(frame.conversationMode).toBe(true);
		// The user text is untouched: the signal is a field, never a preamble.
		expect(frame.message).toBe('speak this back');
	});

	it('keeps the local echo free of the flag (nothing user-visible changes)', () => {
		client.sendMessage('echo check', {conversationMode: true});
		const echo = state().messages.find((m) => m.content === 'echo check')!;
		expect(echo.content).toBe('echo check');
		expect((echo as unknown as Record<string, unknown>).conversationMode).toBeUndefined();
	});

	it('re-stamps the flag on resend, from the caller (a resend is a fresh turn)', () => {
		client.sendMessage('retry me', {conversationMode: true});
		const id = state().messages.find((m) => m.content === 'retry me')!.id;
		// The user flipped the mode OFF before hitting Retry: no flag this time.
		expect(client.resendMessage(id)).toBe(true);
		expect('conversationMode' in ws.last().lastSentOfType('message')).toBe(false);

		// And with the mode back on, the resend carries it again.
		expect(client.resendMessage(id, {conversationMode: true})).toBe(true);
		expect(ws.last().lastSentOfType('message').conversationMode).toBe(true);
	});
});

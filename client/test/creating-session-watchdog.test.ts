import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// Bug 1: creating a new session shows the full-screen "Creating session..."
// spinner (state.creatingSession) forever when the server never replies with
// session_created / session_error (a slow git init or remote-repo creation, an
// error thrown before the reply is sent, or a half-open socket the liveness
// watchdog has not reaped yet). Every OTHER load flag (loadingSession,
// resyncing) is guarded by a watchdog; creatingSession was not. These tests pin
// the contract: creatingSession must always resolve.

describe('creating-session watchdog', () => {
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

	it('sets creatingSession true when a create is requested', () => {
		client.createSession('/tmp/project');
		expect(get(client.stateStore).creatingSession).toBe(true);
	});

	it('clears creatingSession and surfaces a recoverable error if no reply ever arrives', () => {
		client.createSession('/tmp/project');
		expect(get(client.stateStore).creatingSession).toBe(true);

		// No session_created / session_error comes back. Advance past the watchdog.
		vi.advanceTimersByTime(30_000);

		const s = get(client.stateStore);
		expect(s.creatingSession).toBe(false);
		expect(s.sessionError).toBeTruthy();
	});

	it('clears creatingSession normally on session_created (watchdog does not fire)', () => {
		client.createSession('/tmp/project');
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/project/session.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
			isStreaming: false,
		});

		expect(get(client.stateStore).creatingSession).toBe(false);

		// The watchdog must have been disarmed: advancing time must NOT resurrect
		// an error on the now-successfully-created session.
		vi.advanceTimersByTime(30_000);
		const s = get(client.stateStore);
		expect(s.creatingSession).toBe(false);
		expect(s.sessionError).toBeFalsy();
		expect(s.activeSessionFile).toBe('/tmp/project/session.jsonl');
	});

	it('clears creatingSession on session_error', () => {
		client.createSession('/tmp/project');
		ws.last().receive({type: 'session_error', error: 'boom'});
		const s = get(client.stateStore);
		expect(s.creatingSession).toBe(false);
		expect(s.sessionError).toBe('boom');
	});
});

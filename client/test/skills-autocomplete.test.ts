import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// `/skill:` composer autocomplete contract. The skill list is only resolvable
// once the session's live agent exists, so the client asks for it as soon as
// the agent is live. A brand-new session (session_new) is live IMMEDIATELY and
// never emits session_ready, so requesting only on session_ready left a fresh
// session with an empty skill menu (the regression this covers).

describe('skill autocomplete list', () => {
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

	it('requests skills for a freshly created session (no session_ready)', () => {
		client.createSession('/tmp/new');
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-new',
			sessionFile: '/tmp/new/session.jsonl',
			cwd: '/tmp/new',
			model: 'fake:model',
			isStreaming: false,
			// no pending flag: the agent is already live
		});

		const req = ws.last().lastSentOfType('skills_request');
		expect(req).toBeDefined();
		expect(req.sessionId).toBe('sid-new');

		ws.last().receive({
			type: 'skills_list',
			sessionId: 'sid-new',
			skills: [{name: 'skill:setup', description: 'Set things up'}],
		});
		expect(get(client.stateStore).skills).toEqual([
			{name: 'skill:setup', description: 'Set things up'},
		]);
	});

	it('defers the request to session_ready for a cold (pending) load', () => {
		client.joinSession('/tmp/p/session.jsonl');
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-cold',
			sessionFile: '/tmp/p/session.jsonl',
			cwd: '/tmp/p',
			model: '',
			isStreaming: false,
			pending: true,
		});
		// The agent is still building: nothing to ask yet.
		expect(ws.last().lastSentOfType('skills_request')).toBeUndefined();

		ws.last().receive({
			type: 'session_ready',
			sessionId: 'sid-cold',
			sessionFile: '/tmp/p/session.jsonl',
			model: 'fake:model',
			isStreaming: false,
		});
		expect(ws.last().lastSentOfType('skills_request')?.sessionId).toBe('sid-cold');
	});

	it('clears the previous session skills when attaching to another session', () => {
		client.createSession('/tmp/a');
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-a',
			sessionFile: '/tmp/a/session.jsonl',
			cwd: '/tmp/a',
			model: 'fake:model',
			isStreaming: false,
		});
		ws.last().receive({
			type: 'skills_list',
			sessionId: 'sid-a',
			skills: [{name: 'skill:a', description: 'A'}],
		});
		expect(get(client.stateStore).skills.length).toBe(1);

		client.joinSession('/tmp/b/session.jsonl');
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-b',
			sessionFile: '/tmp/b/session.jsonl',
			cwd: '/tmp/b',
			model: 'fake:model',
			isStreaming: false,
			pending: true,
		});
		expect(get(client.stateStore).skills).toEqual([]);
	});
});

import {describe, it, expect} from 'vitest';
import {decideComposeSend} from './compose-send.js';

// The pi-CLI default: a submit made WHILE the agent is streaming STEERS
// immediately. This helper encodes that decision; the regression it guards is
// the old behaviour where a mid-stream submit was parked in a local queue and
// only auto-sent once the turn resolved (which also mis-fired mid-turn on the
// flaky isStreaming debounce -- see docs/adr/0003).

const base = {
	streaming: false,
	connected: true,
	agentPending: false,
	readOnly: false,
	hasSession: true,
};

describe('decideComposeSend', () => {
	it('an idle, connected submit sends now', () => {
		const r = decideComposeSend({...base});
		expect(r.action).toBe('send');
	});

	it('a MID-STREAM connected submit STEERS immediately (no queue/wait)', () => {
		const r = decideComposeSend({...base, streaming: true});
		// The whole point: it sends now, as a steer. It must NEVER resolve to a
		// "queue and wait for the turn to finish" outcome.
		expect(r).toEqual({action: 'send', deliverAs: 'steer'});
	});

	it('an explicit follow-up opt-in sends now but as followUp (wait)', () => {
		const r = decideComposeSend({...base, streaming: true}, {followUp: true});
		expect(r).toEqual({action: 'send', deliverAs: 'followUp'});
	});

	it('blocks (keeps text) when disconnected, even mid-stream', () => {
		const r = decideComposeSend({...base, streaming: true, connected: false});
		expect(r).toEqual({action: 'blocked', reason: 'disconnected'});
	});

	it('blocks while the session agent is still building', () => {
		const r = decideComposeSend({...base, agentPending: true});
		expect(r).toEqual({action: 'blocked', reason: 'agent-pending'});
	});

	it('blocks in read-only mode', () => {
		const r = decideComposeSend({...base, readOnly: true});
		expect(r).toEqual({action: 'blocked', reason: 'read-only'});
	});

	it('blocks when there is no active session', () => {
		const r = decideComposeSend({...base, hasSession: false});
		expect(r).toEqual({action: 'blocked', reason: 'no-session'});
	});
});

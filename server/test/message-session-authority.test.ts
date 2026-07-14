import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// Regression: a message MUST be delivered to the session the client actually
// stamped on it (msg.sessionId), never to whatever the server's per-connection
// client.sessionId happens to point at. A switch/reconnect/resync race could
// leave client.sessionId stale relative to the session the client painted and
// targeted, silently misrouting the message into ANOTHER session's agent (the
// "I switched sessions and the agent replied as if we were in another session"
// bug). The server now treats msg.sessionId as authoritative and REFUSES on a
// mismatch instead of delivering to the wrong agent.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('message routing honors the client-stamped sessionId', () => {
  it('refuses a message whose sessionId is not the one this connection is attached to', async () => {
    // Two isolated cwds so each session is a distinct folder (no conflict/takeover
    // when the same connection creates the second one).
    h = await startHarness({ initial: { kind: 'reply', text: 'A reply' }, idleTimeoutMs: 300_000 });
    const c = await h.connect();
    await c.waitForType('connected');

    // Session A.
    const cwdA = c.workspace + '/a';
    c.send({ type: 'session_new', cwd: cwdA });
    const createdA = await c.waitForType('session_created');
    const sessionA = createdA.sessionId as string;

    // Leave A (pool keeps it warm), then create session B in a different cwd.
    c.send({ type: 'session_leave', sessionId: sessionA });
    const cwdB = c.workspace + '/b';
    c.send({ type: 'session_new', cwd: cwdB });
    const createdB = await c.waitFor(
      (m) => m.type === 'session_created' && m.sessionId !== sessionA,
    );
    const sessionB = createdB.sessionId as string;
    expect(sessionB).not.toBe(sessionA);

    // The connection is now attached to B. Send a message STAMPED with A's id
    // (simulating the client having switched/painted A while the server's
    // per-connection attachment is still B). It must be refused, not delivered.
    h.setNext({ kind: 'reply', text: 'should never be produced for a misrouted send' });
    c.send({ type: 'message', message: 'this targets A', sessionId: sessionA });

    const settled = await c.waitFor(
      (m) => m.type === 'session_error' || m.type === 'agent_start',
      15_000,
    );
    expect(settled.type).toBe('session_error');
    // No turn was started for EITHER session by the misrouted send.
    expect(c.messages.some((m) => m.type === 'agent_start')).toBe(false);
  }, 60_000);

  it('delivers a message stamped with the attached session id', async () => {
    h = await startHarness({ initial: { kind: 'reply', text: 'ok reply' }, idleTimeoutMs: 300_000 });
    const c = await h.connect();
    await c.waitForType('connected');

    c.send({ type: 'session_new', cwd: c.workspace });
    const created = await c.waitForType('session_created');
    const sessionId = created.sessionId as string;

    // Correctly stamped: delivered end-to-end, no session_error.
    c.send({ type: 'message', message: 'hi', sessionId });
    const end = await c.waitFor(
      (m) => m.type === 'message_end' && m.role === 'assistant',
      30_000,
    );
    expect(end.content).toBe('ok reply');
    expect(c.messages.some((m) => m.type === 'session_error')).toBe(false);
  }, 60_000);
});

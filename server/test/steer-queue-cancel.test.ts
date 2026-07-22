import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// End-to-end: a message submitted WHILE the agent is streaming is queued by pi
// as a STEER. The server relays pi's queue via `queue_update` (steering: [...]),
// so the web can offer a per-message "Cancel". Sending `cancel_steer` clears the
// queued steer (pi's clearQueue) WITHOUT aborting the turn, and the server emits
// a fresh `queue_update` with the steer removed.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('queued steer is reported and cancellable', () => {
  it('emits queue_update for the steer, then clears it on cancel_steer without aborting', async () => {
    h = await startHarness({
      // A slow first turn gives a wide window to steer mid-stream.
      initial: { kind: 'slow-reply', text: 'first turn reply streaming slowly', charDelayMs: 80 },
    });
    const c = await h.connect();

    await c.waitForType('connected');
    c.send({ type: 'session_new', cwd: c.workspace });
    const created = await c.waitForType('session_created');
    const sessionId = created.sessionId as string;

    // Start the (slow) first turn and get mid-stream.
    c.send({ type: 'message', message: 'do the first thing', sessionId });
    await c.waitForType('agent_start');
    await c.waitForType('message_update');

    // Submit a steer MID-STREAM. pi queues it; the server relays the queue.
    c.send({ type: 'message', message: 'actually do X instead', sessionId });

    // The queued steer is reported to the client.
    const queued = await c.waitFor(
      (m) =>
        m.type === 'queue_update' &&
        Array.isArray((m as any).steering) &&
        (m as any).steering.includes('actually do X instead'),
      30_000,
    );
    expect(queued.sessionId).toBe(sessionId);

    // Cancel the queued steer. This must NOT abort the running turn.
    c.send({ type: 'cancel_steer', sessionId });

    // A fresh queue_update arrives with the steer removed (empty steering).
    const cleared = await c.waitFor(
      (m) =>
        m.type === 'queue_update' &&
        Array.isArray((m as any).steering) &&
        !(m as any).steering.includes('actually do X instead'),
      30_000,
    );
    expect((cleared as any).steering).toEqual([]);

    // The turn keeps running and settles cleanly: no session_error, and the
    // FIRST turn's reply still completes (the cancel did not abort it, and the
    // cancelled steer never ran a second turn).
    const end = await c.waitFor(
      (m) => m.type === 'agent_end' || m.type === 'session_error',
      30_000,
    );
    expect(end.type).toBe('agent_end');
    expect(c.messages.some((m) => m.type === 'session_error')).toBe(false);
    // Exactly one session, and the first reply streamed through.
    expect(c.messages.filter((m) => m.type === 'session_created').length).toBe(1);
    expect(c.streamedText()).toContain('first turn reply');
  }, 60_000);
});

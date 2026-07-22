import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// End-to-end: a message submitted WHILE the agent is streaming is delivered by
// the server as a STEER into the SAME running session (server/src/index.ts
// `case 'message'`: `pool.isStreaming(...) ? 'steer' : undefined`), injected at
// the next step boundary. It must not error, and it must not spawn a phantom
// second session. This is the pi-CLI default the UI now matches (Enter -> steer).

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('mid-stream message steers the running session', () => {
  it('accepts a second message mid-turn without error and keeps one session', async () => {
    h = await startHarness({
      initial: { kind: 'slow-reply', text: 'first turn reply streaming slowly', charDelayMs: 60 },
    });
    const c = await h.connect();

    await c.waitForType('connected');
    c.send({ type: 'session_new', cwd: c.workspace });
    const created = await c.waitForType('session_created');
    const sessionId = created.sessionId as string;

    // Start the (slow) first turn.
    c.send({ type: 'message', message: 'do the first thing', sessionId });
    await c.waitForType('agent_start');
    // We are now mid-stream (some deltas have flowed but the turn is not done).
    await c.waitForType('message_update');

    // The next turn's reply (delivered when the steer re-runs the loop).
    h.setNext({ kind: 'reply', text: 'ok, steered to the new instruction' });

    // Submit a second message MID-STREAM. The server sees isStreaming and
    // delivers it as a steer into the same session.
    c.send({ type: 'message', message: 'actually do X instead', sessionId });

    // The server acknowledges delivery IMMEDIATELY (message_ack), before the
    // steered user-echo that only comes at the next model call. This is what
    // lets the web client confirm an accepted steer instead of wrongly flipping
    // it to "failed / Retry" when the current turn outlasts the confirm window.
    const ack = await c.waitFor(
      (m) => m.type === 'message_ack' && (m as any).content === 'actually do X instead',
      30_000,
    );
    expect(ack.sessionId).toBe(sessionId);

    // The session must settle cleanly (no session_error from an unqueued/blocked
    // mid-stream send). The steered turn produces at least one more agent_end.
    const settled = await c.waitFor(
      (m) => m.type === 'agent_end' || m.type === 'session_error',
      30_000,
    );
    expect(settled.type).toBe('agent_end');

    // No error surfaced for the mid-stream submit.
    expect(c.messages.some((m) => m.type === 'session_error')).toBe(false);
    // Exactly one session was created (the steer did not fork a new one).
    expect(c.messages.filter((m) => m.type === 'session_created').length).toBe(1);
  }, 60_000);
});

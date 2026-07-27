import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// Bug: a message queued mid-stream (a STEER) lived only in pi's in-memory queue.
// `queue_update` was a live push, emitted only at the moment the queue changed,
// so a client that reloaded (or a second device attaching) got no snapshot: the
// web showed nothing queued, yet pi still injected the message at the next step.
// The user's text was invisible until it suddenly appeared as a delivered turn.
//
// Fix: attaching to a session (`session_load`, which is also the reload/resync
// path) replies with the CURRENT steering queue, so a fresh client renders the
// queued message and can still cancel it.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('a queued steer survives a reload', () => {
  it('sends the current steer queue to a client that attaches mid-stream', async () => {
    h = await startHarness({
      initial: { kind: 'slow-reply', text: 'first turn reply streaming slowly', charDelayMs: 80 },
    });
    const c = await h.connect();

    await c.waitForType('connected');
    c.send({ type: 'session_new', cwd: c.workspace });
    const created = await c.waitForType('session_created');
    const sessionId = created.sessionId as string;
    const sessionFile = created.sessionFile as string;

    c.send({ type: 'message', message: 'do the first thing', sessionId });
    await c.waitForType('agent_start');
    await c.waitForType('message_update');

    // Queue a steer mid-stream and wait until pi reports it queued.
    c.send({ type: 'message', message: 'actually do X instead', sessionId });
    await c.waitFor(
      (m) =>
        m.type === 'queue_update' &&
        Array.isArray((m as any).steering) &&
        (m as any).steering.includes('actually do X instead'),
      30_000,
    );

    // The user reloads: a brand-new socket attaches to the same session. It has
    // seen no live queue_update, so the queue must be part of the attach reply.
    const reloaded = await h.connect();
    await reloaded.waitForType('connected');
    reloaded.send({ type: 'session_load', sessionFile });
    await reloaded.waitForType('session_created');

    const snapshot = await reloaded.waitFor((m) => m.type === 'queue_update', 30_000);
    expect((snapshot as any).sessionId).toBe(sessionId);
    expect((snapshot as any).steering).toContain('actually do X instead');
  }, 60_000);
});

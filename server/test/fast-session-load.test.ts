import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// Step 2 fast-load (docs/plan-speed-up-long-session-load.md): opening a session
// to READ must be instant (a cheap header + transcript read), NOT gated on the
// seconds-long agent build (createAgentSession -> extension/MCP load). The
// server now sends session_created (pending) + message_history from the cheap
// read FIRST, then session_ready once the live agent is built.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

async function seedSession(h: Harness) {
  const c = await h.connect();
  await c.waitForType('connected');
  c.send({ type: 'session_new', cwd: c.workspace });
  const created = await c.waitForType('session_created');
  c.send({ type: 'message', message: 'hello', sessionId: created.sessionId });
  await c.waitFor((m) => m.type === 'message_end' && m.role === 'assistant');
  await c.waitForType('agent_end');
  const sessionFile = created.sessionFile as string;
  const sessionId = created.sessionId as string;
  return { c, sessionFile, sessionId };
}

describe('fast-first session load', () => {
  it('paints history from a cheap read before the agent is ready (cold load)', async () => {
    // Idle timeout of 0 -> the session is evicted the moment its last client
    // leaves, so the reload below is a genuine COLD load (agent must rebuild).
    h = await startHarness({ initial: { kind: 'reply', text: 'hi there' }, idleTimeoutMs: 0 });
    const { c, sessionFile } = await seedSession(h);

    // Drop the seeding client so the session idle-evicts (cold state).
    c.close();
    await new Promise((r) => setTimeout(r, 300));

    // Fresh client loads the (now cold) session.
    const c2 = await h.connect();
    await c2.waitForType('connected');
    c2.send({ type: 'session_load', sessionFile });

    // session_created + message_history arrive (fast read); order: created then history.
    const created = await c2.waitForType('session_created', 10_000);
    expect(created.pending).toBe(true);
    const history = await c2.waitForType('message_history', 10_000);
    expect((history.messages as unknown[]).length).toBeGreaterThan(0);

    // history MUST arrive before session_ready (reading does not wait on the agent).
    const idxHistory = c2.messages.findIndex((m) => m.type === 'message_history');
    let idxReady = c2.messages.findIndex((m) => m.type === 'session_ready');
    if (idxReady === -1) {
      await c2.waitForType('session_ready', 20_000);
      idxReady = c2.messages.findIndex((m) => m.type === 'session_ready');
    }
    expect(idxHistory).toBeGreaterThanOrEqual(0);
    expect(idxHistory).toBeLessThan(idxReady);
  }, 60_000);

  it('becomes sendable again after session_ready (agent rebuilt on reload)', async () => {
    h = await startHarness({ initial: { kind: 'reply', text: 'first' }, idleTimeoutMs: 0 });
    const { c, sessionFile } = await seedSession(h);
    c.close();
    await new Promise((r) => setTimeout(r, 300));

    const c2 = await h.connect();
    await c2.waitForType('connected');
    c2.send({ type: 'session_load', sessionFile });
    const created = await c2.waitForType('session_created', 10_000);
    await c2.waitForType('session_ready', 20_000);

    // Now the live agent exists: a new message streams a reply end-to-end.
    h.setNext({ kind: 'reply', text: 'second reply' });
    c2.send({ type: 'message', message: 'again', sessionId: created.sessionId });
    const end = await c2.waitFor((m) => m.type === 'message_end' && m.role === 'assistant', 30_000);
    expect(end.content).toBe('second reply');
  }, 60_000);

  it('a warm (resident) session loads without a pending phase', async () => {
    // Large idle timeout: the session stays resident, so reload is a warm read
    // and session_created is NOT pending.
    h = await startHarness({ initial: { kind: 'reply', text: 'warm' }, idleTimeoutMs: 300_000 });
    const { c, sessionFile } = await seedSession(h);

    // Same client leaves the session (but the pool keeps it warm) and reloads.
    c.send({ type: 'session_leave', sessionId: (await c.waitForType('session_created')).sessionId });
    c.send({ type: 'session_load', sessionFile });
    const created = await c.waitFor(
      (m) => m.type === 'session_created' && m.sessionFile === sessionFile && m.pending !== true,
      10_000,
    );
    expect(created.pending).not.toBe(true);
    await c.waitForType('session_ready', 10_000);
  }, 60_000);
});

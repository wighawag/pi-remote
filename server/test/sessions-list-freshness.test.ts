import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// End-to-end guard for the CACHED /sessions listing: caching the parsed session
// files (keyed by mtime+size) is what stops the list scan from re-reading the
// whole sessions directory on every request, but it must never serve a stale
// list. A session that was just created, or that just gained a turn, has to
// show up on the very next GET /sessions.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

interface ListedSession {
  path: string;
  id: string;
  messageCount: number;
  firstMessage: string;
}

async function listSessions(port: number): Promise<ListedSession[]> {
  const res = await fetch(`http://127.0.0.1:${port}/sessions`);
  expect(res.ok).toBe(true);
  const data = (await res.json()) as { folders: Array<{ sessions: ListedSession[] }> };
  return data.folders.flatMap((f) => f.sessions);
}

describe('GET /sessions freshness with the listing cache', () => {
  it('reflects a new session and each new turn on the next request', async () => {
    h = await startHarness({ initial: { kind: 'reply', text: 'first reply' } });
    const c = await h.connect();
    await c.waitForType('connected');

    // A brand-new session must appear even though the cache was warmed at
    // startup, before this file existed.
    c.send({ type: 'session_new', cwd: c.workspace });
    const created = await c.waitForType('session_created');
    const sessionFile = created.sessionFile as string;

    c.send({ type: 'message', message: 'hello there', sessionId: created.sessionId });
    await c.waitForType('agent_end');

    let listed = await listSessions(h.port);
    const mine = listed.find((s) => s.path === sessionFile);
    expect(mine, `new session ${sessionFile} missing from /sessions`).toBeDefined();
    expect(mine!.firstMessage).toBe('hello there');
    const afterFirstTurn = mine!.messageCount;
    expect(afterFirstTurn).toBeGreaterThan(0);

    // A second turn APPENDS to the same file: the cache must notice the change
    // (mtime+size) and re-parse rather than serve the previous count.
    h.setNext({ kind: 'reply', text: 'second reply' });
    c.send({ type: 'message', message: 'again', sessionId: created.sessionId });
    await c.waitFor(
      (m) => m.type === 'agent_end' && c.messages.filter((x) => x.type === 'agent_end').length >= 2,
    );

    listed = await listSessions(h.port);
    const updated = listed.find((s) => s.path === sessionFile);
    expect(updated).toBeDefined();
    expect(updated!.messageCount).toBeGreaterThan(afterFirstTurn);
    // The preview still tracks the FIRST user message, not the latest one.
    expect(updated!.firstMessage).toBe('hello there');
  }, 90_000);

  it('serves repeated requests consistently (warm cache hits)', async () => {
    h = await startHarness({ initial: { kind: 'reply', text: 'ok' } });
    const c = await h.connect();
    await c.waitForType('connected');
    c.send({ type: 'session_new', cwd: c.workspace });
    const created = await c.waitForType('session_created');
    c.send({ type: 'message', message: 'hi', sessionId: created.sessionId });
    await c.waitForType('agent_end');

    const [a, b, d] = await Promise.all([
      listSessions(h.port),
      listSessions(h.port),
      listSessions(h.port),
    ]);
    expect(b).toEqual(a);
    expect(d).toEqual(a);
  }, 90_000);
});

import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// Regression: "New Session Here" sometimes redirected to the folder's ALREADY
// ACTIVE session with the "Read-only: this session cannot be driven from here"
// banner, for a user who was the only viewer.
//
// Cause: a client that loses its socket silently (phone sleep, wifi -> cellular,
// any half-open TCP) reconnects on a NEW socket with a new server-side client
// id, while the old record stays attached to the session until the heartbeat
// reaper notices (up to 2x HEARTBEAT_MS later). During that window `session_new`
// saw "another viewer holds this folder" and, by design for real conflicts,
// attached the client read-only to the existing session instead of creating one.
//
// Fix: the client carries a stable per-viewer key (per TAB in the browser) on
// the connect URL; the server retires that key's previous connection on connect.
// A reconnect can therefore never be mistaken for a second viewer, while two
// genuinely different viewers still conflict exactly as before.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('new session in an occupied folder', () => {
  it('creates a fresh session when the occupant is this viewer\'s own superseded connection', async () => {
    h = await startHarness({ idleTimeoutMs: 300_000 });
    const cwd = h.workspace + '/phantom';

    // First connection: create a session in the folder, then vanish WITHOUT a
    // close frame (the socket object stays open here, which is exactly what the
    // server sees during a half-open drop: a still-registered client).
    const first = await h.connect('tab-1');
    await first.waitForType('connected');
    first.send({ type: 'session_new', cwd });
    const created = await first.waitForType('session_created');
    const firstFile = created.sessionFile as string;

    // Reconnect as the SAME viewer and immediately ask for a new session here.
    const second = await h.connect('tab-1');
    await second.waitForType('connected');
    second.send({ type: 'session_new', cwd });
    const reply = await second.waitForType('session_created');

    expect(reply.readOnly).toBeFalsy();
    expect(reply.folderConflict).toBeFalsy();
    expect(reply.sessionFile).not.toBe(firstFile);
  }, 60_000);

  it('tells the superseded connection why it is going away, before killing it', async () => {
    // Two LIVE clients can end up sharing a key (duplicating a browser tab clones
    // sessionStorage). The retired one must be told, so it can take a fresh key
    // instead of evicting the other one right back, forever. The notice therefore
    // has to SURVIVE the teardown: terminate() discards buffered data, so it is
    // deferred until the frame has actually flushed.
    h = await startHarness({ idleTimeoutMs: 300_000 });
    const first = await h.connect('tab-1');
    await first.waitForType('connected');
    const closed = first.closedPromise();

    const second = await h.connect('tab-1');
    await second.waitForType('connected');

    await first.waitForType('connection_superseded');
    // ...and the socket really is retired, not merely notified.
    await closed;
  }, 60_000);

  it('still warns + starts read-only when a genuinely different viewer holds the folder, on a session of its OWN', async () => {
    h = await startHarness({ idleTimeoutMs: 300_000 });
    const cwd = h.workspace + '/occupied';

    const owner = await h.connect('tab-1');
    await owner.waitForType('connected');
    owner.send({ type: 'session_new', cwd });
    const created = await owner.waitForType('session_created');

    const other = await h.connect('tab-2');
    await other.waitForType('connected');
    other.send({ type: 'session_new', cwd });
    const reply = await other.waitForType('session_created');

    // The folder is shared, so the conflict protection still applies...
    expect(reply.readOnly).toBe(true);
    expect(reply.folderConflict).toBe(true);
    // ...but it applies to the NEW conversation that was asked for. Landing in
    // the occupant's conversation answers a question nobody asked, and leaves
    // "Continue anyway" unlocking the wrong session.
    expect(reply.sessionFile).not.toBe(created.sessionFile);
  }, 60_000);

  it('creates a fresh session even while the asker is reading one in that folder', async () => {
    // The reported bug: with a conversation open in the folder, "new conversation
    // here" bounced the user back into a conversation that already existed (their
    // own, or the other viewer's) with a "another client is active" banner. An
    // explicit new-conversation request must never hand back an old conversation.
    h = await startHarness({ idleTimeoutMs: 300_000 });
    const cwd = h.workspace + '/busy';

    const other = await h.connect('tab-2');
    await other.waitForType('connected');
    other.send({ type: 'session_new', cwd });
    const occupant = await other.waitForType('session_created');

    // Me: open that same folder's occupied session (read-only observer), which is
    // where the sidebar's "+" is clicked from.
    const me = await h.connect('tab-1');
    await me.waitForType('connected');
    me.send({ type: 'session_load', sessionFile: occupant.sessionFile, cwd });
    await me.waitForType('session_created');

    me.send({ type: 'session_new', cwd });
    const mine = await me.waitFor(
      (m) => m.type === 'session_created' && m.sessionFile !== occupant.sessionFile,
    );
    expect(mine.sessionFile).not.toBe(occupant.sessionFile);
    expect(mine.cwd).toBe(occupant.cwd);
  }, 60_000);
});

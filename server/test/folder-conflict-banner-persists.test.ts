import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// Regression: a client attached read-only by a folder conflict was left with NO
// way to continue.
//
// `session_new` in an occupied folder attaches the client read-only to the
// occupant's session and replies `folderConflict: true`, which raises the
// warning banner carrying the "Continue anyway" button. But the very same
// attach triggers a sessions-updated broadcast, and broadcastFolderConflicts
// scanned for another session FILE in the folder while SKIPPING the client's
// own file -- which is precisely the file it was just attached to. So it
// reported `active: false`, the client dropped the banner (and its button), and
// the read-only state stayed on with nothing left to lift it.
//
// A conflict is now tracked per CLIENT (conflictObserver), so the live update
// keeps reporting active while the occupant is still there, and it carries the
// server's authoritative readOnly so a resolved conflict releases the composer.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('folder-conflict banner for a read-only observer', () => {
  it('stays active after attaching, so "Continue anyway" survives', async () => {
    h = await startHarness({ idleTimeoutMs: 300_000 });
    const cwd = h.workspace + '/occupied';

    const owner = await h.connect('tab-owner');
    await owner.waitForType('connected');
    owner.send({ type: 'session_new', cwd });
    await owner.waitForType('session_created');

    const observer = await h.connect('tab-observer');
    await observer.waitForType('connected');
    observer.send({ type: 'session_new', cwd });
    const created = await observer.waitForType('session_created');
    expect(created.readOnly).toBe(true);
    expect(created.folderConflict).toBe(true);

    // The live update that follows the attach must CONFIRM the conflict, not
    // cancel it (cancelling is what removed the "Continue anyway" affordance).
    const update = await observer.waitForType('folder_conflict');
    expect(update.active).toBe(true);
    expect(update.readOnly).toBe(true);
    expect(
      observer.messages.filter((m) => m.type === 'folder_conflict' && m.active === false),
    ).toHaveLength(0);
  }, 60_000);

  it('refuses a read-only send out loud instead of swallowing it', async () => {
    // The client hides its composer only while it AGREES it is read-only, so any
    // desync of that agreement used to make text vanish with no error at all.
    h = await startHarness({ idleTimeoutMs: 300_000 });
    const cwd = h.workspace + '/occupied';

    const owner = await h.connect('tab-owner');
    await owner.waitForType('connected');
    owner.send({ type: 'session_new', cwd });
    await owner.waitForType('session_created');

    const observer = await h.connect('tab-observer');
    await observer.waitForType('connected');
    observer.send({ type: 'session_new', cwd });
    const created = await observer.waitForType('session_created');
    expect(created.readOnly).toBe(true);

    observer.send({ type: 'message', message: 'this must not vanish', sessionId: created.sessionId });
    const settled = await observer.waitFor(
      (m) => m.type === 'session_error' || m.type === 'agent_start',
      15_000,
    );
    expect(settled.type).toBe('session_error');
    expect(String(settled.error)).toMatch(/read-only/i);
  }, 60_000);

  it('releases read-only once the other client leaves the folder', async () => {
    h = await startHarness({ idleTimeoutMs: 300_000 });
    const cwd = h.workspace + '/occupied';

    const owner = await h.connect('tab-owner');
    await owner.waitForType('connected');
    owner.send({ type: 'session_new', cwd });
    const ownerCreated = await owner.waitForType('session_created');

    const observer = await h.connect('tab-observer');
    await observer.waitForType('connected');
    observer.send({ type: 'session_new', cwd });
    await observer.waitForType('session_created');
    await observer.waitFor((m) => m.type === 'folder_conflict' && m.active === true);

    // The occupant leaves: the observer is now alone in the folder, so the
    // conflict is over and its read-only must be released (otherwise the
    // composer stays observe-only forever with no banner left to lift it).
    owner.send({ type: 'session_leave', sessionId: ownerCreated.sessionId });
    const resolved = await observer.waitFor(
      (m) => m.type === 'folder_conflict' && m.active === false,
    );
    expect(resolved.readOnly).toBe(false);
  }, 60_000);
});

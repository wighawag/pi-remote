import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// "Continue anyway" must actually stick, and the server must say so.
//
// Regression 1 (cold load): loading a NON-RESIDENT session in an occupied folder
// paints immediately (read-only, folderConflict) and builds the agent in the
// background, attaching only at the end. A Continue clicked during that window
// hit two walls: the handler resolved the cwd from the not-yet-attached session
// and bailed out, and the build's completion path re-derived read-only from the
// conflict state captured before it. Either way the client was left read-only.
// `session_ready` carries no readOnly, so the composer looked enabled while
// `message` dropped every send in silence (no session_error), with the banner's
// button already gone.
//
// Regression 2 (race): a folder_conflict broadcast emitted just before the
// server processed the continue carries the pre-continue readOnly:true. The
// client mirrors the server's readOnly, so it would re-lock with `continued`
// already true, i.e. no button left. The server now answers every continue with
// an authoritative folder_conflict on the same socket, which by ordering always
// lands last.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('continue anyway', () => {
  it('is answered with an authoritative folder_conflict carrying readOnly:false', async () => {
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

    observer.send({ type: 'folder_conflict_continue', sessionId: created.sessionId });
    const ack = await observer.waitFor(
      (m) => m.type === 'folder_conflict' && m.readOnly === false,
    );
    // Still a conflict (the occupant has not left), but no longer read-only: the
    // banner stays as a passive warning and the composer is live.
    expect(ack.active).toBe(true);
  }, 60_000);

  it('survives the cold agent build and the session is really sendable', async () => {
    // Short idle timeout so the first session is EVICTED (non-resident) by the
    // time we load it again, which is what selects the cold/fast-paint path.
    h = await startHarness({ initial: { kind: 'reply', text: 'delivered' }, idleTimeoutMs: 1_000 });
    const cwd = h.workspace + '/cold';

    // Session S in the folder, then leave so it can be evicted. It must hold a
    // real turn first: a session file with no entries records no cwd, so a later
    // cold read cannot place it in this folder (and would see no conflict).
    const first = await h.connect('tab-first');
    await first.waitForType('connected');
    first.send({ type: 'session_new', cwd });
    const s = await first.waitForType('session_created');
    first.send({ type: 'message', message: 'seed the session file', sessionId: s.sessionId });
    await first.waitForType('agent_end', 30_000);
    first.send({ type: 'session_leave', sessionId: s.sessionId });
    await new Promise((r) => setTimeout(r, 3_000));

    // Another client occupies the folder with its own session.
    const occupant = await h.connect('tab-occupant');
    await occupant.waitForType('connected');
    occupant.send({ type: 'session_new', cwd });
    await occupant.waitForType('session_created');

    // Load the evicted session and continue immediately, without waiting for the
    // attach. How the two interleave with the agent build is up to the machine --
    // before the paint, between paint and attach, or after -- and the point of
    // the durable intent is that EVERY interleaving must end the same way. (On a
    // fast machine the build can win the race, in which case this exercises the
    // easy ordering; it was verified red against the pre-fix server by slowing
    // the build down so the continue always lands mid-build.)
    //
    // This ALSO pins the earliest interleaving of the three: both frames arrive
    // together, so the continue is handled while `session_load` is still awaiting
    // its (streamed, off-thread) transcript read -- i.e. BEFORE `pendingCwd`
    // exists. The handler used to `return` when it could not resolve a cwd,
    // dropping the click and leaving the user read-only with the banner's button
    // already gone; it now records the intent regardless and re-derives
    // read-only at attach, where the sessions.readOnly guard still applies. This
    // test fails against a server without that fix.
    const observer = await h.connect('tab-observer');
    await observer.waitForType('connected');
    observer.send({ type: 'session_load', sessionFile: s.sessionFile, cwd });
    observer.send({ type: 'folder_conflict_continue', sessionId: s.sessionId });
    const painted = await observer.waitForType('session_created');
    expect(painted.pending).toBe(true); // the test is only meaningful when cold
    expect(painted.readOnly).toBe(true);
    const ready = await observer.waitForType('session_ready');
    expect(ready.sessionId).toBe(painted.sessionId);
    // The attach states the verdict explicitly instead of leaving the composer to
    // wait for the throttled periodic broadcast.
    const verdict = await observer.waitFor(
      (m) => m.type === 'folder_conflict' && m.readOnly === false,
    );
    expect(verdict.active).toBe(true);

    // The send must be delivered, not silently dropped by a re-imposed read-only.
    observer.send({ type: 'message', message: 'hello', sessionId: painted.sessionId });
    const settled = await observer.waitFor(
      (m) => m.type === 'agent_start' || m.type === 'session_error',
      20_000,
    );
    expect(settled.type).toBe('agent_start');
  }, 90_000);
});

import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// The client confirms an optimistic (unconfirmed) user message when the server
// echoes it back. This asserts the server ACTUALLY emits a message_end with
// role:'user' carrying the same content, so the confirmation signal the client
// relies on exists end-to-end (server/src/index.ts broadcastAgentEvent handles
// message_end for role user).

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('server echoes the user message back', () => {
  it('emits message_end role:user with the same content', async () => {
    h = await startHarness({ initial: { kind: 'reply', text: 'noted' } });
    const c = await h.connect();

    await c.waitForType('connected');
    c.send({ type: 'session_new', cwd: c.workspace });
    const created = await c.waitForType('session_created');

    c.send({ type: 'message', message: 'please remember this', sessionId: created.sessionId });

    const echo = await c.waitFor(
      (m) => m.type === 'message_end' && m.role === 'user',
      30_000,
    );
    expect(echo.content).toBe('please remember this');
  }, 60_000);
});

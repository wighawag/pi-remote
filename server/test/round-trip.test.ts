import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// The foundation smoke: the real server + real pi harness + fake LLM, end to
// end. Proves the deterministic gate substrate works (ADR 0001) and that a
// streamed round-trip and a mid-stream cut both settle.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('real server + real pi harness + fake LLM', () => {
  it('streams a deterministic agent reply end-to-end', async () => {
    h = await startHarness({ initial: { kind: 'reply', text: 'hello from fake' } });
    const c = await h.connect();

    await c.waitForType('connected');
    c.send({ type: 'session_new', cwd: c.workspace });
    const created = await c.waitForType('session_created');
    const sessionId = created.sessionId as string;

    c.send({ type: 'message', message: 'hi', sessionId });

    await c.waitForType('agent_start');
    const end = await c.waitFor((m) => m.type === 'message_end' && m.role === 'assistant');
    await c.waitForType('agent_end');

    expect(c.streamedText()).toBe('hello from fake');
    expect(end.content).toBe('hello from fake');
  }, 60_000);

  it('reproduces "pi stops midway": upstream cuts the SSE stream mid-response', async () => {
    h = await startHarness({
      initial: { kind: 'cut-midway', text: 'this reply gets cut off here and never finishes', cutAfter: 12 },
    });
    const c = await h.connect();

    await c.waitForType('connected');
    c.send({ type: 'session_new', cwd: c.workspace });
    const created = await c.waitForType('session_created');

    c.send({ type: 'message', message: 'hi', sessionId: created.sessionId });
    await c.waitForType('agent_start');

    // The turn MUST settle (agent_end and/or session_error) even though the
    // upstream died mid-stream.
    const settled = await c.waitFor(
      (m) => m.type === 'agent_end' || m.type === 'session_error',
      30_000,
    );

    expect(c.streamedText().length).toBeGreaterThan(0);
    expect(c.streamedText().length).toBeLessThan(
      'this reply gets cut off here and never finishes'.length,
    );
    expect(['agent_end', 'session_error']).toContain(settled.type);
  }, 60_000);
});

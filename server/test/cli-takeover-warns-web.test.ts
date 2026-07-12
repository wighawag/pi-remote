import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// Bug: when a pi CLI resumes/registers a session that the standalone server is
// CURRENTLY running for a web viewer, the CLI seizes control and the server
// disposes its live agent MID-TURN. Disposing mid-turn discards the whole
// in-flight turn WITHOUT persisting it (persistence only happens on
// message_end), so the web viewer, who was watching a tool run or a reply
// stream, loses it silently and saw no explanation.
//
// The fix: on cli_register, if the server agent was mid-turn (interruptedTurn),
// the server sends the attached web clients a `session_notice` (level: warning),
// tailored to whether a tool call (its result never arrives) or streaming text
// (the partial reply is discarded) was interrupted. A takeover of an already
// SETTLED (idle) session is not warned, since nothing was in flight.

let h: Harness | undefined;
afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

describe('CLI takeover of a mid-run server session', () => {
  it('warns the web viewer when a TOOL CALL was interrupted by the takeover', async () => {
    // The server-side agent will execute a bash `sleep`, giving a wide,
    // deterministic window where a tool call is genuinely in flight.
    h = await startHarness({
      initial: {
        kind: 'tool-call',
        toolName: 'bash',
        input: { command: 'sleep 10' },
      },
    });

    const viewer = await h.connect();
    await viewer.waitForType('connected');
    viewer.send({ type: 'session_new', cwd: viewer.workspace });
    const created = await viewer.waitForType('session_created');
    const sessionId = created.sessionId as string;
    const sessionFile = created.sessionFile as string;

    viewer.send({ type: 'message', message: 'run it', sessionId });
    // Wait until the tool is actually executing (tool_start), so a tool call is
    // in flight when the CLI takes over.
    await viewer.waitForType('tool_start', 20_000);

    // A pi CLI resumes/registers the SAME session, taking over and disposing the
    // server-side agent while the bash sleep is still running.
    const cli = await h.connect();
    await cli.waitForType('connected');
    cli.send({
      type: 'cli_register',
      sessionFile,
      cwd: cli.workspace,
      model: 'fake:fake-model',
      isStreaming: true,
    });

    const notice = await viewer.waitForType('session_notice', 20_000);
    expect(notice.level).toBe('warning');
    expect(String(notice.message)).toMatch(/tool call/i);

    // The registering CLI is told explicitly it took over a mid-run turn, with
    // the tool-call flavour, so it can surface the takeover on its side too.
    const cliNotice = await cli.waitForType('cli_takeover_interrupted', 20_000);
    expect(cliNotice.toolCall).toBe(true);
  }, 60_000);

  it('warns the web viewer when a streaming REPLY (no tool call) was interrupted', async () => {
    // A slow text reply keeps the server-side turn streaming (no tool call). A
    // takeover here discards the partial reply without persisting it, so the
    // viewer, who watched text appear then stop, must be warned too.
    h = await startHarness({
      initial: { kind: 'slow-reply', text: 'a'.repeat(400), charDelayMs: 40 },
    });

    const viewer = await h.connect();
    await viewer.waitForType('connected');
    viewer.send({ type: 'session_new', cwd: viewer.workspace });
    const created = await viewer.waitForType('session_created');
    const sessionId = created.sessionId as string;
    const sessionFile = created.sessionFile as string;

    viewer.send({ type: 'message', message: 'hi', sessionId });
    await viewer.waitForType('agent_start');
    // Ensure text is actively streaming (mid-turn) before the takeover.
    await viewer.waitForType('message_update', 20_000);

    const cli = await h.connect();
    await cli.waitForType('connected');
    cli.send({
      type: 'cli_register',
      sessionFile,
      cwd: cli.workspace,
      model: 'fake:fake-model',
      isStreaming: true,
    });

    const notice = await viewer.waitForType('session_notice', 20_000);
    expect(notice.level).toBe('warning');
    // The streaming-text wording, not the tool-call wording.
    expect(String(notice.message)).toMatch(/reply/i);
    expect(String(notice.message)).not.toMatch(/tool call/i);

    // The registering CLI is told, with toolCall=false, since only text was
    // streaming. This is the case the CLI's own transcript heuristic cannot see.
    const cliNotice = await cli.waitForType('cli_takeover_interrupted', 20_000);
    expect(cliNotice.toolCall).toBe(false);
  }, 60_000);

  it('does NOT warn when the CLI registers an idle (settled) server session', async () => {
    h = await startHarness({ initial: { kind: 'reply', text: 'done' } });

    const viewer = await h.connect();
    await viewer.waitForType('connected');
    viewer.send({ type: 'session_new', cwd: viewer.workspace });
    const created = await viewer.waitForType('session_created');
    const sessionId = created.sessionId as string;
    const sessionFile = created.sessionFile as string;

    // Run a turn to completion so the server-side agent is idle.
    viewer.send({ type: 'message', message: 'hi', sessionId });
    await viewer.waitForType('agent_end');

    const cli = await h.connect();
    await cli.waitForType('connected');
    cli.send({
      type: 'cli_register',
      sessionFile,
      cwd: cli.workspace,
      model: 'fake:fake-model',
      isStreaming: false,
    });

    await viewer.waitFor(
      (m) => m.type === 'session_created' && (m.sessionFile as string) === sessionFile,
      20_000,
    );
    await new Promise((r) => setTimeout(r, 500));
    const gotNotice = viewer.messages.some((m) => m.type === 'session_notice');
    expect(gotNotice).toBe(false);
    // The CLI must not be told it interrupted anything either.
    const cliTold = cli.messages.some((m) => m.type === 'cli_takeover_interrupted');
    expect(cliTold).toBe(false);
  }, 60_000);
});

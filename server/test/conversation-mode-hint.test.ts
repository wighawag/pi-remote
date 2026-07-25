import { describe, it, expect } from 'vitest';
import {
  CONVERSATION_MODE_HINT,
  appendConversationModeHint,
  createConversationModeSignal,
} from '../src/conversation-mode-hint.ts';
// The CLI-bridge twin. It lives in the `@wherever-dev/pi` extension, a separate
// published package that cannot import from the server (the same constraint that
// makes the `say` tool a duplicate), so the guard against drift is this test:
// it holds both copies to the SAME text and the SAME latch behaviour.
import {
  CONVERSATION_MODE_HINT as EXTENSION_HINT,
  createConversationModeSignal as createExtensionSignal,
} from '../../extension/src/conversation-mode-hint.ts';

// Unit tests for the per-turn conversation-mode SIGNAL: the `before_agent_start`
// hook that tells the agent a spoken conversation is active so it also calls
// `say`. The contract is narrow on purpose: APPEND to the system prompt the event
// carries (never replace, never re-fetch), only for a turn whose message carried
// the flag, and once.

type Handler = (event: { systemPrompt: string }) => { systemPrompt?: string } | void;

/** A minimal fake pi ExtensionAPI that just captures the registered handler. */
function loadInlineExtension() {
  const signal = createConversationModeSignal();
  const handlers = new Map<string, Handler>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
  };
  const inline = signal.inlineExtension as { name: string; factory: (pi: unknown) => void };
  inline.factory(pi);
  const handler = handlers.get('before_agent_start');
  if (!handler) throw new Error('the inline extension did not register before_agent_start');
  return { signal, handler, name: inline.name };
}

describe('appendConversationModeHint', () => {
  it('appends the hint to the provided base, preserving it verbatim', () => {
    const base = 'You are pi.\n\n## Tools\nread, bash';
    const result = appendConversationModeHint(base);
    expect(result.startsWith(base)).toBe(true);
    expect(result.endsWith(CONVERSATION_MODE_HINT)).toBe(true);
    expect(result).toBe(`${base}\n\n${CONVERSATION_MODE_HINT}`);
  });

  it('tells the agent to ALSO call say, in addition to the written answer', () => {
    const hint = CONVERSATION_MODE_HINT.toLowerCase();
    expect(hint).toContain('say');
    expect(hint).toContain('in addition');
    expect(hint).toContain('spoken');
  });
});

describe('the conversation-mode before_agent_start handler', () => {
  it('appends nothing when the turn was not armed (mode off / flag absent)', () => {
    const { handler } = loadInlineExtension();
    const result = handler({ systemPrompt: 'BASE' });
    expect(result).toBeUndefined();
  });

  it('appends the hint to the system prompt the event carries when armed', () => {
    const { signal, handler } = loadInlineExtension();
    signal.arm(true);
    const result = handler({ systemPrompt: 'BASE' });
    expect(result?.systemPrompt).toBe(`BASE\n\n${CONVERSATION_MODE_HINT}`);
  });

  it('appends to the value the event carries, not a snapshot (SDK chains extensions)', () => {
    const { signal, handler } = loadInlineExtension();
    signal.arm(true);
    // Another extension already modified the prompt for this turn; ours must build
    // on THAT value rather than on the pristine base.
    const chained = handler({ systemPrompt: 'BASE\n\nFROM ANOTHER EXTENSION' });
    expect(chained?.systemPrompt).toBe(
      `BASE\n\nFROM ANOTHER EXTENSION\n\n${CONVERSATION_MODE_HINT}`,
    );
  });

  it('consumes the arming so the hint cannot leak into a later unflagged turn', () => {
    const { signal, handler } = loadInlineExtension();
    signal.arm(true);
    expect(signal.isArmed()).toBe(true);
    expect(handler({ systemPrompt: 'BASE' })?.systemPrompt).toContain(CONVERSATION_MODE_HINT);
    expect(signal.isArmed()).toBe(false);
    // Next turn (e.g. a plain typed message, or an auto-retry): nothing appended.
    expect(handler({ systemPrompt: 'BASE' })).toBeUndefined();
  });

  it('disarms when the next message carries no flag (latest message wins)', () => {
    const { signal, handler } = loadInlineExtension();
    signal.arm(true);
    signal.arm(false);
    expect(handler({ systemPrompt: 'BASE' })).toBeUndefined();
  });
});

describe('lockstep with the CLI-bridge extension twin', () => {
  it('injects the identical hint text', () => {
    expect(EXTENSION_HINT).toBe(CONVERSATION_MODE_HINT);
  });

  it('appends identically, given the same base prompt', () => {
    const server = createConversationModeSignal();
    const extension = createExtensionSignal();
    server.arm(true);
    extension.arm(true);
    const base = 'BASE\n\nFROM ANOTHER EXTENSION';
    expect(extension.applyToSystemPrompt(base)).toBe(server.applyToSystemPrompt(base));
  });

  it('has the same latch behaviour: nothing unarmed, once when armed', () => {
    const extension = createExtensionSignal();
    expect(extension.applyToSystemPrompt('BASE')).toBeUndefined();
    extension.arm(true);
    expect(extension.applyToSystemPrompt('BASE')).toBe(appendConversationModeHint('BASE'));
    expect(extension.isArmed()).toBe(false);
    expect(extension.applyToSystemPrompt('BASE')).toBeUndefined();
    extension.arm(true);
    extension.arm(false);
    expect(extension.applyToSystemPrompt('BASE')).toBeUndefined();
  });

  it('the extension registers a before_agent_start handler wired to that latch', async () => {
    // The wiring itself (pi.on + arming from cli_message) lives in the extension's
    // big default export, which needs a whole pi runtime to load; assert the two
    // load-bearing lines are present so the twin cannot be left unwired.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../extension/src/index.ts', import.meta.url), 'utf-8'),
    );
    expect(source).toContain('pi.on("before_agent_start"');
    expect(source).toContain('conversationSignal.applyToSystemPrompt(event.systemPrompt)');
    expect(source).toContain('conversationSignal.arm(msg.conversationMode === true)');
  });
});

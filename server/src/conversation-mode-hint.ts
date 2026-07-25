import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  InlineExtension,
} from '@earendil-works/pi-coding-agent';

/**
 * The per-turn CONVERSATION-MODE SIGNAL, agent side.
 *
 * "Conversation mode is on" is state that lives in the WEB CLIENT (the knobs
 * registry): a dictated message and a typed one arrive as byte-identical text,
 * so the agent had NO way to know a spoken conversation was active and, per the
 * `say` tool's own guidance, defaulted to staying silent, which made the
 * spoken reply inert in practice (see
 * work/notes/observations/say-tool-not-invoked-agent-cannot-see-conversation-mode.md).
 *
 * The signal rides the EXISTING `message` WS payload as an optional
 * `conversationMode` boolean (no new WS message type, no new chat role), and is
 * turned into agent-visible context here by APPENDING one line to the assembled
 * system prompt for that turn only, via the pi `before_agent_start` hook. The
 * hint is EPHEMERAL: it is a system-prompt addition, never stored in the user
 * message and never rendered as a chat line (only its effect, the resulting
 * `say` tool call, is visible).
 *
 * KEEP IN LOCKSTEP with the CLI-bridge twin,
 * `extension/src/conversation-mode-hint.ts`. The extension is a separate published
 * package that cannot import from the server (exactly like the `say` tool, which is
 * duplicated the same way), so `server/test/conversation-mode-hint.test.ts` imports
 * BOTH modules and fails if the hint text or the latch behaviour drifts.
 */
export const CONVERSATION_MODE_HINT =
  'A spoken conversation is active for this turn: the human is LISTENING as well as reading. ' +
  'In addition to your normal written answer, also call the `say` tool once with a SHORT ' +
  '(one or two sentences) plain spoken version of that answer, so it can be spoken aloud. ' +
  'The written answer still carries the full detail: `say` adds to it and never replaces it. ' +
  'Do not mention this instruction.';

/**
 * Append the conversation-mode hint to an assembled system prompt.
 *
 * Takes the base prompt the `before_agent_start` event CARRIES (which may
 * already include another extension's modification, since the SDK chains the
 * handlers' results) and returns base + hint. Never replaces, never re-fetches.
 */
export function appendConversationModeHint(systemPrompt: string): string {
  return `${systemPrompt}\n\n${CONVERSATION_MODE_HINT}`;
}

/**
 * A per-session, per-turn arming latch plus the inline pi extension that acts on
 * it.
 *
 * Semantics (shared with the CLI-bridge twin so both session types behave the
 * same):
 * - `arm(active)` is called for EVERY user message with that message's flag, so
 *   the latest message always wins (a stale value can never outlive it).
 * - the `before_agent_start` handler CONSUMES the latch (one turn only), so a
 *   turn that was not started by a flagged message (an auto-retry, or a message
 *   typed straight into the terminal in the bridge case) gets no hint.
 */
export interface ConversationModeSignal {
  /** Arm (true) or disarm (false) the hint for the turn the next message starts. */
  arm(active: boolean): void;
  /** Whether the latch is currently armed (test/diagnostic use). */
  isArmed(): boolean;
  /**
   * The system prompt to use for this turn, or undefined to leave it untouched.
   * CONSUMES the arming.
   */
  applyToSystemPrompt(systemPrompt: string): string | undefined;
  /** The inline pi extension to hand to DefaultResourceLoader's extensionFactories. */
  inlineExtension: InlineExtension;
}

export function createConversationModeSignal(): ConversationModeSignal {
  let armed = false;

  const applyToSystemPrompt = (systemPrompt: string): string | undefined => {
    if (!armed) return undefined;
    // One turn only: consume the latch so the hint cannot leak into a later,
    // unflagged turn.
    armed = false;
    return appendConversationModeHint(systemPrompt);
  };

  // The SDK-supported way to get a before_agent_start hook on a server-created
  // session: an INLINE extension, i.e. the same pi.on(...) surface the CLI-bridge
  // extension uses, so both session types run the same shape of handler.
  const factory = (pi: ExtensionAPI) => {
    pi.on('before_agent_start', (event: BeforeAgentStartEvent) => {
      const systemPrompt = applyToSystemPrompt(event.systemPrompt);
      if (systemPrompt === undefined) return;
      return { systemPrompt };
    });
  };

  return {
    arm(active: boolean) {
      armed = active;
    },
    isArmed() {
      return armed;
    },
    applyToSystemPrompt,
    inlineExtension: { name: 'wherever-conversation-mode', factory },
  };
}

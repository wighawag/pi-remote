/**
 * The per-turn CONVERSATION-MODE SIGNAL, CLI-bridge side.
 *
 * "Conversation mode is on" lives in the WEB CLIENT (its knobs registry), and a
 * dictated message is byte-identical to a typed one, so without a signal the agent
 * cannot tell a spoken conversation is active and - per the `say` tool's own
 * guidance - stays silent, which made the spoken reply inert in practice (see
 * work/notes/observations/say-tool-not-invoked-agent-cannot-see-conversation-mode.md).
 *
 * The web client stamps an optional `conversationMode` boolean on the EXISTING
 * `message` WS payload (no new message type, no new chat role). For a bridged
 * terminal session the server relays it on `cli_message`; this module turns it into
 * agent-visible context by APPENDING one line to the system prompt the pi
 * `before_agent_start` event carries, for that turn only. The hint is EPHEMERAL: a
 * system-prompt addition is never stored in the user message and never renders as a
 * chat line on web or CLI - only its effect (the resulting `say` call) is visible.
 *
 * KEEP IN LOCKSTEP with the server twin, `server/src/conversation-mode-hint.ts`.
 * The extension is a separate published package and cannot import from the server
 * (the same constraint that makes the `say` tool a duplicate), so
 * `server/test/conversation-mode-hint.test.ts` imports BOTH modules and fails if
 * either the hint text or the latch behaviour drifts.
 */
export const CONVERSATION_MODE_HINT =
  "A spoken conversation is active for this turn: the human is LISTENING as well as reading. " +
  "In addition to your normal written answer, also call the `say` tool once with a SHORT " +
  "(one or two sentences) plain spoken version of that answer, so it can be spoken aloud. " +
  "The written answer still carries the full detail: `say` adds to it and never replaces it. " +
  "Do not mention this instruction.";

/**
 * Append the hint to an assembled system prompt. Takes the base the event CARRIES
 * (which may already include another extension's change, since the SDK chains the
 * handlers' results) and returns base + hint. Never replaces, never re-fetches.
 */
export function appendConversationModeHint(systemPrompt: string): string {
  return `${systemPrompt}\n\n${CONVERSATION_MODE_HINT}`;
}

/**
 * A per-turn arming latch.
 *
 * - `arm(active)` is called for EVERY relayed user message with that message's
 *   flag, so the latest message always wins.
 * - `applyToSystemPrompt` CONSUMES the arming (one turn only), so a turn that was
 *   not started by a flagged message - a message typed straight into this terminal,
 *   or an auto-retry - never inherits a stale signal.
 */
export interface ConversationModeSignal {
  arm(active: boolean): void;
  isArmed(): boolean;
  /**
   * The system prompt to use for this turn, or undefined to leave it untouched.
   */
  applyToSystemPrompt(systemPrompt: string): string | undefined;
}

export function createConversationModeSignal(): ConversationModeSignal {
  let armed = false;
  return {
    arm(active: boolean) {
      armed = active;
    },
    isArmed() {
      return armed;
    },
    applyToSystemPrompt(systemPrompt: string) {
      if (!armed) return undefined;
      armed = false;
      return appendConversationModeHint(systemPrompt);
    },
  };
}

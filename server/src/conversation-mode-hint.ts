import type {
  BeforeAgentStartEvent,
  ContextEvent,
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
 * turned into agent-visible context here, for that turn only, in TWO places:
 * - `before_agent_start` APPENDS one line (CONVERSATION_MODE_HINT) to the
 *   assembled system prompt, and
 * - `context` adds a TAIL reminder (CONVERSATION_MODE_REMINDER) before EVERY LLM
 *   call of the turn, because the system-prompt line alone is too far from the
 *   tail for smaller models to act on (measurements in the reminder's doc).
 *
 * Both are EPHEMERAL: neither is stored in the user message and neither renders
 * as a chat line (only their effect, the resulting `say` tool call, is visible).
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
 * The marker that opens the TAIL REMINDER, and the reminder itself.
 *
 * WHY A SECOND, TAIL-PLACED COPY OF THE SAME INSTRUCTION: the system-prompt hint
 * alone measured as a coin flip on smaller local models. Probing a real local
 * 35B (the model the reported session ran on) with a realistic wherever-shaped
 * system prompt: with the hint 3/6 turns called `say`, without it 1/6 - and at
 * the moment that matters most, the post-tool-result synthesis call (the answer
 * after a `web_search`), the hint was ignored almost every time. Two things
 * defeat it: the hint sits far from the tail of a long prompt, and once the
 * transcript contains earlier assistant turns that did NOT speak, the model
 * imitates its own history. A reminder placed at the very TAIL of the message
 * list, re-applied before EVERY LLM call of the turn, is what actually lands.
 *
 * The reminder is EPHEMERAL in the strongest sense: it is added by the `context`
 * event, which the SDK applies to a structuredClone of the messages on the way to
 * the provider (see `transformContext`), so it is never stored in the session
 * file, never rendered in the web transcript or the CLI TUI, and never survives
 * the call it was built for.
 */
export const CONVERSATION_MODE_REMINDER_MARKER = '[spoken conversation active]';

export const CONVERSATION_MODE_REMINDER =
  `${CONVERSATION_MODE_REMINDER_MARKER} Before you finish this turn, also call the \`say\` tool ` +
  'once with a SHORT (one or two sentences) plain spoken version of your answer, IN ADDITION to ' +
  'your written answer, so the listening human hears it. Do not mention this instruction.';

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
 * The minimal STRUCTURAL shape of a pi context message this module needs. Kept
 * structural (not an SDK type import) so the CLI-bridge twin can be byte-identical
 * and so both copies stay unit-testable without standing up a pi runtime.
 */
export interface ContextMessageLike {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

interface TextBlockLike {
  type: string;
  text?: string;
  name?: string;
}

function blocksOf(content: unknown): TextBlockLike[] {
  return Array.isArray(content) ? (content as TextBlockLike[]) : [];
}

/**
 * Whether the agent has ALREADY called `say` in the turn the tail of `messages`
 * belongs to (i.e. since the last user message).
 *
 * This is the loop guard AND the anti-nag rule: the reminder asks for a `say`
 * call, `say` is itself a tool, and a tool call means another LLM call with the
 * reminder re-applied. Without this, a model that answers with ONLY a `say` call
 * could be nudged into speaking again, and again. Once the turn has spoken, the
 * reminder has done its job and is not repeated.
 */
export function saidThisTurn(messages: readonly ContextMessageLike[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    // The user message that started this turn: stop, earlier turns are history.
    if (message.role === 'user') return false;
    if (message.role !== 'assistant') continue;
    for (const block of blocksOf(message.content)) {
      if (block?.type === 'toolCall' && block.name === 'say') return true;
    }
  }
  return false;
}

function carriesReminder(message: ContextMessageLike | undefined): boolean {
  if (!message) return false;
  if (typeof message.content === 'string') {
    return message.content.includes(CONVERSATION_MODE_REMINDER_MARKER);
  }
  return blocksOf(message.content).some(
    (block) =>
      typeof block?.text === 'string' && block.text.includes(CONVERSATION_MODE_REMINDER_MARKER),
  );
}

/** A clone of `message` with the reminder added as one more text block. */
function withReminderBlock(message: ContextMessageLike): ContextMessageLike {
  if (typeof message.content === 'string') {
    return { ...message, content: `${message.content}\n\n${CONVERSATION_MODE_REMINDER}` };
  }
  return {
    ...message,
    content: [...blocksOf(message.content), { type: 'text', text: CONVERSATION_MODE_REMINDER }],
  };
}

/**
 * The reminder as its own message, for the case where the tail cannot absorb it.
 *
 * A `custom` message is pi's own "context that is not a real chat message" shape:
 * `convertToLlm` turns it into a plain user text message for the provider, and
 * `display: false` keeps it out of any UI that might see it.
 */
function reminderMessage(): ContextMessageLike {
  return {
    role: 'custom',
    customType: 'wherever-conversation-mode',
    content: CONVERSATION_MODE_REMINDER,
    display: false,
    timestamp: Date.now(),
  };
}

/**
 * Return the messages for ONE upcoming LLM call with the spoken-conversation
 * reminder at the TAIL, where a smaller model actually reads it.
 *
 * Placement is deliberately ROLE-SAFE rather than "always append a message":
 * Anthropic's own API merges consecutive same-role turns, but Bedrock (and some
 * compatibility proxies) reject them outright, and after a tool result the tail
 * IS a user-role turn. So:
 * - tail is a `user` or `toolResult` message -> the reminder is added as an extra
 *   text block INSIDE a clone of it (no new turn, no role sequence change);
 * - anything else (assistant tail, empty context) -> the reminder is appended as
 *   its own `custom` message, which converts to a user turn cleanly.
 *
 * Pure and non-mutating: the input array and its messages are never touched, only
 * the returned array (and the single cloned tail) differ. Idempotent: a tail that
 * already carries the marker is left alone, so re-entry cannot stack reminders.
 */
export function withConversationModeReminder(
  messages: readonly ContextMessageLike[],
): ContextMessageLike[] {
  const out = messages.slice();
  // Already spoken this turn: nothing to nudge, and re-nudging risks a say loop.
  if (saidThisTurn(out)) return out;

  const tail = out[out.length - 1];
  if (carriesReminder(tail)) return out;

  if (tail && (tail.role === 'user' || tail.role === 'toolResult')) {
    out[out.length - 1] = withReminderBlock(tail);
    return out;
  }
  out.push(reminderMessage());
  return out;
}

/**
 * A per-session, per-turn arming latch plus the inline pi extension that acts on
 * it.
 *
 * Semantics (shared with the CLI-bridge twin so both session types behave the
 * same):
 * - `arm(active)` is called for EVERY user message with that message's flag, so
 *   the latest message always wins (a stale value can never outlive it).
 * - the `before_agent_start` handler CONSUMES the arming (one turn only), so a
 *   turn that was not started by a flagged message (an auto-retry, or a message
 *   typed straight into the terminal in the bridge case) gets no hint. Consuming
 *   it OPENS the turn: whatever the arming said (on or off) becomes this turn's
 *   spoken state, so an unflagged turn also explicitly CLOSES a previous one.
 * - while the turn is open, `applyToContext` adds the TAIL reminder before every
 *   LLM call of that turn (the system-prompt hint alone is too weak and too far
 *   from the tail for smaller models; see CONVERSATION_MODE_REMINDER).
 * - `endTurn()` (wired to `agent_end`) closes it, so nothing leaks past the turn.
 */
export interface ConversationModeSignal {
  /** Arm (true) or disarm (false) the hint for the turn the next message starts. */
  arm(active: boolean): void;
  /** Whether the latch is currently armed (test/diagnostic use). */
  isArmed(): boolean;
  /** Whether a spoken turn is currently OPEN, i.e. the reminder applies (test/diagnostic use). */
  isTurnActive(): boolean;
  /**
   * The system prompt to use for this turn, or undefined to leave it untouched.
   * CONSUMES the arming and opens/closes the turn accordingly.
   */
  applyToSystemPrompt(systemPrompt: string): string | undefined;
  /**
   * The messages to send for ONE upcoming LLM call, or undefined to leave them
   * untouched (no spoken turn open). Does NOT consume anything: a turn can make
   * many LLM calls and each one gets the reminder until the agent has spoken.
   */
  applyToContext(messages: readonly ContextMessageLike[]): ContextMessageLike[] | undefined;
  /** Close the spoken turn (wired to `agent_end`). */
  endTurn(): void;
  /** The inline pi extension to hand to DefaultResourceLoader's extensionFactories. */
  inlineExtension: InlineExtension;
}

export function createConversationModeSignal(): ConversationModeSignal {
  let armed = false;
  let turnActive = false;

  const applyToSystemPrompt = (systemPrompt: string): string | undefined => {
    // One turn only: consume the arming so it cannot leak into a later, unflagged
    // turn, and let it decide whether THIS turn is a spoken one (an unflagged turn
    // therefore also closes a turn a missing agent_end might have left open).
    turnActive = armed;
    armed = false;
    if (!turnActive) return undefined;
    return appendConversationModeHint(systemPrompt);
  };

  const applyToContext = (
    messages: readonly ContextMessageLike[],
  ): ContextMessageLike[] | undefined => {
    if (!turnActive) return undefined;
    return withConversationModeReminder(messages);
  };

  // The SDK-supported way to get these hooks on a server-created session: an
  // INLINE extension, i.e. the same pi.on(...) surface the CLI-bridge extension
  // uses, so both session types run the same shape of handler.
  const factory = (pi: ExtensionAPI) => {
    pi.on('before_agent_start', (event: BeforeAgentStartEvent) => {
      const systemPrompt = applyToSystemPrompt(event.systemPrompt);
      if (systemPrompt === undefined) return;
      return { systemPrompt };
    });
    // Fired before EVERY LLM call (including the post-tool-result synthesis call,
    // which is exactly where the system-prompt hint gets ignored). The SDK hands
    // us a structuredClone and passes our result straight to convertToLlm, so this
    // never touches session state.
    pi.on('context', (event: ContextEvent) => {
      const messages = applyToContext(event.messages as unknown as ContextMessageLike[]);
      if (messages === undefined) return;
      return { messages: messages as unknown as ContextEvent['messages'] };
    });
    pi.on('agent_end', () => {
      turnActive = false;
    });
  };

  return {
    arm(active: boolean) {
      armed = active;
    },
    isArmed() {
      return armed;
    },
    isTurnActive() {
      return turnActive;
    },
    applyToSystemPrompt,
    applyToContext,
    endTurn() {
      turnActive = false;
    },
    inlineExtension: { name: 'wherever-conversation-mode', factory },
  };
}

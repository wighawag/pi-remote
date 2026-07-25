import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

/**
 * Build the `say` tool for a SERVER-SIDE agent session.
 *
 * This is the server-created-session counterpart of the identical tool the
 * CLI-bridge extension registers. Like `attach_file` (and `read`), it is
 * intentionally SELF-CONTAINED: it only validates its single `text` argument and
 * returns a normal tool result carrying that text in `details`. It reads NO
 * files, depends on NO bridge, and emits NO side-channel message.
 *
 * The spoken-reply affordance is driven entirely by the tool CALL: every
 * connected client already receives tool_start/tool_end for this session, and
 * the web UI recognizes the `say` tool name, surfaces the spoken text, and (when
 * conversation mode is active) speaks it via the browser SpeechSynthesis API.
 * That is why the same tool works in a pure web-frontend session with no CLI
 * bridge present — the exact same reason `attach_file` works everywhere, and why
 * `say` needs NO new WS message type and NO new chat role.
 *
 * SEPARATION OF CONCERNS in the tool TEXT: this description owns HOW to use
 * `say` (an additive, one-or-two-sentence, plain-spoken layer on top of the
 * written answer); the per-turn conversation-mode injection owns WHETHER to use
 * it (see `./conversation-mode-hint.ts` + ADR 0004). The description therefore
 * carries NO standing "while a spoken conversation is active" condition for the
 * agent to judge for itself: that invitation made `say` fire with conversation
 * mode OFF, since the agent would infer "active" from a chatty exchange. The
 * injected hint is the ONLY positive trigger. This is guidance, not a hard gate
 * (the tool is still registered when the mode is off; a dynamic per-session
 * registration would be a separate, larger change).
 *
 * KEEP IN LOCKSTEP with the CLI-bridge twin's `pi.registerTool({ name: "say" })`
 * block in `extension/src/index.ts`; `server/test/say-tool.test.ts` parses that
 * source and fails if the description, promptSnippet or promptGuidelines drift.
 */
export function createSayTool(): ToolDefinition {
  return {
    name: 'say',
    label: 'Say',
    description:
      'Emit a SHORT spoken-form reply that the web UI speaks aloud and surfaces. ' +
      'WHETHER to speak is never your own judgement: call `say` ONLY when the ' +
      'instructions for THIS turn explicitly state that a spoken conversation is ' +
      'active. That explicit instruction is the only signal there is; do not infer ' +
      'a spoken conversation from the phrasing of the message, from how chatty the ' +
      'exchange feels, or from an earlier turn. Absent that explicit per-turn ' +
      'instruction, never call `say` at all. When you ARE told to speak, use `say` ' +
      'only IN ADDITION to your normal written answer, never instead of it: the ' +
      'full detail stays in the written message, and `say` is just the concise ' +
      'version the human hears and can sanity-check against the full reply. Keep ' +
      'it to one or two sentences of natural, plain spoken language (no code, no ' +
      'markdown, no lists).',
    promptSnippet:
      'Emit a short spoken-form reply the web UI speaks aloud, in addition to your written answer, ONLY when the instructions for this turn explicitly say a spoken conversation is active',
    promptGuidelines: [
      'Only call say when the instructions for THIS turn explicitly state that a spoken conversation is active; that instruction is the only trigger there is.',
      'Absent that explicit per-turn instruction, never call say: do not infer a spoken conversation from the phrasing of the message, from how chatty the exchange feels, or from an earlier turn.',
      'When you are told to speak, use say as an ADDITIVE short spoken layer on top of your normal written answer, never as a replacement: the full detail stays in the written message.',
      'Keep say to one or two sentences of plain spoken language (no code, no markdown, no lists), a concise version of your answer the human can hear and sanity-check.',
    ],
    parameters: Type.Object({
      text: Type.String({
        description:
          'The short spoken-form reply (one or two sentences of plain language) to speak aloud, in addition to your written answer.',
      }),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const text = String((params as { text?: string }).text || '').trim();
      if (!text) {
        return {
          content: [{ type: 'text' as const, text: 'say: no text provided.' }],
          details: undefined,
          isError: true,
        };
      }

      // Success. The spoken-reply surface is driven by the tool CALL (the web UI
      // reads the `text` from details), so we just confirm back to the model. No
      // filesystem, no bridge, no marker: works in any session type.
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Spoken reply delivered to the conversation.',
          },
        ],
        details: { text },
      };
    },
  } as unknown as ToolDefinition;
}

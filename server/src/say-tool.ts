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
 */
export function createSayTool(): ToolDefinition {
  return {
    name: 'say',
    label: 'Say',
    description:
      'Emit a SHORT spoken-form reply that the web UI can speak aloud and surface ' +
      'while a spoken conversation is active. Use this ONLY IN ADDITION to your ' +
      'normal written answer, never instead of it: the full detail stays in the ' +
      'written message, and `say` is just the concise version the human hears and ' +
      'can sanity-check against the full reply. Keep it to one or two sentences of ' +
      'natural, plain spoken language (no code, no markdown, no lists). When a ' +
      'spoken conversation is active you are told so for that turn: add a `say` ' +
      'reply then, on top of your written answer.',
    promptSnippet:
      'Emit a short spoken-form reply the web UI can speak aloud (in addition to your written answer)',
    promptGuidelines: [
      'Use say as an ADDITIVE short spoken layer on top of your normal written answer, never as a replacement: the full detail stays in the written message.',
      "When the turn's instructions say a spoken conversation is active, add a say reply to your written answer.",
      'Keep say to one or two sentences of plain spoken language (no code, no markdown), a concise version of your answer the human can hear and sanity-check.',
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

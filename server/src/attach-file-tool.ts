import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

/**
 * Build the `attach_file` tool for a SERVER-SIDE agent session.
 *
 * This is the server-created-session counterpart of the identical tool the
 * CLI-bridge extension registers. It is intentionally SELF-CONTAINED (like
 * `read`): it only validates the requested path and returns a normal tool
 * result carrying that path. It does NOT read the file bytes and emits no
 * side-channel message.
 *
 * The download affordance is driven entirely by the tool CALL: every connected
 * client already receives tool_start/tool_end for this session, and the web UI
 * recognizes the `attach_file` tool name and renders a download button from its
 * `path` argument (hitting GET /session/download). That is why the same tool
 * works in a pure web-frontend session with no CLI bridge present.
 *
 * `cwd` is the session's working directory; relative paths resolve against it.
 */
export function createAttachFileTool(cwd: string): ToolDefinition {
  return {
    name: 'attach_file',
    label: 'Attach File',
    description:
      'Attach a file to the conversation so the person on the other end (e.g. a ' +
      'phone/browser) can download it with one tap. The user is remote and CANNOT ' +
      'reach the local filesystem, so a file path in your reply is NOT enough: they ' +
      'can only obtain a file if you attach it with this tool. Pass the path to a ' +
      'real, existing file inside the working directory (or an absolute path the ' +
      'server is allowed to serve). Use this both right after generating a ' +
      'deliverable (a PDF, an export, a report) AND whenever the user asks for a ' +
      "file by name or type, including one created earlier in the conversation, " +
      "e.g. 'give me the gpx', 'send me the pdf', 'download the report', 'can I " +
      "have that file'. Resolve which file they mean from the conversation and " +
      'attach it; if truly ambiguous, ask which file, otherwise attach the most ' +
      'likely match rather than only printing its path.',
    promptSnippet:
      'Attach a file to the conversation so the remote user can download it',
    promptGuidelines: [
      "Use attach_file whenever the user asks you to give/send/download/share a file, or asks for a file by name or type (e.g. 'give me the gpx', 'send the pdf'), including files created earlier in the conversation: the user is remote and can only download a file you attach, so never answer such a request with just a file path.",
      'Use attach_file right after generating a downloadable deliverable (PDF, export, archive) so the remote user can retrieve it without asking.',
    ],
    parameters: Type.Object({
      path: Type.String({
        description:
          'Path to the file to attach. Relative paths resolve against the working directory.',
      }),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const rawPath = String((params as { path?: string }).path || '').trim();
      if (!rawPath) {
        return {
          content: [{ type: 'text' as const, text: 'attach_file: no path provided.' }],
          details: undefined,
          isError: true,
        };
      }

      let resolved = rawPath;
      if (resolved.startsWith('~')) {
        resolved = path.join(os.homedir(), resolved.slice(1));
      } else if (!path.isAbsolute(resolved)) {
        resolved = path.resolve(cwd, resolved);
      } else {
        resolved = path.resolve(resolved);
      }

      let size: number | null = null;
      try {
        const st = fs.statSync(resolved);
        if (!st.isFile()) {
          return {
            content: [
              { type: 'text' as const, text: `attach_file: not a regular file: ${resolved}` },
            ],
            details: undefined,
            isError: true,
          };
        }
        size = st.size;
      } catch {
        return {
          content: [
            { type: 'text' as const, text: `attach_file: file not found: ${resolved}` },
          ],
          details: undefined,
          isError: true,
        };
      }

      const filename = path.basename(resolved);
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `Attached "${filename}" (${size} bytes) to the conversation. ` +
              `A download button is now shown to the user for: ${resolved}`,
          },
        ],
        details: { path: resolved, filename, size },
      };
    },
  } as unknown as ToolDefinition;
}

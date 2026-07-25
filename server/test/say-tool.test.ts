import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { createSayTool } from '../src/say-tool.ts';

// Unit tests for the self-contained `say` tool (the server-side factory the
// session pool wires into every server-created agent session, mirroring
// `attach_file`). `say` carries a SHORT spoken-form reply the web UI will later
// speak aloud; it is validate-and-return only — no filesystem, no side channel.
// It rides the existing tool_start/tool_end stream, so these unit tests assert
// exactly the execute() contract the acceptance criteria pin down.

/** The description + promptSnippet + promptGuidelines blob, lowercased. */
function textBlob(tool: {
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
}): string {
  return [tool.description, tool.promptSnippet || '', ...(tool.promptGuidelines || [])]
    .join(' ')
    .toLowerCase();
}

/**
 * The CLI-bridge twin's `say` text, parsed out of the extension source.
 *
 * `say` is dual-registered (server factory + `pi.registerTool` in
 * `extension/src/index.ts`), and the extension's registration lives inside a big
 * default export that needs a whole pi runtime to load, so the drift guard reads
 * the source and reassembles the three text fields from their string literals.
 * Mirrors the `conversation-mode-hint` lockstep test.
 */
function readExtensionSayText(): {
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
} {
  const source = fs.readFileSync(
    new URL('../../extension/src/index.ts', import.meta.url),
    'utf-8',
  );
  const start = source.indexOf('name: "say"');
  if (start < 0) throw new Error('the extension no longer registers a `say` tool');
  const end = source.indexOf('parameters:', start);
  const block = source.slice(start, end);

  const slice = (from: string, to: string): string => {
    const a = block.indexOf(from);
    const b = block.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`the extension \`say\` block has no ${from} ... ${to}`);
    return block.slice(a + from.length, b);
  };
  const literals = (chunk: string): string[] =>
    [...chunk.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

  return {
    description: literals(slice('description:', 'promptSnippet:')).join(''),
    promptSnippet: literals(slice('promptSnippet:', 'promptGuidelines:')).join(''),
    promptGuidelines: literals(slice('promptGuidelines: [', ']')),
  };
}

describe('createSayTool', () => {
  it('exposes the say tool with a spoken-reply description', () => {
    const tool = createSayTool() as {
      name: string;
      description: string;
      promptSnippet?: string;
      promptGuidelines?: string[];
    };
    expect(tool.name).toBe('say');
    // The description/guidelines must steer the agent to use it ONLY as a short
    // spoken reply IN ADDITION to the written answer.
    const blob = textBlob(tool);
    expect(blob).toContain('spoken');
    expect(blob).toContain('in addition');
  });

  it('defers WHETHER to speak entirely to the explicit per-turn instruction', () => {
    const tool = createSayTool() as {
      description: string;
      promptSnippet?: string;
      promptGuidelines?: string[];
    };
    const blob = textBlob(tool);

    // The ONLY positive trigger is the per-turn conversation-mode hint injected
    // into the system prompt (see src/conversation-mode-hint.ts): the text must
    // say so explicitly, and say that nothing else counts.
    expect(blob).toContain('explicitly');
    expect(blob).toContain('the instructions for this turn');
    expect(blob).toContain('only signal');
    expect(blob).toContain('never call');

    // No STANDING "while/when a spoken conversation is active" condition for the
    // agent to evaluate for itself: that is the invitation that made `say` fire
    // with conversation mode OFF.
    expect(blob).not.toMatch(/\b(while|when)\s+a\s+spoken\s+conversation\s+is\s+active/);
  });

  it('still says HOW: a short, additive, plain-spoken layer on the written answer', () => {
    const tool = createSayTool() as {
      description: string;
      promptSnippet?: string;
      promptGuidelines?: string[];
    };
    const blob = textBlob(tool);
    expect(blob).toContain('one or two sentences');
    expect(blob).toContain('no code, no markdown, no lists');
    expect(blob).toContain('never');
    expect(blob).toContain('written answer');
  });

  it('keeps the CLI-bridge extension copy in lockstep', () => {
    const tool = createSayTool() as {
      description: string;
      promptSnippet?: string;
      promptGuidelines?: string[];
    };
    const twin = readExtensionSayText();
    expect(twin.description).toBe(tool.description);
    expect(twin.promptSnippet).toBe(tool.promptSnippet);
    expect(twin.promptGuidelines).toEqual(tool.promptGuidelines);
  });

  it('returns an error result for blank text and touches no filesystem', async () => {
    const spy = vi.spyOn(fs, 'statSync');
    const tool = createSayTool() as {
      execute: (id: string, params: unknown) => Promise<{ isError?: boolean; details?: unknown }>;
    };

    for (const bad of ['', '   ', '\n\t ']) {
      const res = await tool.execute('call-1', { text: bad });
      expect(res.isError).toBe(true);
      expect(res.details).toBeUndefined();
    }
    // No path was resolved and nothing was stat'd — the tool never touches the fs.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns a non-error result carrying the text in details for valid input', async () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const statSpy = vi.spyOn(fs, 'statSync');
    const tool = createSayTool() as {
      execute: (
        id: string,
        params: unknown,
      ) => Promise<{
        isError?: boolean;
        details?: { text?: string };
        content?: Array<{ type: string; text: string }>;
      }>;
    };

    const spoken = 'The build passed and I deployed to staging.';
    const res = await tool.execute('call-2', { text: spoken });

    expect(res.isError).toBeFalsy();
    expect(res.details).toEqual({ text: spoken });
    // Model-facing content is a short confirmation string, not the file bytes.
    expect(res.content && res.content[0]?.type).toBe('text');
    expect(typeof (res.content && res.content[0]?.text)).toBe('string');
    // No filesystem/side channel: nothing read, nothing stat'd.
    expect(readSpy).not.toHaveBeenCalled();
    expect(statSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
    statSpy.mockRestore();
  });

  it('trims surrounding whitespace but preserves the spoken text', async () => {
    const tool = createSayTool() as {
      execute: (
        id: string,
        params: unknown,
      ) => Promise<{ isError?: boolean; details?: { text?: string } }>;
    };
    const res = await tool.execute('call-3', { text: '  Done in two steps.  ' });
    expect(res.isError).toBeFalsy();
    expect(res.details).toEqual({ text: 'Done in two steps.' });
  });
});

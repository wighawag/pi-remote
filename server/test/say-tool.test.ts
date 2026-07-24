import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { createSayTool } from '../src/say-tool.ts';

// Unit tests for the self-contained `say` tool (the server-side factory the
// session pool wires into every server-created agent session, mirroring
// `attach_file`). `say` carries a SHORT spoken-form reply the web UI will later
// speak aloud; it is validate-and-return only — no filesystem, no side channel.
// It rides the existing tool_start/tool_end stream, so these unit tests assert
// exactly the execute() contract the acceptance criteria pin down.

describe('createSayTool', () => {
  it('exposes the say tool with a spoken-reply description', () => {
    const tool = createSayTool() as {
      name: string;
      description: string;
      promptGuidelines?: string[];
    };
    expect(tool.name).toBe('say');
    // The description/guidelines must steer the agent to use it ONLY as a short
    // spoken reply IN ADDITION to the written answer while a spoken conversation
    // is active.
    const blob = (tool.description + ' ' + (tool.promptGuidelines || []).join(' ')).toLowerCase();
    expect(blob).toContain('spoken');
    expect(blob).toContain('in addition');
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

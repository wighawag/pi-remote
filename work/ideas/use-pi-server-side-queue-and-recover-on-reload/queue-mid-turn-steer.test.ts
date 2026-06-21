import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'sveltore';
// EVIDENCE FILE (not an in-tree test). It lives under work/ideas/use-pi-server-side-queue-and-recover-on-reload/ and
// imports the REAL client reducer from the client package by name. When the
// rewrite adopts it, move it to client/test/ and switch to '../src/client.js'.
import { WhereverClient } from '@wherever-dev/client';
import type { WhereverState } from '@wherever-dev/client';

/**
 * "pi stops midway" reproduction at the reducer level.
 *
 * Hypothesis (from tracing client.ts + ChatInput.svelte): a multi-step pi turn
 * (assistant -> tool -> assistant) emits an intermediate `agent_end` at the
 * tool boundary. The client debounces that `agent_end` by only 300ms before
 * flipping `isStreaming` -> false. If the NEXT step (tool_start / agent_start)
 * is delayed past 300ms, `isStreaming` goes false MID-TURN.
 *
 * The frontend queue ($effect: `if (!streaming && queuedText) sendMessage(...)`)
 * then auto-sends the queued message, which the server delivers as `steer`,
 * redirecting the still-running agent. To the user: pi stopped midway.
 *
 * This test drives the REAL reducer (handleMessage) with a scripted event
 * stream and fake timers, so the race is deterministic, not flaky.
 *
 * EXPECTED TODAY: the assertion that `isStreaming` stays true across a >300ms
 * tool gap FAILS. That failing test is the captured evidence for the brief.
 */

function makeClient() {
  const c = new WhereverClient({ host: 'x', port: 1, secure: false });
  // handleMessage is private; the reducer is what we are testing. Cast to reach it.
  const feed = (msg: unknown) => (c as unknown as { handleMessage(m: unknown): void }).handleMessage(msg);
  const state = () => get<WhereverState>(c.stateStore);
  return { c, feed, state };
}

const SESSION = 'sess-1';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('queue / isStreaming mid-turn race', () => {
  it('keeps isStreaming TRUE across a >300ms gap between assistant and tool step', () => {
    const { feed, state } = makeClient();

    // Turn begins, assistant streams a bit.
    feed({ type: 'agent_start', sessionId: SESSION });
    feed({ type: 'message_update', sessionId: SESSION, delta: 'working' });
    expect(state().isStreaming).toBe(true);

    // Intermediate agent_end at the assistant->tool boundary (pi emits this
    // mid-turn before a tool call). Client arms a 300ms debounce.
    feed({ type: 'message_end', sessionId: SESSION, content: 'working', role: 'assistant' });
    feed({ type: 'agent_end', sessionId: SESSION });

    // The next step (tool_start) is slow: 600ms > the 300ms debounce.
    vi.advanceTimersByTime(600);

    // The turn is NOT over: a tool call follows. So isStreaming SHOULD still be
    // true here. (Today it is false -> this is the bug.)
    expect(state().isStreaming).toBe(true);

    // Tool then runs and the turn really continues.
    feed({ type: 'tool_start', sessionId: SESSION, toolName: 'bash', args: { command: 'ls' } });
    expect(state().isStreaming).toBe(true);
  });

  it('a short (<300ms) gap is correctly bridged by the debounce (control)', () => {
    const { feed, state } = makeClient();
    feed({ type: 'agent_start', sessionId: SESSION });
    feed({ type: 'message_end', sessionId: SESSION, content: 'x', role: 'assistant' });
    feed({ type: 'agent_end', sessionId: SESSION });
    // Next step arrives quickly, within the debounce window.
    vi.advanceTimersByTime(100);
    feed({ type: 'tool_start', sessionId: SESSION, toolName: 'bash', args: {} });
    expect(state().isStreaming).toBe(true);
  });
});

---
title: say tool — a self-contained short-spoken-reply tool, dual-registered like attach_file
slug: say-tool-dual-registration
spec: conversation-mode
blockedBy: []
covers: [4, 10, 12, 13]
---

## What to build

A new `say` tool that lets the agent emit a SHORT spoken-form reply, mirroring the `attach_file` pattern end-to-end. It is SELF-CONTAINED: `execute` validates a single `text` argument (a non-empty string), returns a NORMAL tool result carrying the text in `details` (e.g. `{ text }`), reads no files, and emits NO side channel. The model-facing result is a short confirmation string.

Register it in the SAME two places `attach_file` lives, so it exists in every session type:

1. **Server-side sessions** (web frontend, no terminal): a `createSayTool()` factory passed as a `customTool` into both `createAgentSession()` calls in the server session pool, beside `createAttachFileTool(cwd)`.
2. **CLI-bridge sessions** (terminal pi): the same tool registered via `pi.registerTool({...})` in the `@wherever-dev/pi` extension, beside the existing `attach_file` registration.

The tool's description/guidelines instruct the agent: use `say` ONLY to provide a short spoken-form reply WHILE A SPOKEN CONVERSATION IS ACTIVE, IN ADDITION to (never instead of) the normal written answer; keep it to one or two sentences; the full detail stays in the written message. This introduces NO new WS message type and NO new chat role — the affordance rides the existing `tool_start`/`tool_end` stream exactly like `attach_file` (the removed `file_attachment` bridge-marker design is the anti-pattern to avoid).

## Acceptance criteria

- [ ] `say` is registered in BOTH the server session pool (as a `customTool` on both `createAgentSession()` calls) and the `@wherever-dev/pi` extension, mirroring `attach_file`.
- [ ] `execute` with an empty/blank `text` returns an ERROR result (`isError: true`) and touches nothing.
- [ ] `execute` with a valid `text` returns a NON-error result whose `details` carries the text (e.g. `{ text }`) and whose model-facing content is a short confirmation string; it reads no filesystem and emits no side channel.
- [ ] The tool description/guidelines state it is for a short spoken reply IN ADDITION to the written answer, one or two sentences, only while a spoken conversation is active.
- [ ] No new WS message type and no new chat role are introduced.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style): unit tests that blank `text` → error result, valid `text` → non-error result carrying the text in `details`, and that the tool touches no filesystem/side channel.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: add a `say` tool to Wherever so the agent can emit a SHORT spoken-form reply that the web UI will later speak aloud and surface. This task is the TOOL itself (server + extension registration + tests); the web-side TTS/card rendering is a separate task (`say-tool-tts-and-card`) that depends on this.
>
> FIRST, drift-check against reality: confirm `attach_file` is still dual-registered the way this task assumes — a `createAttachFileTool(cwd)` factory fed as a `customTool` into both `createAgentSession()` calls in the server session pool, AND a `pi.registerTool({ name: "attach_file", ... })` block in the `@wherever-dev/pi` extension. Build `say` by exact analogy to whatever shape `attach_file` currently has. If `attach_file` has changed, reconcile before building.
>
> Where to look (by concept, not brittle paths): the server-side `attach_file` tool factory lives in the server package beside the session pool that wires custom tools into agent sessions; the CLI-bridge registration lives in the extension package's main entry alongside the other `pi.registerTool(...)` calls.
>
> Key decisions already made (do not re-litigate): `say` is SELF-CONTAINED like `attach_file`/`read` — validate `text`, return a normal tool result carrying the text in `details`, no file reads, no bridge/side channel. It is DUAL-registered (Open Question 1 resolved: dual, to keep behaviour uniform across session types). It rides `tool_start`/`tool_end` — NO new WS message type, NO new chat role, NO bridge marker (the removed `file_attachment` design is the anti-pattern). The tool DESCRIPTION must tell the agent to use it only for a short spoken reply IN ADDITION to the written answer while a spoken conversation is active.
>
> Done = `say` is registered in both places, its `execute` validates `text` and returns text-in-`details` (error on blank), and the unit tests above pass. Changeset per AGENTS.md: server change → `"wherever-dev": patch`; the extension registration ALSO needs `"@wherever-dev/pi": patch` (never `@wherever-dev/web`).

---
title: Watch agent-runner's autonomous agents — multi-folder watching + group/differentiate runner-driven sessions
slug: watch-agent-runner-fleet-sessions
type: idea
status: incubating
---

# Watch the agent-runner agent fleet from the dashboard

> First `work/ideas/` note in this repo (introducing the lightweight capture bucket
> from the agent-runner `work/` contract). Captured 2026-06-05 while dogfooding
> `agent-runner` alongside this dashboard. The agent-runner SIDE of this is tracked
> there:
> `~/dev/github/wighawag/agent-runner/work/observations/pi-session-dir-hides-sessions-from-dashboard.md`.

## The opportunity

`agent-runner` drives pi agents autonomously \u2014 one in-place (`do`), or many in
parallel (`do --remote`, and the `run` daemon's concurrent fleet). Today this
dashboard lists sessions via `SessionManager.listAll()` (pi's default managed root,
`~/.pi/agent/sessions/`). Two improvements would turn the dashboard into a live
observability pane over the whole autonomous fleet:

### 1. Watch MULTIPLE session folders (config)

The dashboard currently observes one root (pi-default). agent-runner is gaining a
**configurable session location** (defaulting to pi-default, overridable \u2014
especially for the `run` AFK daemon, so an operator can point the fleet's sessions
at a dedicated folder). To watch that fleet, the dashboard should accept a
**configurable LIST of session roots** to scan/watch, not just the single default:

- e.g. pi-default (manual + `do`) AND a configured agent-runner fleet folder.
- Each root scanned via the same `SessionManager`/listing path; sessions merged into
  the dashboard view.

### 2. DIFFERENTIATE / group agent-runner-driven sessions

A human watching wants to tell "my manual pi work" from "an autonomous agent
building slice X right now." Signals available:

- agent-runner knows the **work-id** (`<host>__<org>__<name>__<slug>`) and the
  **slug** for each job; it could TAG the session (pi sessions have a `name` field \u2014
  see `FolderSessionInfo.name` / `session-types.ts`).
- The dashboard could then GROUP/LABEL runner-driven sessions (by repo, by slug, by
  "autonomous vs manual") and let the human click into a live autonomous agent to
  watch what it is doing.

## Why it is compelling

"Watch all my autonomous agents working, right now, grouped, from one web
dashboard" is a real capability \u2014 the orchestrator (agent-runner) + the live
observability pane (this dashboard) composing. It is also the natural answer to the
agent-runner-side fix (sessions defaulting to pi-default so they are visible at all);
this idea is the dashboard half that makes the fleet legible.

## Dependencies / sequencing

- Soft-depends on the agent-runner side landing the **configurable session
  location** (so there is a fleet folder to point at) \u2014 but multi-folder watching is
  independently useful (watch pi-default + any other pi session root) and can land
  first.
- The tagging/grouping half wants agent-runner to set the pi session `name`
  (coordinate the tag format across the two repos when both are built).

## Status

Idea only \u2014 not yet a PRD/slice. This repo does not yet run the full `work/`
lifecycle; this is a lightweight capture so the cross-tool opportunity is not lost.
(Git: left unstaged per this repo's AGENTS.md \u2014 not committed.)

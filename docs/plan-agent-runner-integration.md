# Integrating agent-runner into Wherever

**Status:** Ideas / exploration (not a committed plan)
**Date:** 2026-06-07
**Sibling project:** `~/dev/github/wighawag/agent-runner`

## TL;DR

`agent-runner` is a CLI that discovers, claims, and runs **work slices** across
many repos — both as a guided human loop and as an unattended autonomous runner —
on top of a file-based `work/` contract (status = the folder a markdown file
lives in). `wherever` is the HTTP/WebSocket bridge + web/VS Code/mobile UI for
driving `pi` sessions remotely.

The two fit together cleanly because each already has the seam the other needs:

- agent-runner spawns agents via a **harness seam** whose `pi` adapter records a
  pointer to the pi session dir/log per job. → wherever can *watch* those.
- wherever already models a **session pool** with multiple folders, a
  **read-only** join mode, and a **CLI bridge** (`cli_register`) that lets an
  externally-spawned pi attach itself to the server. → agent-runner jobs can
  surface as sessions.
- agent-runner separates **adopt = skill** (protocol setup, write a PRD/slices)
  from **execute = command** (claim/run/integrate). → wherever can drive the
  *commands* with buttons and host the *skills* as guided flows.

This doc collects integration ideas, grouped by the three the user named:
(1) multi-session folders incl. read-only watching, (2) repo setup with the
agent-runner protocol, (3) UI affordances for PRD/slice authoring — plus a few
that emerged from reading both codebases.

---

## Where the two systems already meet (the seams)

Before the ideas, the concrete hooks that make them low-friction:

| agent-runner concept | wherever concept | Why they connect |
|---|---|---|
| harness `pi` adapter → records session dir/log per job | `SessionPool.loadSession(sessionFile)` + `listSessions()` (groups by `cwd`) | A running job *is* a pi session on disk; wherever can list & open it. |
| job runs in a **job worktree** (`~/.agent-runner/work/<work-id>/`) | sessions are grouped by `cwd` folder in `SessionBrowser` | Each worktree is just another folder of sessions to surface. |
| autonomous runner — don't disturb it | `session_resolve_conflict { action: 'read_only' }` + `isReadOnly` store | Watch the conversation without stealing/steering it. |
| externally-spawned `pi` (job) | `cli_register` CLI-bridge protocol | A job's pi could register with the wherever server and stream live. |
| `work/` contract = markdown files in folders | server already shells out (`execSync` for git/gh) | wherever can read/write `work/` files and run `agent-runner` commands. |
| `adopt = skill` (PRD, slices, setup) | web UI buttons + pi skills already on disk | Buttons that kick off the skill-driven flows. |

Key constraint to respect from agent-runner's invariants:

- **The runner owns all git-state transitions.** wherever's UI should *trigger*
  agent-runner commands (`do`, `start`, `complete`, `work-on`), not move `work/`
  files or push branches itself. (wherever already shells `git`/`gh` for plain
  session repos — but for agent-runner repos it must defer to the CLI.)
- **Secrets isolation:** agents run under `~/.agent-runner/`; humans work under
  `humanWorktreesDir`. wherever watching an agent session must stay on the agent
  side and must not inject a human's `.env`.

---

## Idea 1 — Multi-session folders, with read-only "watch a runner" mode

The user's framing: *"supporting multiple session folders with some being
read-only (so agent-runner agents can be inspected separately just for watching
their conversation)."*

This is the highest-value, lowest-risk integration because **most of it already
exists** in wherever.

### 1a. Surface agent-runner job worktrees as a session group

`SessionPool.listSessions()` already groups sessions by `cwd`. agent-runner job
worktrees live under `~/.agent-runner/work/<work-id>/` and each runs a pi session
(via the `pi` harness adapter). So:

- Add an optional **"Agent Runner" section** to `SessionBrowser.svelte` that
  lists active jobs. Source of truth options (pick one, in order of fidelity):
  1. **`agent-runner status --json`** — the runner's own dashboard
     (running/stuck/cleanup). Best: authoritative liveness from the harness, not
     filesystem mtime (an explicit agent-runner invariant).
  2. Scan `~/.agent-runner/work/*/` for pi session files (fallback if no JSON
     status command yet — would need one added on the agent-runner side).
- Each job row shows: repo key (`host/org/name`), slug, state
  (running / needs-attention / done), and a **Watch** button.

### 1b. "Watch" = open the job's session read-only

wherever already has read-only join via the conflict dialog
(`session_resolve_conflict { action: 'read_only' }`) and an `isReadOnly` store
that disables the composer (`ChatInput.svelte`, `+page.svelte`). Generalise it:

- Add an explicit **read-only open** path that doesn't require a conflict to
  trigger it — e.g. `session_load { sessionFile, readOnly: true }` in the
  protocol, or a dedicated `session_watch` message.
- When opened read-only, the client streams `message_update` / `tool_*` events
  live (same broadcast path) but the composer is hidden and no
  `sendUserMessage` is allowed server-side for that client.
- Server-side guard: today read-only is a *client* state. For watching an
  autonomous runner we want a **server-enforced** read-only so a buggy/malicious
  client can't steer the job. Track per-client read-only in the session's
  `clients` set (e.g. `Set<{id, readOnly}>`) and reject messages from read-only
  clients.

This directly delivers "inspect agent-runner agents separately just for watching
their conversation."

### 1c. Live job feed via the CLI bridge (optional, higher fidelity)

agent-runner's `pi` harness could, when launching a job, point that pi at a
wherever extension/`cli_register` so the job streams into the server in real time
(exactly how the VS Code companion / CLI bridge already attaches a terminal pi).
Then watching is truly live, not a tail of the session file.

- Smallest version: the harness sets `--extension <wherever>` +
  `--remote-port`/token, and the wherever extension auto-`cli_register`s with
  `cwd = job worktree`, `sessionFile = job's session`.
- This makes the job appear in `listSessions()` as an **active** session with a
  client count, and abort/steer can be *administratively* allowed (e.g. a human
  takes over a stuck runner) — but default to read-only.

### 1d. Status-aware badges

Map agent-runner lifecycle onto session UI badges: `in-progress` (running),
`needs-attention` (stuck — surface prominently, it's the human-handoff signal),
`done`. The `needs-attention` case is where a human most wants to jump from
*watching* to *taking over* — wherever's `take_over` already exists for that.

---

## Idea 2 — Set up a new repo with the agent-runner protocol + context

The user's framing: *"setting up new repo with agent-runner protocol and
context."*

agent-runner's invariant: **adopt = skill, execute = command.** Adopting the
contract (scaffolding `work/`, the slicing/PRD methodology, CONTEXT/ADR seeding)
is protocol-layer and runner-agnostic. wherever already has a "new session"
flow that can `git init` and create a GitHub/Codeberg remote — extend it.

### 2a. Extend "New Session" → "New agent-runner repo"

`SessionPool.createNewSession()` already does: resolve path → `mkdir` →
optional `git init` → optional `gh repo create` (driven by
`config.remoteRepoRules`) → upstream tracking. Add an opt-in **"Adopt
agent-runner protocol"** toggle that, after the repo exists:

- Creates the `work/` skeleton: `backlog/ in-progress/ done/ needs-attention/
  out-of-scope/ prd/ ideas/ observations/ findings/` (the folders ARE the
  status; see CONTEXT). Drop a `.gitkeep` in each.
- Seeds `CONTEXT.md` (domain glossary stub), `AGENTS.md` (the git-transition
  reminder + acceptance gate), and `docs/adr/` with a starter ADR.
- Optionally registers the repo with the runner:
  `agent-runner remote add <url>` (creates its hub mirror / arbiter).
- Sets the per-repo policy fields the protocol cares about (`allowAgents`,
  `integration` mode = propose/merge).

The cleanest implementation is **delegation, not duplication**: have wherever
invoke an agent-runner *adopt* skill or a `agent-runner init`/`adopt` command (if
one exists/added), so the scaffolding logic lives once, in agent-runner, and
wherever just triggers it. This honours "adopt = skill / execute = command" and
avoids wherever drifting from the protocol.

### 2b. "Register existing repo" flow

`agent-runner remote find <folder>` discovers `work/`-participating repos and
toggle-adds them. Surface this as a wherever screen: pick a folder → show
discovered repos → check the ones to register → run `remote add`. Now those
repos' jobs flow into the watch UI (Idea 1).

### 2c. Per-repo config editor

agent-runner resolves several policies per-repo (flag > per-repo > global >
default): `allowAgents`, `integration` (propose/merge), `humanWorktreesDir`,
harness selection, the `verify` gate command. A small wherever settings panel
that reads/writes these (via an `agent-runner config` command) lets a developer
tune autonomy from the same UI they watch jobs in.

---

## Idea 3 — UI affordances for PRD / slice / capture authoring

The user's framing: *"adding buttons or other things to make it easy to write
PRD, slices, etc."*

These map onto agent-runner's **skills**, which already exist as files (the user
has `to-prd`, `to-slices`, `review`, `batch-qa`, `capture-signal`, etc. in
`~/.agents/skills/`). The win is making them *one tap* from the chat UI instead
of remembering to type "use the to-prd skill."

### 3a. A "Work" action bar in the chat view

Context-aware buttons that inject the right skill prompt into the current session
(the session's `cwd` tells us which repo/work tree we're in):

- **📝 Write PRD** → injects the `to-prd` skill flow (turns the current
  conversation + codebase understanding into `work/prd/<slug>.md`).
- **🔪 Slice it** → injects `to-slices` (breaks a PRD into
  `work/backlog/<slug>.md` items). Could be offered only when a PRD exists.
- **🔍 Review** → `review` skill against a slice/PRD/code.
- **📥 Capture** → `capture-signal` (route a noticed signal to
  observations/findings/ideas/adr). This is the "before it evaporates" reflex —
  a single button lowers the cost of capturing to near zero, which is exactly
  when people actually do it.
- **❓ Batch Q&A** → `batch-qa` (gather all open questions across `work/` into
  one file to answer in a sitting).

Implementation: these are just **pre-baked user messages** sent via the existing
`sendUserMessage` path (the skills are already discoverable to pi). No protocol
change needed — it's a UI affordance. A small per-repo config can map
button → skill name so it stays declarative.

### 3b. A `work/` browser panel

A read-only tree view of the current repo's `work/` folder, grouped by status
(the folders): backlog / in-progress / done / needs-attention, plus the capture
buckets (ideas / observations / findings) and prd/. Clicking an item:

- shows the markdown (frontmatter: `slug`, `prd`, `humanOnly`, `needsAnswers`,
  `blockedBy`, …) rendered;
- offers actions that **delegate to the CLI**, never moving files directly:
  - **Run this slice** → `agent-runner do <slug>` (the CI/in-place worker) or
    `work-on <slug>` (human isolated worktree) — then auto-open/watch the
    resulting session (ties back to Idea 1).
  - **Requeue** (needs-attention → backlog) → `agent-runner requeue <slug>`.
  - **Open in worktree** → `work-on <slug> --print-dir` then start a session
    there.

This gives a developer a single mobile-friendly surface: see the queue, tap to
run a slice, watch the agent build it, review, integrate — without a terminal.

### 3c. Autonomy-gate toggles in the UI

The two-axis gate (`humanOnly` = decided, `needsAnswers` = discovered) is the
hard part to get right by hand-editing frontmatter on mobile. Offer toggles on a
slice/PRD card that edit just those fields. (Editing frontmatter is a content
edit, not a git-state transition, so it's allowed — but still safer to route via
a small `agent-runner` helper to keep the contract authoritative.)

---

## Cross-cutting ideas (emerged from the code)

### A. A wherever ↔ agent-runner status bridge command

The single most useful new thing on the **agent-runner** side would be a
machine-readable status: `agent-runner status --json` (running jobs, their
session dirs/logs, stuck items, repos registered). Everything in Idea 1 and 3b
becomes trivial polling/streaming for wherever. Liveness must come from the
harness (agent-runner invariant), so wherever should *consume* this rather than
stat'ing files.

### B. Notifications on needs-attention

wherever already has a notifications module (`web/src/lib/core/notifications/`).
Wire it so that when a job transitions to `needs-attention`, the watching
developer gets a push/notification: "slice `<slug>` in `<repo>` needs you." This
turns the autonomous runner into something you can leave running and get pinged
about from your phone — a natural fit for wherever's original mobile motivation.

### C. Server-enforced read-only as a first-class session mode

Today read-only is client-side UI state. To safely watch autonomous runners (and
to expose "watch" links you could share), make read-only a **server-tracked
per-client capability** (see 1b). This also benefits the plain multi-client case
(observers who shouldn't be able to steer).

### D. Keep wherever's git/gh out of agent-runner repos

wherever currently shells `git init` / `gh repo create` for new sessions. For
repos under the agent-runner protocol, wherever must **not** stage/commit/move
`work/` files or push — defer every git-state transition to the runner. A simple
guard: if a repo has a `work/` contract (or is registered with agent-runner),
wherever's direct git mutations are disabled and replaced by CLI delegation.

---

## Suggested phasing (smallest valuable slices first)

1. **Watch-only MVP (Idea 1a + 1b):** list agent-runner jobs (via a new
   `agent-runner status --json`) and open any one **read-only** to watch its
   conversation live. Server-enforced read-only. Highest value, reuses existing
   read-only + broadcast machinery.
2. **needs-attention notifications (B):** ping the watcher when a job gets stuck.
3. **Work action bar (3a):** one-tap PRD / slice / capture / review buttons that
   inject the existing skills into the current session.
4. **`work/` browser + delegated run (3b):** see the queue, tap to `do`/`work-on`
   a slice, auto-watch the run.
5. **Adopt-protocol repo setup (2a/2b):** extend New Session to scaffold or
   register an agent-runner repo (delegating to an agent-runner adopt skill/cmd).
6. **Per-repo config + autonomy toggles (2c/3c):** tune `allowAgents`,
   integration mode, and the two-axis gate from the UI.

## Open questions (for a grilling / PRD pass)

- Does agent-runner expose (or want to expose) `status --json` and an
  `init`/`adopt` command, or should wherever drive the skills directly via pi?
- Should "watch" attach via the live CLI bridge (1c) or tail the session file?
  (Bridge = live + abortable; file-tail = zero coupling to the harness.)
- Where does the wherever server discover jobs from — always `agent-runner`
  CLI, or also a direct scan of `~/.agent-runner/`? (CLI keeps liveness
  authoritative.)
- How much of the `work/` editing should wherever do directly vs. always via the
  CLI, given the "runner owns git-state transitions" invariant?
- Mobile UX: is the `work/` browser + watch the primary surface, or an add-on to
  the existing chat-first UI?
```

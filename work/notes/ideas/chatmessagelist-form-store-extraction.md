# ChatMessageList.svelte — further refactor ideas

`ChatMessageList.svelte` was 2547 lines. Increment 1 (commit `3a2cd18`) extracted all
**pure, non-reactive** logic into `chat-message-helpers.ts` (395 lines), bringing the
component to 2211 lines and its `<script>` to ~675 lines. What remains is almost entirely
**reactive / instance-bound**, so further extraction is governed by the project rule:
**no `.svelte.ts` / `.svelte.js` modules**. That means `$effect` cannot move out of the
component (effects only run inside a runes component or a `.svelte.ts` module), so anything
that *needs* an effect stays. Reactive state that can be expressed as Svelte stores
(`writable` / `derived`) can move to a plain `.ts` **factory**.

---

## Candidate: extract the new-session form into a store factory

The largest cohesive chunk of reactive logic left is the "new session" composer form:
path checking, autocomplete, git-init / remote-repo provisioning, and the git-init /
clone-existing-remote confirm modals.

**State today (runes, in the component):**
- `newFolderCwd`, `completions`, `newFolderModel`, `newFolderGitInit`,
  `userManualGitInit`, `createRemoteRepo`, `repoVisibility`
- `pathStatus` (`exists` / `isGit` / `resolvedPath` / `matchingRule`)
- `showGitInitConfirmModal`, `showCloneConfirmModal`, `checkingRemote`, `cloneRemoteInfo`
- derived: `isRemoteRepoCreation`, `defaultGitInit` (from `$gitInitDefaultStore`)
- effects: the `newFolderCwd` → `triggerCheck` debounce; the "select default model" effect
- actions: `triggerCheck`, `handleFormCreateSession`, `submitCreateSession`

**Proposed shape — `create-session-form.ts` (plain `.ts`, a factory so each component
instance gets its own state, no module-singleton leakage):**

```ts
import {writable, derived, get} from 'svelte/store';
import {checkPath, autocompletePath, checkRemoteRepo, availableModels, gitInitDefaultStore} from '$lib/session-store';
import {createSession} from '$lib/wherever';

export function createSessionForm() {
  const newFolderCwd = writable('');
  const completions = writable<string[]>([]);
  const pathStatus = writable<{exists: boolean | null; isGit: boolean; resolvedPath: string; matchingRule: any | null}>({...});
  // ...the rest as writables

  // derived stores
  const isRemoteRepoCreation = derived([pathStatus, createRemoteRepo], ([$p, $c]) => ...);

  // debounced path check, driven by a subscribe (replaces the $effect)
  let timer: ReturnType<typeof setTimeout> | null = null;
  newFolderCwd.subscribe((v) => { if (timer) clearTimeout(timer); timer = setTimeout(() => check(v), 300); });

  async function check(pathValue: string) { /* checkPath + autocompletePath → set writables */ }
  function setPath(v: string) { newFolderCwd.set(v); }
  async function submit() { /* handleFormCreateSession logic */ }
  function confirmCreate(cloneRemote: boolean) { /* submitCreateSession logic */ }

  return {newFolderCwd, completions, pathStatus, ..., isRemoteRepoCreation, setPath, submit, confirmCreate, ...};
}
```

**Component side:** instantiate once with `const form = createSessionForm();` (in
`$props`/top-level), then read via auto-subscription (`$form.newFolderCwd` etc. — works in
runes mode) and call `form.submit()` / `form.setPath(...)` from handlers.

**Cost / risk:**
- ~30+ template bindings change from `newFolderCwd` → `$form.newFolderCwd`, `pathStatus` →
  `$form.pathStatus`, etc. Mechanical but high-touch, and this is core session-creation UX.
- The `$effect`-driven debounce becomes a `subscribe` inside the factory — must be torn down
  (the factory can return a `destroy()` the component calls in an `$effect` cleanup, or use
  `onDestroy`).
- The "select default model" effect reads `$availableModels` / `$gitInitDefaultStore` —
  these are already stores, so a `derived`/`subscribe` in the factory works.
- Verify with `svelte-check` + `vite build` + `vitest` after; manually exercise the create
  flow (existing folder, new folder, remote-rule match, clone-existing) since there is no
  unit test covering the form today.

**Expected gain:** ~200 lines out of the component; the form becomes independently testable
(the factory can be unit-tested with mocked `checkPath`/`autocompletePath`/`createSession`).

---

## Stays in the component (can't move under the no-`.svelte.ts` rule)

- **Speech / TTS effects** — the `say`-speak `$effect`, the spoken-reply fallback `$effect`,
  the `armTtsGestureUnlock` `$effect`. These are `$effect`s and need a runes context. The
  *pure* helpers they use (`lastAssistantReply`, `speechLocale`, `shouldSpeakFallback`) are
  already extracted; the effect bodies are the irreducible reactive glue.
- **Scroll management** — `shouldAutoScroll` / `forceScroll` / `messageList` ref / the
  scroll-on-session-load and load-more-anchor effects. DOM-bound + effects → stays.
- **Per-message UI toggles** — `expandedMessages`, `rawMessages`, `copiedMessageId`. Cheap
  instance state; moving to stores adds indirection without much benefit.

If the no-`.svelte.ts` rule were ever relaxed, the speech and scroll effects would be the
next natural extractions (into `.svelte.ts` controllers). Under the current rule, the
component is close to its logic-less floor once the form store is extracted.

---

## Status
- [x] Increment 1: pure helpers → `chat-message-helpers.ts` (done, `3a2cd18`).
- [ ] Increment 2: new-session form → `create-session-form.ts` store factory (idea, not started).
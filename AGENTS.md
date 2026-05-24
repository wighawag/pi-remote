# Pi Remote - Agent Guidelines

Welcome, agent! When working on this codebase, please observe the following practices:

## 1. Always Create a Changeset When Done
This project uses `@changesets/cli` for versioning and package publishing. 
- After completing any implementation, feature, or bug fix, **always generate a changeset**.
- To generate a changeset, run:
  ```bash
  pnpm changeset
  ```
- Alternatively, you can create a custom changeset markdown file in `.changeset/` named randomly (or look at existing ones), containing:
  ```markdown
  ---
  'pi-remote': patch
  'pi-remote-server': patch
  ---

  <Good description of what was done>
  ```
  *(Check which packages were modified and version them appropriately with `patch`, `minor`, or `major`)*.

## 2. Document Your Changes
If you modify APIs, protocols, or core behaviors, update `CONTEXT.md` or any relevant files under `docs/` so subsequent sessions stay perfectly aligned.

## 3. Never Stage or Commit Changes unless Explicitly Asked
Do not run `git add` or stage files, and never create a commit yourself unless the user explicitly asks you to do so. Leave all changed files unstaged in the working directory.

## 4. Never Revert or Perform Destructive Operations Without Asking
- If the user asks to "revert to the last working state", clarify which specific visual or logical state they want to restore.
- Never discard or stash code changes, and never do broad git reverts unless explicitly asked or confirmed by the user. Always err on the side of preserving progress.

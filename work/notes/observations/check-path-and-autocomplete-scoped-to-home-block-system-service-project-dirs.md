# `/check-path` and `/autocomplete-path` are scoped to `$HOME`, which a system service will not share with its projects

**Spotted:** 2026-09-07, while making the server deployable as a declarative NixOS system service (read-only config dir, state dir, token from the environment).

## What was seen

`server/src/index.ts` gates two endpoints on `isWithinHome()` (defined at `index.ts:158`, used at `:1101` for `/check-path` and `:1193` for `/autocomplete-path`):

```ts
function isWithinHome(p: string): boolean {
  const home = os.homedir();
  const normalized = path.resolve(p);
  return normalized === home || normalized.startsWith(home + path.sep);
}
```

Anything outside `os.homedir()` answers `403 Path is outside the home directory`.

That is a reasonable guard for the shape the server has had until now: it runs as the developer's own user, and every project is under that user's home, so "inside `$HOME`" and "a folder this user works in" are the same set.

**A system service breaks that equivalence.** Under a systemd unit with its own service user, `HOME` is the state directory (e.g. `/var/lib/wherever`), while the projects live somewhere else entirely (`/srv/projects`, a data mount, another user's tree). Every project path is then outside `$HOME`, so the folder browser's existence check and path autocomplete should 403 for exactly the folders the deployment exists to work in, even though creating and running a session in those folders goes through a different path and is not gated this way.

## Why this is only an observation

Not verified against a running system service yet: this deployment has not happened, and it was found by reading, not by hitting it. Two things could make it a non-issue and neither has been checked:

- the sessions/folder-list surfaces (`/sessions`, `session_new`, `commonFolders`) do NOT use `isWithinHome`, so the dashboard may be perfectly usable without ever calling the two gated endpoints;
- setting `HOME` to a parent of the project tree would sidestep it, at the cost of putting the agent's home somewhere odd.

## Why the shape of the fix is not obvious (do not just delete the check)

The guard is doing real work: these two endpoints take an arbitrary caller-supplied path and report whether it exists / enumerate its children, which is a filesystem-probing primitive. Removing the bound would hand an authenticated caller a way to enumerate the whole disk. The likely correct fix is to scope them to the same set the rest of the server already treats as legitimate roots (`config.commonFolders`, `config.searchFolder`, existing session `cwd`s, and `$HOME`) rather than to `$HOME` alone, which is roughly what `resolveDownloadRoots()` does for `/session/download`. That is a design decision with a security surface, so it wants a task and not a drive-by edit.

## Related

- `docs/deployment-nixos.md` (the deployment that would hit this) carries a note pointing here.
- ADR `0006-config-dir-is-read-only-state-lives-in-a-separate-state-dir` is the same theme: assumptions that a home directory is where everything lives stop holding once the server is a system service.

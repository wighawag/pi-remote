---
"wherever-dev": patch
---

Add an automated npm publish (approve) flow via Changesets and GitHub Actions. Landing a changeset on `main` opens/updates a "Version Packages" PR; approving and merging that PR builds every package and runs `changeset publish` to npm. Publishing uses npm Trusted Publishing (OIDC, no `NPM_TOKEN`) with provenance, so each published package (`wherever-dev`, `@wherever-dev/client`, `@wherever-dev/pi`) must register this repo + `release.yml` as a trusted publisher. Adds `build:all` (builds `client` first so the extension resolves it, then the web/server/extension bundle with the web UI embedded into `server/public`, then `vscode`) and a `release:ci` script for the workflow.

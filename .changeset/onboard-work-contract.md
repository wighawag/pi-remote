---
"wherever-dev": patch
---

Onboard the repo onto the file-based `work/` contract: add the contract skeleton
(`work/tasks`, `work/specs`, `work/questions`, synced `work/protocol/` docs),
migrate the bespoke `work/briefs/ready/` specs to `work/specs/ready/` and
`work/ideas/` to `work/notes/ideas/` (history-preserving renames), add a
`dorfl.json` gate (`verify` = `pnpm format:check && pnpm build:all && pnpm run -r test`,
`prepare` = `pnpm install --frozen-lockfile`, `promptGuidance.testFirst`), and
document the conventions + contract layout in `CONTEXT.md`. No runtime code changed.

2026-07-20 — Decision (inline-audio-player): in `ChatMessageList.svelte` the
generic tool-card AUDIO branch is gated only on `dlUrl && dlKind === 'audio'`,
deliberately WITHOUT the `!(msg.images && msg.images.length > 0)` de-dup guard the
sibling IMAGE branch carries. Rationale: `msg.images` only ever holds model-facing
IMAGE content blocks (base64), so a `read` on an audio file never populates it —
there is nothing to de-dup against, and image/audio branches are mutually exclusive
by `dlKind`. Alternative considered: mirror the guard for symmetry; rejected as
dead condition that would mislead readers into thinking audio can collide with
`msg.images`. Touches: the shared de-dup seam from `inline-images-and-narrow-download-tools`.

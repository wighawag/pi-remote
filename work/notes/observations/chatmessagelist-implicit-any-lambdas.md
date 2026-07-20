2026-07-20 — `web/src/lib/components/ChatMessageList.svelte` has 8 pre-existing
`svelte-check` errors ("Parameter 'msg'/'m' implicitly has an 'any' type") on the
`$messages.filter(...)`/`.some(...)` lambdas around lines 584/604/607/629. Present
on the committed file before any edits (verified: identical 8 errors with the file
reverted). Out of scope for the inline-images task; not fixed.

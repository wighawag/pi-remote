---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Fix a `/skill:<name>` invocation showing up as TWO messages: the raw optimistic echo (which then flipped to "Not delivered / Retry" and persisted across reloads) plus the transformed skill chip. The client optimistically echoes the raw `/skill:...` invocation, but the server confirms it with a raw `message_ack` and later echoes back the expanded `<skill>` block, so exact-content delivery matching missed and appended a duplicate. Delivery confirmation now matches the raw optimistic bubble to the expanded server echo by skill-invocation identity (name + args) and rewrites it in place, so there is a single confirmed skill chip. Adds shared `parseSkillInvocation` / `skillInvocationIdentity` helpers to `@wherever-dev/client` (now used by the web instead of a local copy).

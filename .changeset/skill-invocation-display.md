---
"wherever-dev": patch
---

Display `/skill:<name>` invocations as a compact skill chip instead of the expanded skill body. Skill commands are still expanded server-side so the agent receives the full skill content, but the web now recognizes the expanded `<skill>` block (in both live echoes and reloaded history) and renders a distinct skill-invocation bubble showing the skill name plus any argument text the user typed after `/skill:<name>`.

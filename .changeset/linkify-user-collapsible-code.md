---
"wherever-dev": patch
---

Chat rendering improvements: user messages now linkify bare URLs (http(s):// and www.) into clickable links without reinterpreting other characters as markdown, and long fenced code blocks (triple backtick) in assistant messages render as collapsible `<details>` showing the language plus a truncated first line so they no longer clutter the log. Single-line code blocks stay expanded.

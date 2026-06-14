---
"wherever-dev": minor
---

Reuse the chat composer as the search composer instead of a separate top-bar input.

ChatInput is now mode-aware via props (onSubmit, placeholder, submitLabel, showAttach, searchMode, searchConfigured). In search mode it routes submit to the injected handler (runSearch), is enabled with no active session (requires only a live connection and a configured search folder), shows the "Search the web..." placeholder and "Search" button, hides file attach, and skips slash-command handling. The mic, autosize, and Shift+Enter behaviour are kept in both modes.

On the page the inline single-line top-bar search input is removed. The always-mounted bottom composer becomes the search composer in the empty state (connected, search folder configured, no active session), which is also the page-load state, so users can type directly. When a session is active, a compact magnifier button in the top bar drops back to the search empty state and focuses the composer synchronously inside the tap gesture so the mobile virtual keyboard rises (notably on iOS Safari). Only one search input is ever shown at a time.

Also fixes a bug where a search query was silently dropped: the client runs app message listeners before its internal state update, so sending the pending query directly from the session_created handler hit sendMessage while sessionId was still null. The query is now deferred to a microtask so the session is fully established first, and the magnifier clears the URL hash synchronously to avoid flashing the "Loading session..." spinner.

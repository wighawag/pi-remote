---
"wherever-dev": patch
---

Search mode: let the user pick the model before searching, and make the default folder-aware.

The main-page search composer now shows a compact model picker (same list as the sidebar new-session picker). The selection is seeded from the search folder's default model, which the server now resolves against that folder's own settings (a folder-local harness/pi config default wins over the server global). The chosen model is threaded through `runSearch` into session creation, so a search runs on the selected model instead of always falling back to the global default. The top-bar magnifier needs no separate control: it just focuses the same composer.

Server: `getAvailableModels(cwd?)` now resolves `isDefault` against an optional folder, a new `getDefaultModelFor(cwd)` returns a folder's default as `provider:modelId`, and `GET /config` includes `searchDefaultModel` for the configured search folder.

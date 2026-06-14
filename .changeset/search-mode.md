---
"wherever-dev": minor
---

Add a web "search mode". A search bar in the dashboard top bar (visible when connected and a search folder is configured, autofocused on first load) creates a fresh session in the configured search folder and sends the query as the first message, returning a current, cited answer. New `searchFolder` and `searchCreateRemote` config keys (in `~/.wherever/config.json`) are exposed via `GET /config`; the search folder is created on demand on first search, with a private remote when `searchCreateRemote` is enabled and a matching remote rule exists. The reusable web-search skill (in `skills/web-search`) drives the same behaviour from the terminal via the companion `pisearch` installer.

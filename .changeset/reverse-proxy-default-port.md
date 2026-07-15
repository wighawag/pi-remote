---
"wherever-dev": patch
---

Web dashboard: connect back to the page's own origin port by default instead of always assuming 31415. When the dashboard is served behind a reverse proxy (e.g. Caddy on 443 with no port in the URL), the client previously forced `wss://host:31415/ws`, which is a closed port in that setup, so it hung on "Connecting to Wherever Server...". Now an unconfigured port resolves to the page's port (443/80/whatever the origin uses), and a legacy stored `31415` is healed to the page's port when the dashboard is actually served from a different origin. Direct `http://host:31415` LAN setups and explicit user-set ports are unaffected.

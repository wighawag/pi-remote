---
"pi-remote-server": patch
---

Fixed session list issues in the sidebar:

- Fixed duplicate folder entries by properly resolving path representations (like expanding ~ and relative paths) consistently on the server.
- Added keyed loops in Svelte `#each` blocks to make session list rendering reactive and prevent unnecessary DOM rebuilds.
- Debounced `fetchSessions()` calls to coalesce rapid concurrent requests during bulk operations.
- Added a "Delete All" button inside each folder's expanded session list to delete all sessions of that folder at once.
- Prevented visual reloading/layout-flashing by keeping the existing list visible during background refreshes, only displaying the loading spinner on initial load when the folder list is empty.

---
"pi-remote-server": patch
"pi-remote": patch
---

Ensure model choices are preserved across page reloads, server restarts, and synchronized dynamically between web and CLI.

Specifically:
- Fixed an issue where the model resolved to the first (oldest) model_change entry on session reload/restart instead of the most recent one.
- Added model_select event propagation so that changing the model in a CLI session dynamically updates any connected web client.
- Added support in the CLI bridge extension to receive and apply model changes initiated from the remote web dashboard.

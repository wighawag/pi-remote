---
"wherever-dev": patch
---

Fix: unqueuing a queued message now restores its text into the editable input (so it can be edited or resent) instead of silently discarding it. Previously `Unqueue` cleared the input even though a backup of the message existed.

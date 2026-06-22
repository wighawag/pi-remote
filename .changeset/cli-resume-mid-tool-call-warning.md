---
"@wherever-dev/pi": patch
---

Warn when the CLI resumes a session mid-tool-call. When a session is actively running in the web frontend (a tool call in flight) and the user joins via the pi CLI (`/resume`), the loaded transcript ends with an assistant `tool_use` that has no matching `toolResult`. pi cannot auto-continue from that state, so the CLI silently sat idle as if the turn were complete. The extension now detects a dangling tool call on the active branch at `session_start` (resume/reload/startup) and surfaces it via a notification and a status widget, so the user understands why nothing is happening (the result may still be running in another client) instead of mistaking it for a finished turn. The warning clears when the agent next runs or on session shutdown. This is a detection-and-surface mitigation; preserving the live run on join (observer-on-resume) is tracked in `work/briefs/ready/cli-observer-on-resume-of-live-session.md`.

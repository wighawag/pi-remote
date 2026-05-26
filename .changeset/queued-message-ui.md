---
"pi-remote-server": patch
---

Show queued message text in input box as greyed-out italic text when agent is streaming

When a message is queued (sent while agent is working), the text is now visible in the disabled textarea in a grey italic style instead of being hidden. Unqueueing clears the text and re-enables editing. Also added a refresh button (↻) next to the session filter in the sidebar to manually refresh the session list, with a spinning animation while loading.

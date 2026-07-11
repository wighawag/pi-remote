---
"wherever-dev": patch
"@wherever-dev/client": patch
---

Never silently lose a message when the connection drops mid-send; confirm delivery and recover it on reload.

A frame handed to a socket that reports OPEN can still never reach the server (a half-open TCP connection: `send()` buffers locally and does not throw, but the bytes never land). The optimistic echo was treated as delivered, the input was cleared, and on reload the message was gone with no way to recover it.

Outbound user messages are now tracked as `delivery: 'sending'` until the server echoes them back (`message_end` role:user), at which point they are confirmed. If no echo arrives within a window, the message flips to `delivery: 'failed'` and the UI surfaces "Not delivered" with Retry / Discard instead of a normal-looking sent message. Unconfirmed messages are persisted per session, so a reload reconciles them against the loaded history: anything the server actually persisted is shown as delivered, and anything it did not is re-surfaced as a recoverable failed message (never silently dropped). New client APIs: `resendMessage(id)` and `discardMessage(id)`.

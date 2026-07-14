---
"@wherever-dev/client": patch
"@wherever-dev/pi": patch
---

Fix a crash that could take down the pi CLI (not the wherever server) when a session was torn down while the client's WebSocket was still connecting, typically when the wherever server is not running. Calling `close()` on a socket that is still in the `CONNECTING` state makes `ws` abort the handshake and emit an `'error'` event asynchronously on the next tick; because `disconnect()` had already removed every listener, that error became an unhandled `EventEmitter` error and surfaced as an `uncaughtException` ("WebSocket was closed before the connection was established"), exiting the process. The existing try/catch could not help since the error was emitted asynchronously rather than thrown synchronously. `disconnect()` now attaches a no-op `'error'` sink to the socket it is tearing down (in both the node `ws` and browser `WebSocket` environments) so the late handshake-abort error is swallowed instead of crashing pi.

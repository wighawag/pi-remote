---
"wherever-dev": patch
---

Fix the server test harness, which spawned the server without the required `start` verb. Since the explicit verb dispatch was introduced, a bare invocation prints usage and exits, so `/health` never came up and every gate test failed with "server did not become healthy". The harness now passes `start`, and the full suite (6 files, 11 tests) is green again.

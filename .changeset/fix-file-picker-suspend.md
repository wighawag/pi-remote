---
"wherever-dev": patch
---

Fix uploads failing with "No active session" after using the file picker / camera. Opening a native file picker backgrounds the page and fires `visibilitychange: hidden`. If the user took longer than the 8s background-suspend delay (e.g. taking a photo or browsing files), the suspend timer tore down the session, so the upload that ran on return failed. The visibility handler now skips scheduling a suspend while a native file picker is open, and clears that guard when the picker closes (file selected, cancelled, or the page returns to the foreground).

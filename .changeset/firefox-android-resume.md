---
"wherever-dev": patch
---

Improve resume behaviour after the page is backgrounded (notably Firefox on Android after a screen lock). The dashboard now closes its WebSocket after the page has been hidden for a short delay and reconnects immediately on return, improving back/forward-cache eligibility (so resume can be instant) and ensuring that, when a full reload does happen, the active session is restored quickly from the URL hash. Quick tab switches do not churn the connection.

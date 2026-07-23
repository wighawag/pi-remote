---
"wherever-dev": patch
---

Make the per-message "Fork" button clearly visible with a proper hover state.

The Fork action lived inside the message footer, which is rendered at 50% opacity; a parent opacity caps its children, so the button looked greyed out and its `hover:opacity-100` had almost no effect. It now renders as its own fully-opaque bordered chip below the timestamp, with a distinct blue hover (border, tint, and text), so it is easy to see and clearly interactive.

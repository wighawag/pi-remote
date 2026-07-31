# Bug: No Conversation Mode Toggle on Home Screen

## Context

When you're on the home screen (no session active) and click the search button, there's no conversation mode toggle available. The conversation mode toggle is only in the top bar when you have an active session.

## Current Behavior

- The conversation mode toggle (`🗣️`/`💬`) only appears in `ChatMessageList.svelte` when there's an active session
- On the home screen or search mode, there's no way to enable conversation mode before starting a search
- User must first create/join a session before they can use conversation mode

## Expected Behavior

- User should be able to enable conversation mode from the home screen
- This allows them to start a search with conversation mode already active
- Or at minimum, conversation mode should be available as a global setting that applies to all new sessions

## Implementation Notes

The conversation mode toggle is currently scoped to `ChatMessageList.svelte`, which only renders when there's an active session. To make it available on the home screen, we need to:

1. **Option 1: Move toggle to global top bar**
   - Move the conversation mode toggle from `ChatMessageList.svelte` to `+page.svelte` (the global top bar)
   - This makes it always visible regardless of session state
   - Pros: Simple, always accessible
   - Cons: Takes up space in the top bar

2. **Option 2: Add toggle to search composer**
   - When search mode is active, show a conversation mode toggle in the search composer area
   - Pros: Contextually relevant
   - Cons: Only available in search mode, not on the general home screen

3. **Option 3: Default setting in Connection Settings**
   - Add a "Enable conversation mode by default for new sessions" checkbox in Connection Settings
   - This doesn't solve the immediate need but makes it easier to enable
   - Pros: Simple configuration
   - Cons: Doesn't address the UX gap

The cleanest approach is option 1: move the conversation mode toggle to the global top bar in `+page.svelte`, so it's always accessible regardless of session state.
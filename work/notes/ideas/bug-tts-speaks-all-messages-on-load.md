# Bug: TTS Speaks All Messages on Session Load

## Context

When a session is loaded, the TTS system speaks ALL `say` tool calls it finds in the message list, not just the most recent one. This includes old tool descriptions being read aloud that the user has already heard or that shouldn't be spoken.

## Current Behavior

- User loads or reconnects to a session with existing conversation history
- TTS system speaks ONE `say` tool call from the message list on load/reconnect
- It picks the first `say` message it finds that hasn't been spoken yet (based on `spokenSayIds` set)
- This is often an old tool description or previous turn's reply that the user has already heard
- The user hears an unexpected message being read aloud when they expected silence

## Expected Behavior

- TTS should NOT speak anything on session load or reconnect
- Only NEW `say` messages that arrive after the user is connected should be spoken
- The user should have control over when TTS starts speaking, not have it auto-play on load

## Root Cause

In `ChatMessageList.svelte`, the `$effect` that handles TTS iterates through the ENTIRE message list:

```typescript
for (const msg of list) {
  if (msg.role !== 'tool' || msg.toolName !== 'say') continue;
  if (msg.isStreaming) continue; // wait for the final text
  if (spokenSayIds.has(msg.id)) continue;
  // Mark first so a failed/again render never double-speaks.
  spokenSayIds.add(msg.id);
  if (msg.isError) continue;
  if (!isKnobActive('speakReplies', getConversationKnobs())) continue;
  const parsed = parseToolMessage(msg);
  if (!parsed.sayText) continue;
  spokeThisTurn = true;
  speakUtterance(parsed.sayText, speechLocale());
}
```

When a session is loaded or reconnected:
1. The `spokenSayIds` set is empty (fresh state)
2. The effect iterates through ALL messages in the list
3. It finds the FIRST `say` message that hasn't been spoken yet
4. It speaks that message, even if it's from a previous turn
5. The message gets added to `spokenSayIds` so it won't be spoken again

The bug is that it speaks ANY `say` message it finds, not just the most recent one or only new ones.

## Fix

The TTS system should NOT speak any `say` messages when a session is loaded or reconnected. Only NEW `say` messages that arrive AFTER the user is connected and the session is fully loaded should be spoken.

## Implementation Approach

Option 1: Skip existing messages on load/reconnect
- Track whether this is a fresh load or reconnect (e.g., using a flag or checking message timestamps)
- If so, skip all existing `say` messages in the list
- Only speak `say` messages that arrive AFTER the initial load is complete

Option 2: Use a "ready" flag
- Set a flag when the session is fully loaded and the user is ready to receive TTS
- Only speak `say` messages that arrive after this flag is set
- This prevents the initial burst of speech on load

Option 3: Only speak the most recent `say` message
- Instead of iterating through all messages, find the LAST `say` message in the list
- Only speak that one, and only if it's from the current turn (after the last user message)
- This ensures the user hears the most recent spoken reply, not an old one

The simplest fix is Option 1 or 2: prevent TTS from speaking anything during the initial session load, and only start speaking new messages after the session is fully ready.
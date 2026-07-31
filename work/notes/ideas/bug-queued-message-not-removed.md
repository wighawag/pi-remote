# Bug: Queued Message Not Removed from Display

## Context

When a user queues a message and then unqueues it before the agent has time to process it, the message still appears in the conversation display until the page is reloaded. This is purely a display bug.

## Current Behavior

- User queues a message (e.g., by sending it while agent is streaming)
- User then unqueues the message (e.g., by canceling the steer)
- The message remains visible in the conversation display
- Only a page reload removes it from the display

## Expected Behavior

- When a queued message is unqueued, it should immediately disappear from the conversation display
- No page reload should be required

## Root Cause

The message list is not being properly updated when a queued message is unqueued. The display still shows the message even though it's no longer in the queue.

## Implementation Notes

This is a display-only bug. The message is correctly removed from the queue (as evidenced by the fact that the agent doesn't process it), but the UI doesn't reflect this change.

Possible fixes:
1. Ensure the message list is properly reactive to queue changes
2. When unqueuing a message, explicitly remove it from the display list
3. Add a check in the display logic to filter out unqueued messages
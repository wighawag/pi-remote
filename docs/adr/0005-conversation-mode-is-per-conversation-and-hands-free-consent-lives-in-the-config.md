# Conversation mode is scoped per CONVERSATION, and hands-free consent lives in the CONFIG

**Status:** accepted

Two scope corrections to conversation mode, both of the same shape: a decision was being made in the wrong place (globally, or per conversation) relative to where the user actually expressed their intent.

## 1. The master toggle is PER CONVERSATION, over a global default

Conversation mode shipped as one global flag: the top-bar toggle flipped `conversationMode` in the persisted config, so turning it on while talking to one session turned it on everywhere. That is wrong for what the mode IS. A spoken back-and-forth is a property of the conversation you are having (this one is a hands-free chat on a phone; that one is a long code review you read in silence), not a property of the application. The global flag also leaked onto the WIRE: `sendOptions()` stamps the per-turn conversation-mode signal from the same value, so a message sent from any other session carried "a spoken conversation is active" and invited a `say` reply there too.

The fix mirrors, deliberately and exactly, the pattern the waiting-for-human beep already uses (`beepDefault` + `wherever-beep-overrides`), because the semantics needed are identical and a second, differently-shaped mechanism for "per-session choice over a default" would be a worse codebase:

- the `conversationMode` config field becomes the DEFAULT for conversations that have not been toggled (no migration: an existing user's persisted `true` simply becomes their default);
- each session may hold its own explicit choice, persisted per session key (`wherever-conversation-mode-overrides`), which wins;
- "unset" is a real, distinct third state: an untoggled conversation FOLLOWS the default live (change the default and it moves), while a toggled one STICKS;
- `resolveConversationMode(override, default)` is the single pure rule, `conversationMode` becomes a derived store over it, and everything downstream (`getConversationKnobs`, `sendOptions`, TTS, collapse, hands-free) reads the resolved value with no further changes.

**What is NOT per conversation:** the gated knobs (`speakReplies`, `collapseLongReplies`, `micReopensAfterReply`) stay global settings. They describe HOW a spoken conversation behaves, and a user configures that once; only WHETHER this conversation is a spoken one belongs to the conversation. The top-bar toggle therefore edits the conversation, and Connection Settings edits the default plus the knobs. With no conversation open the toggle has nothing to scope to, so it edits the default (better than a control that silently does nothing).

## 2. Hands-free mic re-open: the confirmation is in the CONFIG, not in the conversation

`decideMicReopen` auto-recorded only on the BROWSER speech engine; on the CLOUD engine it fell back to re-focusing the composer, on the stated grounds (Open Question 3 of the original task) that auto-recording without a gesture would surprise the user.

That reasoning is now rejected. The user's consent for "re-open my mic after each reply" is the `micReopensAfterReply` knob they turned ON in settings, given once, deliberately, for every conversation. Requiring a second, per-conversation confirmation (a tap) made the knob lie about what it does, and it did so worst exactly where the feature matters most: a phone user, who is the most likely to be on the cloud engine, still tapped the mic every single turn, which is the tap the hands-free loop exists to remove.

What the cloud engine genuinely lacks is not consent but a STOP condition: unlike the browser engine (which endpoints its own utterance), it records until told to stop, so a gesture-lessly opened cloud recording had no way to end. So the gate is replaced with `createAutoStopDetector()`:

- stop after ~2s of silence FOLLOWING speech (the normal end of a hands-free turn);
- stop after ~6s if nobody ever spoke (the mic re-opened into an empty room);
- a hard ~60s ceiling, so a hot mic in a noisy room cannot record, upload and bill forever;
- fed from the PCM frames `SpeechButton` already captures (RMS per frame) rather than a wall-clock timer, so a throttled background tab cannot mis-time it, and the decision sticks once made.

**A recording the user opened by TAPPING never gets a detector.** There, the user's next tap is the stop, and taking that away would be the genuinely surprising behaviour. The auto-stop applies only to recordings the hands-free loop itself opened.

## Consequence for future knobs

The general rule these two share, worth applying to the next knob: put the decision where the user expressed the intent. A setting the user configured once is a standing instruction, and code should not demand a per-use re-confirmation it never asked for; while state that describes ONE conversation must be scoped to that conversation and must not leak into the others (or onto the wire).

// Pure decision helper for what a composer submit should DO, extracted from
// ChatInput.svelte so the behaviour is deterministically unit-testable (the
// component itself is not exercised by the node-env vitest run).
//
// This encodes the pi-CLI default: a submit made WHILE the agent is streaming
// STEERS immediately (the server turns a mid-stream `message` into a `steer`,
// injected at the next tool/step boundary before the next LLM call). There is
// NO local "wait for the turn to finish" queue and no isStreaming-driven
// auto-drain: an explicit user submit is sent right away, exactly like pressing
// Enter in the pi CLI (interactive-mode.ts calls
// `session.prompt(text, { streamingBehavior: "steer" })`).
//
// `deliverAs` is carried on the `send` outcome so an explicit opt-in follow-up
// (pi's Alt+Enter "wait until the agent finishes") can be added later WITHOUT
// reworking this seam: the default submit is always `steer`.

export interface ComposeSendInput {
	/** The agent is mid-turn (a stream is active) on the server. */
	streaming: boolean;
	/** There is a live relay connection (real socket, not a stale flag). */
	connected: boolean;
	/** The session transcript is loaded but its live agent is still building. */
	agentPending: boolean;
	/** The session is observe-only; sending is not allowed. */
	readOnly: boolean;
	/** An active session is open to send into. */
	hasSession: boolean;
}

export type ComposeSendResult =
	| {
			/** Send now. `deliverAs` tells the intent for a mid-stream send. */
			action: 'send';
			deliverAs: 'steer' | 'followUp';
	  }
	| {
			/** Do not send; the composer should stay put and surface `reason`. */
			action: 'blocked';
			reason: 'no-session' | 'read-only' | 'disconnected' | 'agent-pending';
	  };

/**
 * Decide the outcome of a composer submit.
 *
 * Key property (the whole point of this change): when the agent is streaming on
 * a live connection, the result is `{action:'send', deliverAs:'steer'}` -- an
 * IMMEDIATE send. It is never a "queue and wait" outcome. The only non-send
 * results are genuine block conditions (no session / read-only / disconnected /
 * agent still building), which keep the user's text intact instead of silently
 * swallowing it.
 *
 * @param opts.followUp opt-in to pi's "wait until the agent finishes"
 *   (Alt+Enter) behaviour for THIS submit; defaults to steer.
 */
export function decideComposeSend(
	input: ComposeSendInput,
	opts?: {followUp?: boolean},
): ComposeSendResult {
	if (!input.hasSession) return {action: 'blocked', reason: 'no-session'};
	if (input.readOnly) return {action: 'blocked', reason: 'read-only'};
	if (!input.connected) return {action: 'blocked', reason: 'disconnected'};
	if (input.agentPending) return {action: 'blocked', reason: 'agent-pending'};

	// Streaming or not, an explicit submit sends now. When streaming, the server
	// delivers it as steer (or followUp if the caller opted in); when idle, the
	// deliverAs field is irrelevant (the server sends it as a normal prompt).
	return {
		action: 'send',
		deliverAs: opts?.followUp ? 'followUp' : 'steer',
	};
}

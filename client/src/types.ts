export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'thinking' | 'tool';
	content: string;
	timestamp: number;
	isStreaming?: boolean;
	sessionId?: string;
	toolName?: string;
	toolArgs?: string;
	toolOutput?: string;
	isError?: boolean;
	// Wall-clock start of a tool call (ms epoch), set when the tool_start frame
	// arrives. `timestamp` also carries this, but startedAt is kept explicit so
	// the elapsed/took duration is unambiguous and survives content rewrites.
	startedAt?: number;
	// Wall-clock end of a tool call (ms epoch), set when tool_end arrives. While a
	// tool is running this is undefined and the UI ticks a live "Elapsed N.Ns";
	// once set the UI freezes it as "Took N.Ns" (mirrors the pi CLI).
	endedAt?: number;
}

export interface ConflictInfo {
	targetSessionId: string;
	conflictingSessionId: string;
	conflictingCwd: string;
}

export interface WhereverState {
	connected: boolean;
	connecting: boolean;
	creatingSession: boolean;
	// True from the moment a session_load is requested until its message_history
	// (or an error/conflict) arrives. Distinguishes "opening an existing session"
	// from "a brand new empty session" so the UI can show a loading state instead
	// of the "New Session Started" empty state.
	loadingSession: boolean;
	// True while the connection was suspended (e.g. the tab was backgrounded) and
	// is now reconnecting + rejoining the previously-active session. The cached
	// messages remain visible; the UI shows a "reconnecting/syncing" affordance
	// and blocks input until the resync completes.
	resyncing: boolean;
	// True after a `pending` session_created (history painted from a cheap read)
	// until session_ready arrives (the live agent finished building). The
	// conversation is READABLE during this window, but SENDING must be blocked:
	// reading only needs the transcript, sending needs the live agent. Distinct
	// from loadingSession/resyncing, which gate the whole view; agentPending gates
	// only the composer so opening a cold session to read is instant.
	agentPending: boolean;
	error: string | null;
	session: string | null;
	sessionId: string | null;
	isStreaming: boolean;
	messages: ChatMessage[];
	clientId: string | null;
	conflict: ConflictInfo | null;
	isInterrupted: boolean;
	sessionError: string | null;
	readOnly: boolean;
	activeSessionFile: string | null;
	activeCwd: string | null;
	activeModel: string | null;
	hideThinking: boolean;
	hideTools: boolean;
	// Tail-first history pagination. `historyTotalCount` is the total number of
	// history messages on the server; `historyOffset` is the index of the first
	// message currently loaded in `messages`. When `historyOffset > 0`, older
	// history can be fetched via `loadMoreHistory()`.
	historyTotalCount: number;
	historyOffset: number;
	loadingMoreHistory: boolean;
	// Context-window usage for the active session (drives the "11.3% / 1.0M"
	// indicator). null when unknown (no model, no usage yet, or just compacted).
	contextUsage: ContextUsage | null;
}

export interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

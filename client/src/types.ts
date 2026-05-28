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
}

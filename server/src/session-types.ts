/** Context-window usage snapshot surfaced in the UI (e.g. "11.3% / 1.0M"). */
export interface ContextUsageInfo {
  /** Estimated context tokens, or null if unknown (e.g. right after compaction). */
  tokens: number | null;
  /** The model's context window size in tokens. */
  contextWindow: number;
  /** tokens / contextWindow as a percentage, or null if tokens is unknown. */
  percent: number | null;
}

export interface SessionInfo {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  model?: string;
  clientCount: number;
  isIdle: boolean;
  createdAt: number;
  lastActivity: number;
}

export interface FolderSessionInfo {
  path: string;
  id: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  /**
   * A SHORT, whitespace-collapsed PREVIEW of the first user message (capped
   * server-side), not the full text. The sidebar only shows a snippet and
   * filters on it; shipping the full first message of every session is what
   * bloated the /sessions payload.
   */
  firstMessage: string;
  isActive: boolean;
  clientCount: number;
}

export interface FolderWithSessions {
  path: string;
  name: string;
  sessions: FolderSessionInfo[];
  /** True when this folder's cwd matched a sessions.readOnly glob. */
  readOnly?: boolean;
}

export interface SessionsResponse {
  folders: FolderWithSessions[];
  activeSessions: SessionInfo[];
}

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'thinking' | 'tool_call' | 'tool_result';
  content: string;
  timestamp: number;
  toolName?: string;
  isError?: boolean;
}

export interface ModelInfo {
  provider: string;
  modelId: string;
  label: string;
  isDefault?: boolean;
}

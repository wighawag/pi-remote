import { HistoryMessage, ContextUsageInfo } from './session-types.js';
export type { ContextUsageInfo } from './session-types.js';

// Initial number of (most recent) history messages sent when a session is
// loaded/joined. Older messages are fetched lazily via `history_load_more`.
export const INITIAL_HISTORY_LIMIT = 60;
// Number of older messages returned per `history_load_more` request.
export const HISTORY_PAGE_SIZE = 60;

export type ClientMessage =
  | { type: 'connect' }
  | { type: 'message'; message: string; sessionId: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'ping' }
  | { type: 'session_load'; sessionFile: string; cwd?: string; model?: string }
  | { type: 'history_load_more'; sessionId: string; beforeOffset: number }
  | { type: 'session_new'; cwd: string; model?: string; gitInit?: boolean; createRemote?: boolean; repoVisibility?: 'private' | 'public' }
  | { type: 'session_leave'; sessionId: string }
  | { type: 'session_resolve_conflict'; action: 'take_over' | 'read_only'; sessionId: string; cwd?: string }
  | { type: 'model_change'; model: string }
  | { type: 'file_upload'; uploadId: string; sessionId: string; filename: string; data: string }
  | { type: 'cli_register'; sessionFile: string; cwd: string; model?: string }
  | { type: 'cli_event'; sessionFile: string; event: any }
  | { type: 'cli_message'; message: string; streamingBehavior?: 'steer' | 'followUp' }
  | { type: 'cli_abort' }
  | { type: 'cli_bash'; command: string; excludeFromContext?: boolean }
  | { type: 'cli_model_change'; model: string };

export type ServerMessage =
  | { type: 'connected'; clientId: string }
| { type: 'agent_start'; sessionId: string }
 | { type: 'thinking_update'; sessionId: string; delta: string }
 | { type: 'message_update'; sessionId: string; delta: string }
  | { type: 'message_end'; sessionId: string; content: string; role?: 'user' | 'assistant' }
  | { type: 'agent_end'; sessionId: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; args: unknown }
  | { type: 'tool_update'; sessionId: string; toolName: string; delta: string }
  | { type: 'tool_end'; sessionId: string; toolName: string; isError: boolean; result?: string }
  | { type: 'cli_bash'; command: string; excludeFromContext?: boolean }
  | { type: 'session_created'; sessionId: string; sessionFile: string; cwd: string; model: string; isStreaming?: boolean; readOnly?: boolean; contextUsage?: ContextUsageInfo | null; pending?: boolean }
  // Sent after a `pending` session_created once the live agent has finished
  // building (createAgentSession). Until it arrives, the UI can render the
  // conversation (from message_history) but must keep the composer disabled:
  // reading is instant, sending needs the live agent. May carry a refreshed
  // model/isStreaming/contextUsage now that the real agent exists.
  | { type: 'session_ready'; sessionId: string; sessionFile: string; model?: string; isStreaming?: boolean; contextUsage?: ContextUsageInfo | null }
  | { type: 'context_usage'; sessionId: string; contextUsage: ContextUsageInfo | null }
  | { type: 'session_destroyed'; sessionId: string; reason: string }
  | { type: 'session_error'; sessionId?: string; error: string; detail?: string }
  | { type: 'session_conflict'; sessionId: string; conflictingSession: string; conflictingCwd: string }
  | { type: 'session_interrupted'; sessionId: string; reason: string }
  | { type: 'message_history'; sessionId: string; messages: HistoryMessage[]; totalCount?: number; offset?: number }
  | { type: 'message_history_prepend'; sessionId: string; messages: HistoryMessage[]; offset: number }
  | { type: 'model_changed'; sessionId: string; model: string }
  | { type: 'file_uploaded'; uploadId: string; sessionId: string; filename: string; savedPath: string }
  | { type: 'file_upload_error'; uploadId: string; sessionId: string; error: string }
  | { type: 'sessions_updated' }
  | { type: 'pong'; timestamp: number };

import { HistoryMessage, ContextUsageInfo, ToolImage } from './session-types.js';
export type { ContextUsageInfo, ToolImage } from './session-types.js';

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
  | { type: 'session_new'; cwd: string; model?: string; gitInit?: boolean; createRemote?: boolean; repoVisibility?: 'private' | 'public'; cloneRemote?: boolean }
  | { type: 'session_leave'; sessionId: string }
  // Client -> server: the user clicked "Continue anyway" on the folder-conflict
  // warning banner. The server lifts this client's read-only flag so it can send
  // into its session even though another session in the same folder is active.
  // It does NOT abort or take over the other session; both run concurrently.
  | { type: 'folder_conflict_continue'; sessionId: string }
  | { type: 'model_change'; model: string }
  | { type: 'file_upload'; uploadId: string; sessionId: string; filename: string; data: string }
  | { type: 'cli_register'; sessionFile: string; cwd: string; model?: string; isStreaming?: boolean }
  | { type: 'cli_event'; sessionFile: string; event: any }
  | { type: 'cli_message'; message: string; streamingBehavior?: 'steer' | 'followUp' }
  | { type: 'cli_abort' }
  | { type: 'cli_bash'; command: string; excludeFromContext?: boolean }
  | { type: 'cli_model_change'; model: string }
  // Client -> server: the user supplied the sudo password for a pending sudo
  // bash prompt (identified by promptId). The password is used once to feed the
  // sudo child's stdin and is never persisted or logged.
  | { type: 'bash_sudo_password'; sessionId: string; promptId: string; password: string }
  // Client -> server: the user dismissed the sudo password prompt without
  // supplying a password. The pending command is dropped, nothing runs.
  | { type: 'bash_sudo_cancel'; sessionId: string; promptId: string };

export type ServerMessage =
  | { type: 'connected'; clientId: string }
| { type: 'agent_start'; sessionId: string }
 | { type: 'thinking_update'; sessionId: string; delta: string }
 | { type: 'message_update'; sessionId: string; delta: string }
  | { type: 'message_end'; sessionId: string; content: string; role?: 'user' | 'assistant' }
  // Server -> client: the server accepted an outbound user message and handed it
  // to the agent (as a normal turn OR as a mid-stream steer queued for the next
  // step). This is the DELIVERY acknowledgement: it fires immediately, whereas
  // the message_end (role:user) echo for a steer only comes at the next model
  // call and can arrive long after the client's confirmation window. `content`
  // lets the client match the ack to its optimistic pending echo.
  | { type: 'message_ack'; sessionId: string; content: string }
  | { type: 'agent_end'; sessionId: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; args: unknown; forceCommand?: boolean }
  | { type: 'tool_update'; sessionId: string; toolName: string; delta: string }
  | { type: 'tool_end'; sessionId: string; toolName: string; isError: boolean; result?: string; images?: ToolImage[]; forceCommand?: boolean }
  | { type: 'cli_bash'; command: string; excludeFromContext?: boolean }
  // Server -> CLI bridge: run a `!sudo ...` command whose password the web user
  // just supplied. Like cli_bash but the extension must feed `password` to the
  // sudo child's stdin (sudo -S). The password is used once by the extension and
  // is never persisted or logged; only the password-free `command` is recorded.
  | { type: 'cli_bash_sudo'; command: string; password: string; excludeFromContext?: boolean }
  // Server -> client: a `!sudo ...` bash command needs a password before it can
  // run. The client should prompt (masked) and reply with bash_sudo_password or
  // bash_sudo_cancel carrying the same promptId. `command` is the sudo command
  // line WITHOUT any password, safe to display.
  | { type: 'bash_sudo_prompt'; sessionId: string; promptId: string; command: string }
  | { type: 'session_created'; sessionId: string; sessionFile: string; cwd: string; model: string; isStreaming?: boolean; readOnly?: boolean; contextUsage?: ContextUsageInfo | null; pending?: boolean; folderConflict?: boolean }
  // Sent after a `pending` session_created once the live agent has finished
  // building (createAgentSession). Until it arrives, the UI can render the
  // conversation (from message_history) but must keep the composer disabled:
  // reading is instant, sending needs the live agent. May carry a refreshed
  // model/isStreaming/contextUsage now that the real agent exists.
  | { type: 'session_ready'; sessionId: string; sessionFile: string; model?: string; isStreaming?: boolean; contextUsage?: ContextUsageInfo | null }
  | { type: 'context_usage'; sessionId: string; contextUsage: ContextUsageInfo | null }
  | { type: 'session_destroyed'; sessionId: string; reason: string }
  | { type: 'session_error'; sessionId?: string; error: string; detail?: string }
  // Server -> client: whether ANOTHER active session exists in the same folder
  // as this client's current session. Sent as a live update (on top of the
  // initial `folderConflict` flag in session_created) so the warning banner can
  // appear/disappear as other clients open or leave sessions in the folder.
  // There is no take-over/read-only protection: this is purely a heads-up that
  // two sessions in one folder are (or are no longer) live simultaneously.
  | { type: 'folder_conflict'; cwd: string; active: boolean }
  | { type: 'session_interrupted'; sessionId: string; reason: string }
  // A non-fatal, dismissible notice about the active session that the UI should
  // surface as a banner (e.g. a CLI bridge took over a mid-run session and its
  // in-flight tool call/turn was interrupted). Unlike session_interrupted, the
  // client KEEPS the session attached; this is purely informational.
  | { type: 'session_notice'; sessionId: string; level: 'info' | 'warning'; message: string }
  // Sent to the CLI bridge (only) right after it registers a session that the
  // server was actively running MID-TURN. Registering disposes that server-side
  // agent, discarding the in-flight turn without persisting it, so the CLI's own
  // dangling-tool-call heuristic cannot see the streaming-text case. This tells
  // the CLI explicitly so it can surface the takeover, symmetric with the web
  // client's session_notice. `toolCall` is true when a tool call was in flight
  // (its result is lost), false when only assistant text was streaming.
  | { type: 'cli_takeover_interrupted'; sessionId: string; toolCall: boolean }
  | { type: 'message_history'; sessionId: string; messages: HistoryMessage[]; totalCount?: number; offset?: number }
  | { type: 'message_history_prepend'; sessionId: string; messages: HistoryMessage[]; offset: number }
  | { type: 'model_changed'; sessionId: string; model: string }
  | { type: 'file_uploaded'; uploadId: string; sessionId: string; filename: string; savedPath: string }
  | { type: 'file_upload_error'; uploadId: string; sessionId: string; error: string }
  | { type: 'sessions_updated' }
  | { type: 'pong'; timestamp: number };

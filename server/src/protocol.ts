import { HistoryMessage } from './session-types.js';

export type ClientMessage =
  | { type: 'connect' }
  | { type: 'message'; message: string; sessionId: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'ping' }
  | { type: 'session_load'; sessionFile: string; cwd?: string; model?: string }
  | { type: 'session_new'; cwd: string; model?: string }
  | { type: 'session_leave'; sessionId: string }
  | { type: 'session_resolve_conflict'; action: 'take_over' | 'read_only'; sessionId: string; cwd?: string };

export type ServerMessage =
  | { type: 'connected'; clientId: string }
| { type: 'agent_start'; sessionId: string }
 | { type: 'thinking_update'; sessionId: string; delta: string }
 | { type: 'message_update'; sessionId: string; delta: string }
  | { type: 'message_end'; sessionId: string; content: string }
  | { type: 'agent_end'; sessionId: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; sessionId: string; toolName: string; isError: boolean; result?: string }
  | { type: 'session_created'; sessionId: string; sessionFile: string; cwd: string; model: string }
  | { type: 'session_destroyed'; sessionId: string; reason: string }
  | { type: 'session_error'; sessionId?: string; error: string; detail?: string }
  | { type: 'session_conflict'; sessionId: string; conflictingSession: string; conflictingCwd: string }
  | { type: 'session_interrupted'; sessionId: string; reason: string }
  | { type: 'message_history'; sessionId: string; messages: HistoryMessage[] }
  | { type: 'pong'; timestamp: number };

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
  firstMessage: string;
  isActive: boolean;
  clientCount: number;
}

export interface FolderWithSessions {
  path: string;
  name: string;
  sessions: FolderSessionInfo[];
}

export interface SessionsResponse {
  folders: FolderWithSessions[];
  activeSessions: SessionInfo[];
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ModelInfo {
  provider: string;
  modelId: string;
  label: string;
  isDefault?: boolean;
}

import { writable, get } from 'svelte/store';

export interface SessionInfo {
  path: string;
  sessionId: string;
  sessionFile: string;
  cwd: string;
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
  sessions: SessionInfo[];
}

export interface ConflictInfo {
  targetSessionId: string;
  conflictingSessionId: string;
  conflictingCwd: string;
}

export interface ModelInfo {
  provider: string;
  modelId: string;
  label: string;
  isDefault?: boolean;
}

export interface SessionStoreData {
  folders: FolderWithSessions[];
  activeSessions: string[];
  currentSession: string | null;
  loading: boolean;
}

export interface ModelsStoreData {
  models: ModelInfo[];
  loading: boolean;
}

export const sessionFolders = writable<SessionStoreData>({
  folders: [],
  activeSessions: [],
  currentSession: null,
  loading: false,
});

export const availableModels = writable<ModelsStoreData>({
  models: [],
  loading: false,
});

function getBaseUrl(): string {
  const config = localStorage.getItem('pi-remote-config');
  if (config) {
    const parsed = JSON.parse(config);
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = parsed.host.startsWith('http')
      ? parsed.host.replace(/^wss?:\/\//, '')
      : parsed.host;
    return `${protocol}//${host}:${parsed.port}`;
  }
  return `${window.location.protocol}//${window.location.host}`;
}

export async function fetchSessions(): Promise<void> {
  sessionFolders.update(s => ({ ...s, loading: true }));
  try {
    const baseUrl = getBaseUrl();
    const token = getToken();
    const url = `${baseUrl}/sessions${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    sessionFolders.set({
      folders: data.folders || [],
      activeSessions: (data.activeSessions || []).map((s: any) => s.sessionFile),
      currentSession: get(sessionFolders).currentSession,
      loading: false,
    });
  } catch (err) {
    sessionFolders.update(s => ({ ...s, loading: false }));
    console.error('Failed to fetch sessions:', err);
  }
}

export async function fetchModels(): Promise<void> {
  availableModels.update(s => ({ ...s, loading: true }));
  try {
    const baseUrl = getBaseUrl();
    const token = getToken();
    const url = `${baseUrl}/models${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    availableModels.set({
      models: data.models || [],
      loading: false,
    });
  } catch (err) {
    availableModels.update(s => ({ ...s, loading: false }));
    console.error('Failed to fetch models:', err);
  }
}

function getToken(): string {
  try {
    const config = localStorage.getItem('pi-remote-config');
    if (config) {
      const parsed = JSON.parse(config);
      return parsed.token || '';
    }
  } catch {}
  return '';
}

export function setCurrentSession(sessionId: string | null): void {
  sessionFolders.update(s => ({ ...s, currentSession: sessionId }));
}

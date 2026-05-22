import { writable, derived, get } from 'svelte/store';
import type { ConflictInfo } from './session-store';
import { setCurrentSession } from './session-store';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  sessionId?: string;
}

export interface PiRemoteState {
  connected: boolean;
  connecting: boolean;
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
}

const defaultState: PiRemoteState = {
  connected: false,
  connecting: false,
  error: null,
  session: null,
  sessionId: null,
  isStreaming: false,
  messages: [],
  clientId: null,
  conflict: null,
  isInterrupted: false,
  sessionError: null,
  readOnly: false,
  activeSessionFile: null,
  activeCwd: null,
  activeModel: null,
};

const state = writable<PiRemoteState>(defaultState);
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function getStoredConfig() {
  try {
    const stored = localStorage.getItem('pi-remote-config');
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

function saveConfig(config: { host: string; port: number; token: string }) {
  localStorage.setItem('pi-remote-config', JSON.stringify(config));
}

function getConfig() {
  return getStoredConfig() || { host: 'localhost', port: 8765, token: '' };
}

function buildUrl(config: { host: string; port: number; token: string }) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = config.host.startsWith('http')
    ? config.host.replace(/^https?:\/\//, '')
    : config.host;
  const token = config.token ? `?token=${encodeURIComponent(config.token)}` : '';
  return `${protocol}//${host}:${config.port}/ws${token}`;
}

function addMessage(msg: Omit<ChatMessage, 'id' | 'timestamp'>) {
  const message: ChatMessage = {
    ...msg,
    id: generateId(),
    timestamp: Date.now(),
  };
  state.update((s: PiRemoteState) => ({ ...s, messages: [...s.messages, message] }));
  return message.id;
}

export function connect() {
  const config = getConfig();
  const url = buildUrl(config);

  saveConfig(config);

  state.set({ ...defaultState, connecting: true });

  try {
    ws = new WebSocket(url);
  } catch (err) {
    state.set({ ...defaultState, error: `Failed to connect: ${err}` });
    return;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'connected':
          state.update((s: PiRemoteState) => ({
            ...s,
            connected: true,
            connecting: false,
            clientId: msg.clientId,
            error: null,
          }));
          break;

        case 'agent_start':
          state.update((s: PiRemoteState) => ({ ...s, isStreaming: true }));
          break;

        case 'message_update':
          state.update((s: PiRemoteState) => {
            const lastAssistant = [...s.messages].reverse().find(
              (m: ChatMessage) => m.role === 'assistant' && m.isStreaming,
            );
            if (lastAssistant) {
              return {
                ...s,
                messages: s.messages.map((m: ChatMessage) =>
                  m.id === lastAssistant.id
                    ? { ...m, content: m.content + msg.delta, isStreaming: true }
                    : m,
                ),
              };
            }
            return s;
          });
          break;

        case 'message_end':
          state.update((s: PiRemoteState) => {
            const lastAssistant = [...s.messages].reverse().find(
              (m: ChatMessage) => m.role === 'assistant' && m.isStreaming,
            );
            if (lastAssistant) {
              return {
                ...s,
                messages: s.messages.map((m: ChatMessage) =>
                  m.id === lastAssistant.id
                    ? { ...m, content: msg.content ?? m.content, isStreaming: false }
                    : m,
                ),
                isStreaming: false,
              };
            }
            return { ...s, isStreaming: false };
          });
          break;

        case 'agent_end':
          state.update((s: PiRemoteState) => ({ ...s, isStreaming: false }));
          break;

        case 'tool_start':
          addMessage({
            role: 'user',
            content: `Running: ${msg.toolName}`,
            isStreaming: false,
          });
          break;

        case 'tool_end':
          if (msg.isError) {
            addMessage({
              role: 'user',
              content: `Tool error: ${msg.toolName}`,
              isStreaming: false,
            });
          }
          break;

        case 'aborted':
          state.update((s: PiRemoteState) => ({ ...s, isStreaming: false }));
          break;

        case 'session_created':
          state.update((s: PiRemoteState) => ({
            ...s,
            session: msg.sessionFile,
            sessionId: msg.sessionId,
            activeSessionFile: msg.sessionFile,
            activeCwd: msg.cwd,
            activeModel: msg.model,
          }));
          setCurrentSession(msg.sessionFile);
          break;

        case 'session_destroyed':
          state.update((s: PiRemoteState) => {
            if (s.activeSessionFile === msg.sessionId) {
              return {
                ...s,
                messages: [],
                session: null,
                sessionId: null,
                activeSessionFile: null,
                activeCwd: null,
                activeModel: null,
              };
            }
            return s;
          });
          setCurrentSession(null);
          break;

        case 'session_error':
          state.update((s: PiRemoteState) => ({
            ...s,
            sessionError: msg.error,
          }));
          break;

        case 'session_conflict':
          state.update((s: PiRemoteState) => ({
            ...s,
            conflict: {
              targetSessionId: msg.sessionId,
              conflictingSessionId: msg.conflictingSession,
              conflictingCwd: msg.conflictingCwd,
            },
          }));
          break;

        case 'session_interrupted':
          state.update((s: PiRemoteState) => ({
            ...s,
            isInterrupted: true,
            readOnly: true,
            messages: [],
            session: null,
            sessionId: null,
            activeSessionFile: null,
            activeCwd: null,
            activeModel: null,
          }));
          setCurrentSession(null);
          setTimeout(() => {
            state.update((s: PiRemoteState) => ({ ...s, isInterrupted: false, readOnly: false }));
          }, 5000);
          break;

        case 'message_history':
          state.update((s: PiRemoteState) => ({
            ...s,
            messages: msg.messages.map((m: any) => ({
              id: generateId(),
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
              isStreaming: false,
              sessionId: msg.sessionId,
            })),
          }));
          break;

        case 'pong':
          break;
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  };

  ws.onclose = () => {
    ws = null;
    state.update((s: PiRemoteState) => ({
      ...s,
      connected: false,
      connecting: false,
    }));

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => {
        state.update((s: PiRemoteState) => ({
          ...s,
          connecting: true,
          error: 'Reconnecting...',
        }));
        connect();
      }, RECONNECT_DELAY);
    } else {
      state.set({
        ...defaultState,
        error: 'Connection lost. Check your settings and try again.',
      });
    }
  };

  ws.onerror = () => {
    state.update((s: PiRemoteState) => ({
      ...s,
      error: s.error || 'Connection error occurred',
    }));
  };
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
  if (ws) {
    ws.close();
    ws = null;
  }
  state.set(defaultState);
  setCurrentSession(null);
}

export function sendMessage(text: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const s = get(state);
  if (!s.sessionId) return;

  addMessage({ role: 'user', content: text, isStreaming: false, sessionId: s.sessionId });
  addMessage({ role: 'assistant', content: '', isStreaming: true, sessionId: s.sessionId });

  ws.send(JSON.stringify({ type: 'message', message: text, sessionId: s.sessionId }));
}

export function abort() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const s = get(state);
  if (!s.sessionId) return;
  ws.send(JSON.stringify({ type: 'abort', sessionId: s.sessionId }));
}

export function joinSession(sessionFile: string, cwd?: string, model?: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  state.update((s: PiRemoteState) => ({ ...s, conflict: null, sessionError: null }));
  ws.send(JSON.stringify({ type: 'session_load', sessionFile, cwd, model }));
}

export function createSession(cwd: string, model?: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  state.update((s: PiRemoteState) => ({ ...s, conflict: null, sessionError: null }));
  ws.send(JSON.stringify({ type: 'session_new', cwd, model }));
}

export function leaveSession() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const s = get(state);
  if (!s.sessionId) return;
  ws.send(JSON.stringify({ type: 'session_leave', sessionId: s.sessionId }));
  state.update((s: PiRemoteState) => ({
    ...s,
    messages: [],
    session: null,
    sessionId: null,
    activeSessionFile: null,
    activeCwd: null,
    activeModel: null,
    readOnly: false,
  }));
  setCurrentSession(null);
}

export function resolveConflict(action: 'take_over' | 'read_only', cwd?: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const s = get(state);
  if (!s.conflict) return;

  ws.send(JSON.stringify({
    type: 'session_resolve_conflict',
    action,
    sessionId: s.conflict.targetSessionId,
    cwd: cwd || s.conflict.conflictingCwd,
  }));

  state.update((s: PiRemoteState) => ({
    ...s,
    conflict: null,
    readOnly: action === 'read_only',
  }));
}

export function ping() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'ping' }));
}

export function clearMessages() {
  state.update((s: PiRemoteState) => ({ ...s, messages: [] }));
}

export function setConfig(config: { host: string; port: number; token: string }) {
  saveConfig(config);
}

export function dismissSessionError() {
  state.update((s: PiRemoteState) => ({ ...s, sessionError: null }));
}

export const piState = derived(state, ($s) => $s);
export const isConnected = derived(piState, ($s) => $s.connected);
export const isStreaming = derived(piState, ($s) => $s.isStreaming);
export const messages = derived(piState, ($s) => $s.messages);
export const connectionError = derived(piState, ($s) => $s.error);
export const currentSession = derived(piState, ($s) => $s.session);
export const conflict = derived(piState, ($s) => $s.conflict);
export const isInterrupted = derived(piState, ($s) => $s.isInterrupted);
export const sessionError = derived(piState, ($s) => $s.sessionError);
export const isReadOnly = derived(piState, ($s) => $s.readOnly);
export const activeSessionInfo = derived(piState, ($s) => ({
  sessionFile: $s.activeSessionFile,
  cwd: $s.activeCwd,
  model: $s.activeModel,
  sessionId: $s.sessionId,
}));

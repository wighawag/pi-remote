import { writable, derived } from 'svelte/store';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface PiRemoteState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  session: string | null;
  isStreaming: boolean;
  messages: ChatMessage[];
}

const defaultState: PiRemoteState = {
  connected: false,
  connecting: false,
  error: null,
  session: null,
  isStreaming: false,
  messages: [],
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

function updateMessage(id: string, content: string) {
  state.update((s: PiRemoteState) => ({
    ...s,
    messages: s.messages.map((m) =>
      m.id === id ? { ...m, content, isStreaming: true } : m,
    ),
  }));
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
    state.set({ ...defaultState, connected: true, connecting: false });
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
            session: msg.session || null,
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
            content: `⚙️ Running: ${msg.toolName}`,
            isStreaming: false,
          });
          break;

        case 'tool_end':
          if (msg.isError) {
            addMessage({
              role: 'user',
              content: `⚠️ Tool error: ${msg.toolName}`,
              isStreaming: false,
            });
          }
          break;

        case 'aborted':
          state.update((s: PiRemoteState) => ({ ...s, isStreaming: false }));
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
      session: null,
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
}

export function sendMessage(text: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  addMessage({ role: 'user', content: text, isStreaming: false });
  addMessage({ role: 'assistant', content: '', isStreaming: true });

  ws.send(JSON.stringify({ type: 'message', message: text }));
}

export function abort() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'abort' }));
}

export function newSession() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'message', message: '/new' }));
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

export const piState = derived(state, ($s) => $s);

export const isConnected = derived(piState, ($s) => $s.connected);
export const isStreaming = derived(piState, ($s) => $s.isStreaming);
export const messages = derived(piState, ($s) => $s.messages);
export const connectionError = derived(piState, ($s) => $s.error);
export const currentSession = derived(piState, ($s) => $s.session);

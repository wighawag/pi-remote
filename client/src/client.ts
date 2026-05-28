import { writable, get, type Writable } from "sveltore";
import { type ChatMessage, type WhereverState } from "./types.js";

export interface WhereverClientConfig {
  host: string;
  port: number | string;
  token?: string;
  secure?: boolean;
  WebSocketCtor?: any;
  hideThinking?: boolean;
  hideTools?: boolean;
}

const defaultState: WhereverState = {
	connected: false,
	connecting: false,
	creatingSession: false,
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
	hideThinking: false,
	hideTools: false,
};

export class WhereverClient {
  private ws: any = null;
  private config: WhereverClientConfig;
  public stateStore: Writable<WhereverState>;
  private reconnectTimer: any = null;
  private agentEndTimeout: any = null;
  private reconnectAttempts = 0;
  private reconnectDelay = 2000;
  private maxReconnectDelay = 15000;
  private isInitialConnect = true;
  private listeners = new Set<(msg: any) => void>();
  private pendingUploads = new Map<string, {resolve: (val: any) => void, reject: (err: any) => void}>();

  constructor(config: WhereverClientConfig) {
    this.config = {
      secure: true,
      ...config
    };
    this.stateStore = writable<WhereverState>({
      ...defaultState,
      hideThinking: !!this.config.hideThinking,
      hideTools: !!this.config.hideTools,
    });
  }

  public connect(newConfig?: Partial<WhereverClientConfig>) {
    if (newConfig) {
      this.config = {
        ...this.config,
        ...newConfig
      };
    }

    this.disconnect(false);

    this.stateStore.update(s => ({
      ...defaultState,
      connecting: true,
      hideThinking: !!this.config.hideThinking,
      hideTools: !!this.config.hideTools,
    }));

    const protocol = this.config.secure ? "wss" : "ws";
    const host = this.config.host.startsWith('http')
      ? this.config.host.replace(/^https?:\/\//, '')
      : this.config.host;
    const tokenQuery = this.config.token ? `?token=${encodeURIComponent(this.config.token)}` : "";
    const wsUrl = `${protocol}://${host}:${this.config.port}/ws${tokenQuery}`;

    const WebSocketImpl = this.config.WebSocketCtor || (typeof globalThis !== 'undefined' ? (globalThis as any).WebSocket : null);
    
    if (!WebSocketImpl) {
      this.stateStore.update(s => ({
        ...s,
        connecting: false,
        error: "No WebSocket implementation found. Please pass custom WebSocketCtor."
      }));
      return;
    }

    try {
      const wsOptions = this.config.secure && this.config.WebSocketCtor ? { rejectUnauthorized: false } : undefined;
      this.ws = wsOptions ? new WebSocketImpl(wsUrl, wsOptions) : new WebSocketImpl(wsUrl);
    } catch (err) {
      this.stateStore.update(s => ({
        ...s,
        connecting: false,
        error: `Failed to connect: ${err}`
      }));
      this.scheduleReconnect();
      return;
    }

    const currentWs = this.ws;

    const onOpen = () => {
      if (this.ws !== currentWs) return;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 2000;
      this.isInitialConnect = false;
      this.stateStore.update(s => ({
        ...s,
        connected: true,
        connecting: false,
        error: null
      }));
    };

    const onMessage = (event: any) => {
      if (this.ws !== currentWs) return;
      try {
        const rawData = typeof event.data === 'string' ? event.data : event.data.toString();
        const msg = JSON.parse(rawData);
        this.handleMessage(msg);
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    const onClose = () => {
      if (this.ws !== currentWs) return;
      this.ws = null;
      this.stateStore.update(s => ({
        ...s,
        connected: false,
        connecting: false,
      }));
      this.scheduleReconnect();
    };

    const onError = (err: any) => {
      if (this.ws !== currentWs) return;
      this.stateStore.update(s => ({
        ...s,
        error: s.error || 'Connection error occurred'
      }));
    };

    if (typeof currentWs.addEventListener === 'function') {
      currentWs.addEventListener('open', onOpen);
      currentWs.addEventListener('message', onMessage);
      currentWs.addEventListener('close', onClose);
      currentWs.addEventListener('error', onError);
    } else if (typeof currentWs.on === 'function') {
      currentWs.on('open', onOpen);
      currentWs.on('message', (data: any) => onMessage({ data }));
      currentWs.on('close', onClose);
      currentWs.on('error', onError);
    }
  }

  public disconnect(resetState = true) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      try {
        if (typeof this.ws.removeAllListeners === 'function') {
          this.ws.removeAllListeners();
        }
        this.ws.close();
      } catch (err) {}
      this.ws = null;
    }

    if (resetState) {
      this.stateStore.set({
        ...defaultState,
        hideThinking: !!this.config.hideThinking,
        hideTools: !!this.config.hideTools,
      });
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      
      this.stateStore.update(s => ({
        ...s,
        connecting: true,
        error: 'Reconnecting...',
      }));
      
      this.connect();
    }, this.reconnectDelay);
  }

  private handleMessage(msg: any) {
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch (err) {
        console.error("Error in message listener:", err);
      }
    }

    switch (msg.type) {
      case 'connected':
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          connected: true,
          connecting: false,
          clientId: msg.clientId,
          error: null,
        }));
        break;

      case 'file_uploaded': {
        const pending = this.pendingUploads.get(msg.uploadId);
        if (pending) {
          pending.resolve({savedPath: msg.savedPath, filename: msg.filename});
          this.pendingUploads.delete(msg.uploadId);
        }
        break;
      }

      case 'file_upload_error': {
        const pending = this.pendingUploads.get(msg.uploadId);
        if (pending) {
          pending.reject(new Error(msg.error));
          this.pendingUploads.delete(msg.uploadId);
        }
        break;
      }

      case 'agent_start':
        if (this.agentEndTimeout) {
          clearTimeout(this.agentEndTimeout);
          this.agentEndTimeout = null;
        }
        this.stateStore.update((s: WhereverState) => ({...s, isStreaming: true}));
        break;

      case 'thinking_update':
        this.stateStore.update((s: WhereverState) => {
          let lastThinking = [...s.messages]
            .reverse()
            .find((m: ChatMessage) => m.role === 'thinking' && m.isStreaming);
          if (!lastThinking) {
            const newMsg: ChatMessage = {
              id: this.generateId(),
              role: 'thinking',
              content: msg.delta,
              timestamp: Date.now(),
              isStreaming: true,
            };
            return {...s, messages: [...s.messages, newMsg]};
          }
          return {
            ...s,
            messages: s.messages.map((m: ChatMessage) =>
              m.id === lastThinking.id
                ? {...m, content: m.content + msg.delta, isStreaming: true}
                : m,
            ),
          };
        });
        break;

      case 'message_update':
        this.stateStore.update((s: WhereverState) => {
          let lastAssistant = [...s.messages]
            .reverse()
            .find(
              (m: ChatMessage) => m.role === 'assistant' && m.isStreaming,
            );
          if (!lastAssistant) {
            const newMsg: ChatMessage = {
              id: this.generateId(),
              role: 'assistant',
              content: msg.delta,
              timestamp: Date.now(),
              isStreaming: true,
            };
            return {...s, messages: [...s.messages, newMsg]};
          }
          return {
            ...s,
            messages: s.messages.map((m: ChatMessage) =>
              m.id === lastAssistant.id
                ? {...m, content: m.content + msg.delta, isStreaming: true}
                : m,
            ),
          };
        });
        break;

      case 'message_end':
        this.stateStore.update((s: WhereverState) => {
          let newMessages = s.messages;

          const lastThinking = [...newMessages]
            .reverse()
            .find((m: ChatMessage) => m.role === 'thinking' && m.isStreaming);
          if (lastThinking) {
            newMessages = newMessages.map((m: ChatMessage) =>
              m.id === lastThinking.id ? {...m, isStreaming: false} : m,
            );
          }

          const lastAssistant = [...newMessages]
            .reverse()
            .find(
              (m: ChatMessage) => m.role === 'assistant' && m.isStreaming,
            );
          if (lastAssistant) {
            newMessages = newMessages.map((m: ChatMessage) =>
              m.id === lastAssistant.id
                ? {
                    ...m,
                    content: msg.content || m.content,
                    isStreaming: false,
                  }
                : m,
            );
          } else if (msg.content) {
            const lastUserMessage = [...newMessages]
              .reverse()
              .find((m) => m.role === 'user');
            const isDuplicateUserMsg =
              msg.role === 'user' &&
              lastUserMessage &&
              lastUserMessage.content === msg.content;

            if (!isDuplicateUserMsg) {
              newMessages = [
                ...newMessages,
                {
                  id: this.generateId(),
                  role: msg.role || 'assistant',
                  content: msg.content,
                  timestamp: Date.now(),
                  isStreaming: false,
                },
              ];
            }
          }

          return {...s, messages: newMessages};
        });
        break;

      case 'agent_end':
        if (this.agentEndTimeout) {
          clearTimeout(this.agentEndTimeout);
          this.agentEndTimeout = null;
        }
        this.agentEndTimeout = setTimeout(() => {
          this.stateStore.update((s: WhereverState) => ({
            ...s,
            isStreaming: false,
            messages: s.messages.map((m: ChatMessage) =>
              m.isStreaming ? {...m, isStreaming: false} : m,
            ),
          }));
          this.agentEndTimeout = null;
        }, 300);
        break;

      case 'tool_start':
        if (this.agentEndTimeout) {
          clearTimeout(this.agentEndTimeout);
          this.agentEndTimeout = null;
        }
        const toolArgs = msg.args
          ? Object.entries(msg.args)
              .filter(([k, v]) => v !== undefined && v !== '')
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(' ')
          : '';
        this.stateStore.update((s: WhereverState) => {
          const finalizedMessages = s.messages.map((m: ChatMessage) =>
            m.isStreaming && (m.role === 'assistant' || m.role === 'thinking')
              ? {...m, isStreaming: false}
              : m,
          );
          const newMsg: ChatMessage = {
            id: this.generateId(),
            role: 'tool',
            content: toolArgs
              ? `$ ${msg.toolName} ${toolArgs}`
              : `$ ${msg.toolName}`,
            timestamp: Date.now(),
            isStreaming: true,
            toolName: msg.toolName,
            toolArgs: toolArgs,
            toolOutput: '',
          };
          return {
            ...s,
            messages: [...finalizedMessages, newMsg],
          };
        });
        break;

      case 'tool_update': {
        this.stateStore.update((s: WhereverState) => {
          const toolMsg = [...s.messages]
            .reverse()
            .find(
              (m: ChatMessage) =>
                m.role === 'tool' &&
                m.toolName === msg.toolName &&
                m.isStreaming,
            );
          if (toolMsg) {
            return {
              ...s,
              messages: s.messages.map((m: ChatMessage) =>
                m.id === toolMsg.id
                  ? {
                      ...m,
                      content: m.content.includes('\n')
                        ? m.content + msg.delta
                        : `${m.content}\n${msg.delta}`,
                      toolOutput: `${m.toolOutput}${msg.delta}`,
                    }
                  : m,
              ),
            };
          }
          return s;
        });
        break;
      }

      case 'tool_end': {
        const result = msg.result ? `${msg.result}` : '';
        this.stateStore.update((s: WhereverState) => {
          const toolMsg = [...s.messages]
            .reverse()
            .find(
              (m: ChatMessage) =>
                m.role === 'tool' &&
                m.toolName === msg.toolName &&
                !m.content.startsWith('Tool error:'),
            );
          if (toolMsg) {
            const errorPrefix = msg.isError ? 'Error: ' : '';
            return {
              ...s,
              messages: s.messages.map((m: ChatMessage) =>
                m.id === toolMsg.id
                  ? {
                      ...m,
                      content: `${errorPrefix}${m.content}\n${result}`,
                      isStreaming: false,
                      isError: msg.isError,
                      toolOutput: result,
                    }
                  : m,
              ),
            };
          } else {
            const content = msg.isError
              ? `Tool error: ${msg.toolName}\n${result}`
              : `${msg.toolName}\n${result}`;
            const message: ChatMessage = {
              id: this.generateId(),
              role: 'tool',
              content,
              timestamp: Date.now(),
              isStreaming: false,
              toolName: msg.toolName,
              toolArgs: '',
              toolOutput: result,
              isError: msg.isError,
            };
            return {
              ...s,
              messages: [...s.messages, message],
            };
          }
        });
        break;
      }

      case 'aborted':
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          isStreaming: false,
          messages: s.messages.map((m: ChatMessage) =>
            m.isStreaming ? {...m, isStreaming: false} : m,
          ),
        }));
        break;

      case 'session_created':
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          session: msg.sessionFile,
          sessionId: msg.sessionId,
          activeSessionFile: msg.sessionFile,
          activeCwd: msg.cwd,
          activeModel: msg.model,
          isStreaming: msg.isStreaming ?? false,
          creatingSession: false,
        }));
        break;

      case 'session_destroyed':
        this.stateStore.update((s: WhereverState) => {
          if (s.sessionId === msg.sessionId) {
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
        break;

      case 'session_error':
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          sessionError: msg.error,
          isStreaming: false,
          creatingSession: false,
        }));
        break;

      case 'session_conflict':
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          conflict: {
            targetSessionId: msg.sessionId,
            conflictingSessionId: msg.conflictingSession,
            conflictingCwd: msg.conflictingCwd,
          },
          creatingSession: false,
        }));
        break;

      case 'session_interrupted':
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          isInterrupted: true,
          readOnly: true,
          messages: [],
          session: null,
          sessionId: null,
          activeSessionFile: null,
          activeCwd: null,
          activeModel: null,
          creatingSession: false,
        }));
        break;

      case 'message_history':
        this.stateStore.update((s: WhereverState) => {
          const mapped: ChatMessage[] = [];
          const pendingCalls: Record<string, string[]> = {};

          for (const m of msg.messages) {
            if (m.role === 'tool_call') {
              const tName = m.toolName || 'unknown';
              if (!pendingCalls[tName]) {
                pendingCalls[tName] = [];
              }
              pendingCalls[tName].push(m.content || '');
            } else if (m.role === 'tool_result') {
              const tName = m.toolName || 'unknown';
              const tArgs =
                pendingCalls[tName] && pendingCalls[tName].length > 0
                  ? pendingCalls[tName].shift()!
                  : '';
              mapped.push({
                id: this.generateId(),
                role: 'tool',
                content: tArgs
                  ? `$ ${tName} ${tArgs}\n${m.content}`
                  : `$ ${tName}\n${m.content}`,
                timestamp: m.timestamp,
                isStreaming: false,
                toolName: tName,
                toolArgs: tArgs,
                toolOutput: m.content,
                isError: m.isError,
                sessionId: msg.sessionId,
              });
            } else {
              mapped.push({
                id: this.generateId(),
                role: m.role,
                content: m.content,
                timestamp: m.timestamp,
                isStreaming: false,
                toolName: m.toolName,
                sessionId: msg.sessionId,
              });
            }
          }

          for (const [tName, argsList] of Object.entries(pendingCalls)) {
            for (const args of argsList) {
              mapped.push({
                id: this.generateId(),
                role: 'tool',
                content: args ? `$ ${tName} ${args}` : `$ ${tName}`,
                timestamp:
                  mapped.length > 0
                    ? mapped[mapped.length - 1].timestamp + 1
                    : Date.now(),
                isStreaming: s.isStreaming,
                toolName: tName,
                toolArgs: args,
                toolOutput: '',
                sessionId: msg.sessionId,
              });
            }
          }

          if (s.isStreaming && mapped.length > 0) {
            const lastIndex = mapped.length - 1;
            const lastMsg = mapped[lastIndex];
            if (lastMsg.role === 'assistant' || lastMsg.role === 'thinking') {
              mapped[lastIndex] = {
                ...lastMsg,
                isStreaming: true,
              };
            }
          }

          return {...s, messages: mapped};
        });
        break;

      case 'model_changed':
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          activeModel: msg.model,
        }));
        break;
    }
  }

  public send(msg: any) {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public sendMessage(text: string) {
    const s = get(this.stateStore);
    if (!s.sessionId) return;

    this.stateStore.update((s: WhereverState) => ({...s, sessionError: null}));
    
    const message: ChatMessage = {
      id: this.generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      isStreaming: false,
      sessionId: s.sessionId,
    };
    this.stateStore.update((s: WhereverState) => ({
      ...s,
      messages: [...s.messages, message],
    }));

    this.send({type: 'message', message: text, sessionId: s.sessionId});
  }

  public abort() {
    const s = get(this.stateStore);
    if (!s.sessionId) return;
    this.send({type: 'abort', sessionId: s.sessionId});
  }

  public joinSession(sessionFile: string, cwd?: string, model?: string) {
    this.stateStore.update((s: WhereverState) => ({
      ...s,
      conflict: null,
      sessionError: null,
    }));
    this.send({type: 'session_load', sessionFile, cwd, model});
  }

  public createSession(
    cwd: string,
    model?: string,
    gitInit?: boolean,
    createRemote?: boolean,
    repoVisibility?: 'private' | 'public',
  ) {
    this.stateStore.update((s: WhereverState) => ({
      ...s,
      conflict: null,
      sessionError: null,
      creatingSession: true,
    }));
    this.send({
      type: 'session_new',
      cwd,
      model,
      gitInit,
      createRemote,
      repoVisibility,
    });
  }

  public leaveSession() {
    const s = get(this.stateStore);
    if (!s.sessionId) return;
    this.send({type: 'session_leave', sessionId: s.sessionId});
    this.stateStore.update((s: WhereverState) => ({
      ...s,
      messages: [],
      session: null,
      sessionId: null,
      activeSessionFile: null,
      activeCwd: null,
      activeModel: null,
      readOnly: false,
      creatingSession: false,
    }));
  }

  public resolveConflict(action: 'take_over' | 'read_only', cwd?: string) {
    const s = get(this.stateStore);
    if (!s.conflict) return;

    this.send({
      type: 'session_resolve_conflict',
      action,
      sessionId: s.conflict.targetSessionId,
      cwd: cwd || s.conflict.conflictingCwd,
    });

    this.stateStore.update((s: WhereverState) => ({
      ...s,
      conflict: null,
      readOnly: action === 'read_only',
    }));
  }

  public ping() {
    this.send({type: 'ping'});
  }

  public clearMessages() {
    this.stateStore.update((s: WhereverState) => ({...s, messages: []}));
  }

  public dismissSessionError() {
    this.stateStore.update((s: WhereverState) => ({...s, sessionError: null}));
  }

  public changeModel(model: string) {
    this.send({type: 'model_change', model});
  }

  public setConfig(updates: Partial<WhereverClientConfig>) {
    this.config = {
      ...this.config,
      ...updates,
    };
    this.stateStore.update((s: WhereverState) => {
      const next = {...s};
      if (updates.hideThinking !== undefined)
        next.hideThinking = !!updates.hideThinking;
      if (updates.hideTools !== undefined)
        next.hideTools = !!updates.hideTools;
      return next;
    });
  }

  public onMessage(cb: (msg: any) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  public uploadFileViaWebSocket(sessionId: string, filename: string, base64Data: string): Promise<{savedPath: string; filename: string}> {
    return new Promise((resolve, reject) => {
      const uploadId = this.generateId();
      this.pendingUploads.set(uploadId, {resolve, reject});
      this.send({
        type: 'file_upload',
        uploadId,
        sessionId,
        filename,
        data: base64Data
      });
    });
  }

  private generateId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  public getIsConnected() {
    return this.ws && this.ws.readyState === 1;
  }
}

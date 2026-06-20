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
	loadingSession: false,
	resyncing: false,
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
	historyTotalCount: 0,
	historyOffset: 0,
	loadingMoreHistory: false,
	contextUsage: null,
};

export class WhereverClient {
  private ws: any = null;
  private config: WhereverClientConfig;
  public stateStore: Writable<WhereverState>;
  private reconnectTimer: any = null;
  private agentEndTimeout: any = null;
  // Watchdog for an in-flight session_load. We set loadingSession/resyncing the
  // moment a load is requested and clear them when message_history (or an
  // error/conflict/disconnect) arrives. If none of those ever comes back (a lost
  // reply, a server that answered for a different session, or any unforeseen
  // edge), the "Loading session..." / "Reconnecting..." affordance would hang
  // forever. This timer guarantees the load state always resolves: on expiry we
  // clear the flags and surface a recoverable error instead of an endless spin.
  private loadWatchdog: any = null;
  private static readonly LOAD_WATCHDOG_MS = 12_000;
  private reconnectAttempts = 0;
  private reconnectDelay = 2000;
  private maxReconnectDelay = 15000;
  // Liveness watchdog: a half-open TCP socket fires neither 'close' nor 'error',
  // so the existing reconnect machinery never triggers and the agent hangs
  // forever (see work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md).
  // We record the time of the last inbound frame and, if the socket goes silent
  // for longer than STALE_SOCKET_MS, proactively tear it down and reconnect.
  // A periodic app-level {type:'ping'} keeps a healthy connection refreshed even
  // during long, token-less model turns.
  private livenessTimer: any = null;
  private heartbeatTimer: any = null;
  private lastInboundAt = 0;
  // > the server heartbeat (when present) and any normal token-less gap, so a
  // healthy connection is never falsely reaped; short enough to self-heal fast.
  private static readonly STALE_SOCKET_MS = 60_000;
  // While a turn is streaming, the keepalive pong should keep traffic flowing, so
  // a shorter deadline surfaces a stalled transport (vs a merely slow model)
  // faster. Still > one HEARTBEAT_MS so a single healthy pong keeps it fresh.
  private static readonly TURN_STALL_MS = 45_000;
  // Send a keepalive well under STALE_SOCKET_MS so the pong refreshes liveness.
  private static readonly HEARTBEAT_MS = 25_000;
  private isInitialConnect = true;
  // When set, the next successful (re)connection should rejoin the previously
  // active session instead of starting blank. Used by resume() so a backgrounded
  // tab returns to its cached conversation and resyncs history in place.
  private resumeSessionFile: string | null = null;
  private resumeCwd?: string;
  private resumeModel?: string;
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

  public connect(newConfig?: Partial<WhereverClientConfig>, preserveState = false) {
    if (newConfig) {
      this.config = {
        ...this.config,
        ...newConfig
      };
    }

    this.disconnect(false);

    // preserveState keeps the cached session/messages in the store across a
    // reconnect (resume path), so the previous conversation stays visible while
    // we reconnect and resync. The default (fresh connect) clears to a blank
    // store as before.
    this.stateStore.update(s => preserveState
      ? {...s, connecting: true, error: null}
      : {
          ...defaultState,
          connecting: true,
          hideThinking: !!this.config.hideThinking,
          hideTools: !!this.config.hideTools,
        });

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
      if (!this.isInitialConnect) {
        console.info('[wherever] reconnected to relay');
      }
      this.reconnectAttempts = 0;
      this.reconnectDelay = 2000;
      this.isInitialConnect = false;
      this.startLivenessWatchdog();
      this.stateStore.update(s => ({
        ...s,
        connected: true,
        connecting: false,
        error: null
      }));
      // Resume path: rejoin the previously-active session so its history is
      // resynced in place. resyncing stays true until message_history (or an
      // error/conflict) arrives, keeping the "reconnecting" affordance up and
      // input blocked without dropping the cached messages.
      if (this.resumeSessionFile) {
        const file = this.resumeSessionFile;
        const cwd = this.resumeCwd;
        const model = this.resumeModel;
        this.resumeSessionFile = null;
        this.resumeCwd = undefined;
        this.resumeModel = undefined;
        this.send({type: 'session_load', sessionFile: file, cwd, model});
        this.armLoadWatchdog();
      } else {
        this.stateStore.update(s => (s.resyncing ? {...s, resyncing: false} : s));
      }
    };

    const onMessage = (event: any) => {
      if (this.ws !== currentWs) return;
      // Any inbound frame (including the pong reply to our keepalive) proves the
      // socket is alive and resets the stale-socket watchdog.
      this.lastInboundAt = Date.now();
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
      this.stopLivenessWatchdog();
      this.clearLoadWatchdog();
      this.ws = null;
      this.stateStore.update(s => ({
        ...s,
        connected: false,
        connecting: false,
        // Never leave a session-load spinner stuck if the socket drops mid-load.
        loadingSession: false,
        creatingSession: false,
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
    this.stopLivenessWatchdog();

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

  // Suspend the connection without tearing down the cached session state. Used
  // when the tab is backgrounded: closing the WebSocket improves bfcache
  // eligibility, but we keep messages/sessionId so returning is a cheap resync
  // rather than a full reload. Records the active session so resume() can rejoin
  // it. Does NOT schedule a reconnect (disconnect(false) clears that timer).
  public suspend() {
    const s = get(this.stateStore);
    if (s.activeSessionFile) {
      this.resumeSessionFile = s.activeSessionFile;
      this.resumeCwd = s.activeCwd ?? undefined;
      this.resumeModel = s.activeModel ?? undefined;
    }
    this.disconnect(false);
  }

  // Resume after suspend(): reconnect while preserving the cached store, mark
  // the session as resyncing, and let onOpen rejoin the recorded session. If
  // there is no active session to rejoin, this is just a state-preserving
  // reconnect.
  public resume() {
    const s = get(this.stateStore);
    if (s.connected || s.connecting) return;
    if (this.resumeSessionFile) {
      this.stateStore.update(st => ({...st, resyncing: true}));
      // Arm here too: if the socket never opens, onOpen never runs and the
      // resync affordance would otherwise hang. onClose also clears it, but the
      // watchdog covers the half-open / never-opens case.
      this.armLoadWatchdog();
    }
    this.connect(undefined, true);
  }

  // True when suspend() recorded an active session to rejoin on the next resume.
  // Callers use this to take the resume (preserve-cache, rejoin-in-place) path
  // only when there is actually a suspended session; otherwise a plain connect()
  // is correct and avoids racing/latching the hash auto-join on a fresh load.
  public hasSuspendedSession(): boolean {
    return this.resumeSessionFile !== null;
  }

  // Start (or restart) the stale-socket watchdog + keepalive for the current
  // socket. A half-open connection emits no 'close'/'error', so without this the
  // existing reconnect logic would never fire and the agent would hang forever.
  private startLivenessWatchdog() {
    this.stopLivenessWatchdog();
    this.lastInboundAt = Date.now();

    const sendBeat = () => {
      // Keep a healthy connection warm so the pong refreshes lastInboundAt even
      // during long, token-less model turns.
      try {
        this.ping();
      } catch {}
    };
    if (typeof setInterval === 'function') {
      this.heartbeatTimer = setInterval(sendBeat, WhereverClient.HEARTBEAT_MS);
      if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === 'function') {
        this.heartbeatTimer.unref();
      }
    }

    const checkLiveness = () => {
      if (!this.ws) return;
      const silentFor = Date.now() - this.lastInboundAt;
      const streaming = get(this.stateStore).isStreaming;
      // Per-turn stall timeout: while a turn is in flight the heartbeat pong (and,
      // normally, tokens) should keep traffic flowing, so a shorter deadline
      // distinguishes "model is slow" (heartbeat still arriving -> not stale) from
      // "transport is dead" (heartbeat stopped). When idle, fall back to the
      // generic stale-socket threshold.
      const threshold = streaming
        ? WhereverClient.TURN_STALL_MS
        : WhereverClient.STALE_SOCKET_MS;
      if (silentFor < threshold) return;
      // The socket has been silent past the threshold: treat it as dead. Tearing
      // it down forcibly is what makes a half-open connection recover, since the
      // OS never produced a FIN/RST to trigger the normal close path.
      console.warn(
        `[wherever] relay connection stale: no inbound frame for ${silentFor}ms ` +
        `(threshold ${threshold}ms, ${streaming ? 'mid-turn' : 'idle'}); ` +
        `tearing down dead socket and reconnecting`,
      );
      this.stopLivenessWatchdog();
      const deadWs = this.ws;
      this.ws = null;
      try {
        if (typeof deadWs.terminate === 'function') {
          deadWs.terminate();
        } else if (typeof deadWs.close === 'function') {
          deadWs.close();
        }
      } catch {}
      this.stateStore.update(s => ({
        ...s,
        connected: false,
        connecting: false,
        loadingSession: false,
        creatingSession: false,
        // If a turn was in flight, surface it as a recoverable error so the UI
        // shows "the transport stalled" rather than silently parking mid-stream.
        sessionError: streaming
          ? 'Connection to relay stalled mid-turn; reconnecting...'
          : s.sessionError,
        isStreaming: false,
      }));
      this.scheduleReconnect();
    };
    if (typeof setInterval === 'function') {
      this.livenessTimer = setInterval(checkLiveness, WhereverClient.HEARTBEAT_MS);
      if (this.livenessTimer && typeof this.livenessTimer.unref === 'function') {
        this.livenessTimer.unref();
      }
    }
  }

  private stopLivenessWatchdog() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  // Arm (or re-arm) the load watchdog. Called whenever a session_load is issued
  // so an unresolved load can never strand the loading UI. Idempotent: a fresh
  // load resets the deadline.
  private armLoadWatchdog() {
    this.clearLoadWatchdog();
    this.loadWatchdog = setTimeout(() => {
      this.loadWatchdog = null;
      const s = get(this.stateStore);
      if (!s.loadingSession && !s.resyncing) return;
      console.warn('[wherever] session load timed out; clearing loading state');
      this.stateStore.update(st => ({
        ...st,
        loadingSession: false,
        resyncing: false,
        sessionError:
          st.sessionError ||
          'Loading the session timed out. Please retry from the sidebar or reload.',
      }));
    }, WhereverClient.LOAD_WATCHDOG_MS);
  }

  // Clear the load watchdog. Called at every point the load resolves
  // (message_history, session_error, session_conflict, disconnect, leave).
  private clearLoadWatchdog() {
    if (this.loadWatchdog) {
      clearTimeout(this.loadWatchdog);
      this.loadWatchdog = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      console.info(`[wherever] reconnecting to relay (attempt ${++this.reconnectAttempts})`);
      
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

    // Any message that resolves an in-flight session_load disarms the watchdog.
    // session_created arrives just before message_history; message_history is the
    // real completion, but an error/conflict/destroy/interrupt also resolves it.
    switch (msg.type) {
      case 'message_history':
      case 'session_error':
      case 'session_conflict':
      case 'session_destroyed':
      case 'session_interrupted':
        this.clearLoadWatchdog();
        break;
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
          // The server forces read-only for sessions in a configured
          // sessions.readOnly folder (observe-only fleet view).
          readOnly: msg.readOnly ?? false,
          // Initial context-usage snapshot for the new session (null if unknown;
          // live updates arrive via 'context_usage').
          contextUsage: msg.contextUsage ?? null,
        }));
        break;

      case 'context_usage':
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          contextUsage: msg.contextUsage ?? null,
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
              loadingSession: false,
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
          loadingSession: false,
          resyncing: false,
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
          loadingSession: false,
          resyncing: false,
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
          loadingSession: false,
        }));
        break;

      case 'message_history':
        this.stateStore.update((s: WhereverState) => {
          const mapped = this.mapHistory(msg.messages, msg.sessionId, s.isStreaming);
          const totalCount =
            typeof msg.totalCount === 'number' ? msg.totalCount : mapped.length;
          const offset = typeof msg.offset === 'number' ? msg.offset : 0;
          return {
            ...s,
            messages: mapped,
            historyTotalCount: totalCount,
            historyOffset: offset,
            loadingMoreHistory: false,
            loadingSession: false,
            resyncing: false,
          };
        });
        break;

      case 'message_history_prepend':
        this.stateStore.update((s: WhereverState) => {
          // Older window prepended ahead of currently-loaded messages. No
          // streaming-tail handling here (those messages are historical).
          const older = this.mapHistory(msg.messages, msg.sessionId, false);
          const offset = typeof msg.offset === 'number' ? msg.offset : 0;
          if (older.length === 0) {
            return {...s, loadingMoreHistory: false, historyOffset: offset};
          }
          return {
            ...s,
            messages: [...older, ...s.messages],
            historyOffset: offset,
            loadingMoreHistory: false,
          };
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

  /**
   * Map a server `HistoryMessage[]` window into UI `ChatMessage[]`. When
   * `applyStreamingTail` is true, the last assistant/thinking message and any
   * unmatched tool-call placeholders are marked streaming (used only for the
   * live tail window, not for prepended older history).
   */
  private mapHistory(
    rawMessages: any[],
    sessionId: string,
    applyStreamingTail: boolean,
  ): ChatMessage[] {
    const mapped: ChatMessage[] = [];
    const pendingCalls: Record<string, string[]> = {};

    for (const m of rawMessages) {
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
          sessionId,
        });
      } else {
        mapped.push({
          id: this.generateId(),
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          isStreaming: false,
          toolName: m.toolName,
          sessionId,
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
          isStreaming: applyStreamingTail,
          toolName: tName,
          toolArgs: args,
          toolOutput: '',
          sessionId,
        });
      }
    }

    if (applyStreamingTail && mapped.length > 0) {
      const lastIndex = mapped.length - 1;
      const lastMsg = mapped[lastIndex];
      if (lastMsg.role === 'assistant' || lastMsg.role === 'thinking') {
        mapped[lastIndex] = {
          ...lastMsg,
          isStreaming: true,
        };
      }
    }

    return mapped;
  }

  /**
   * Request the previous window of older history for the active session.
   * No-op when there is nothing older to load or a request is already in
   * flight.
   */
  public loadMoreHistory() {
    const s = get(this.stateStore);
    if (!s.sessionId) return;
    if (s.loadingMoreHistory) return;
    if (s.historyOffset <= 0) return;
    this.stateStore.update((st: WhereverState) => ({
      ...st,
      loadingMoreHistory: true,
    }));
    this.send({
      type: 'history_load_more',
      sessionId: s.sessionId,
      beforeOffset: s.historyOffset,
    });
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
      loadingSession: true,
    }));
    this.send({type: 'session_load', sessionFile, cwd, model});
    this.armLoadWatchdog();
  }

  // Switch from the currently-active session (if any) straight to another one in
  // a single, atomic step. Leaving + loading used to be done by the UI as two
  // calls separated by a 100ms setTimeout; that gap could strand the loading
  // state (a tap landing mid-switch, a leave whose load never fired) and leave
  // the "Loading session..." spinner hanging with an open sidebar. Doing both
  // here, synchronously, means there is never an in-between state and the
  // watchdog is always (re)armed for the new load, so a superseded or lost load
  // can never strand the UI: the latest tap always wins.
  public switchSession(sessionFile: string, cwd?: string, model?: string) {
    const s = get(this.stateStore);
    // Tapping the already-active session is a no-op (don't tear it down just to
    // reload the same history).
    if (s.activeSessionFile === sessionFile && !s.loadingSession && !s.resyncing) {
      return;
    }
    if (s.sessionId) {
      this.send({type: 'session_leave', sessionId: s.sessionId});
    }
    // Reset to a clean loading state for the target session in one update so the
    // old conversation clears immediately and the spinner reflects the new load.
    this.stateStore.update((st: WhereverState) => ({
      ...st,
      messages: [],
      session: null,
      sessionId: null,
      activeSessionFile: null,
      activeCwd: null,
      activeModel: null,
      readOnly: false,
      conflict: null,
      sessionError: null,
      creatingSession: false,
      resyncing: false,
      contextUsage: null,
      loadingSession: true,
    }));
    this.resumeSessionFile = null;
    this.resumeCwd = undefined;
    this.resumeModel = undefined;
    this.send({type: 'session_load', sessionFile, cwd, model});
    this.armLoadWatchdog();
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
      loadingSession: false,
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
      loadingSession: false,
      resyncing: false,
      contextUsage: null,
    }));
    this.clearLoadWatchdog();
    this.resumeSessionFile = null;
    this.resumeCwd = undefined;
    this.resumeModel = undefined;
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

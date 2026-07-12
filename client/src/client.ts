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
	agentPending: false,
	error: null,
	session: null,
	sessionId: null,
	isStreaming: false,
	messages: [],
	clientId: null,
	conflict: null,
	isInterrupted: false,
	notice: null,
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
  // Watchdog for an in-flight session_new. Symmetrical to loadWatchdog: creating
  // a session sets creatingSession=true and shows a BLOCKING full-screen overlay,
  // and the only things that clear it are session_created/session_error/
  // session_conflict/session_interrupted (or a socket close). If none of those
  // ever arrives (a slow git init / remote-repo creation, an error thrown before
  // the reply is sent, or a half-open socket the liveness watchdog has not yet
  // reaped), the overlay spins forever and the only recovery is a reload. This
  // timer guarantees creatingSession always resolves. It is longer than the load
  // watchdog because creating can legitimately take a while (git init + creating
  // a remote GitHub repo over the network).
  private createWatchdog: any = null;
  private static readonly CREATE_WATCHDOG_MS = 25_000;
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
  // Per-message confirmation watchdogs. A user message committed optimistically
  // is only proven delivered when the server echoes it back; if no echo lands
  // within CONFIRM_MS the watchdog flips it to delivery:'failed' so the UI can
  // offer a retry instead of pretending it was sent (the half-open-socket loss).
  private confirmTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly CONFIRM_MS = 12_000;
  private static readonly PENDING_PREFIX = 'wherever-pending:';

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
      //
      // Re-attachment is REQUIRED on every reconnect that still holds a session,
      // not just the suspend/resume path. The server is stateless per socket:
      // each new connection starts attached to NO session (the old socket's
      // close removed this client from the pool). If we do not re-issue
      // session_load here, the relay is connected but the session stream is
      // dead, so the UI shows a frozen conversation (a stale tool call as the
      // last message, Abort disabled) while the agent keeps running headless.
      // Two sources for what to rejoin:
      //   1. resumeSessionFile  -> explicit suspend()/resume() (tab background).
      //   2. the store's activeSessionFile -> an UNSOLICITED drop (network
      //      blip, tab switch, laptop sleep, half-open reap) where suspend()
      //      never ran. This is the case that used to silently freeze.
      const cached = get(this.stateStore);
      const rejoinFile = this.resumeSessionFile ?? cached.activeSessionFile;
      const rejoinCwd =
        this.resumeSessionFile != null
          ? this.resumeCwd
          : (cached.activeCwd ?? undefined);
      const rejoinModel =
        this.resumeSessionFile != null
          ? this.resumeModel
          : (cached.activeModel ?? undefined);
      this.resumeSessionFile = null;
      this.resumeCwd = undefined;
      this.resumeModel = undefined;
      if (rejoinFile) {
        // Keep the cached conversation on screen but mark it resyncing so the
        // "Reconnecting and syncing session..." banner shows and sending is
        // blocked until fresh history lands. resyncing is cleared by
        // message_history (or an error/conflict) via the reducer.
        this.stateStore.update(s => (s.resyncing ? s : {...s, resyncing: true}));
        this.send({type: 'session_load', sessionFile: rejoinFile, cwd: rejoinCwd, model: rejoinModel});
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
        // If we still hold an active session, the drop is an unsolicited one on a
        // live conversation: mark it resyncing NOW (during the reconnect backoff)
        // so the user immediately sees "Reconnecting..." instead of a frozen view
        // with a stale tool call and a disabled Abort. onOpen re-attaches and the
        // reducer clears resyncing when fresh history lands.
        resyncing: s.activeSessionFile ? true : s.resyncing,
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
    // A pending agent_end clear timer belongs to the socket we are tearing down.
    // Leaving it armed lets it fire against a freshly (re)connected session's
    // state, so cancel it here.
    if (this.agentEndTimeout) {
      clearTimeout(this.agentEndTimeout);
      this.agentEndTimeout = null;
    }
    this.stopLivenessWatchdog();
    // The load/create affordances belong to the socket we are tearing down. If
    // left armed they would later fire against a fresh (re)connected session's
    // state, so cancel them here.
    this.clearLoadWatchdog();
    this.clearCreateWatchdog();

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
      // Full teardown wipes the store, so no unconfirmed message survives in it;
      // clear their watchdogs to avoid firing against a fresh store. The
      // persisted-pending localStorage entries intentionally REMAIN so a later
      // load can still recover them.
      for (const t of this.confirmTimers.values()) clearTimeout(t);
      this.confirmTimers.clear();
      this.stateStore.set({
        ...defaultState,
        hideThinking: !!this.config.hideThinking,
        hideTools: !!this.config.hideTools,
      });
    } else {
      // Preserve-cache teardown (suspend / resume's pre-connect close). The
      // socket is gone, so the store MUST reflect disconnected: leaving a stale
      // connected:true made resume() early-return (its `if (connected) return`
      // guard), so the real reconnect fell through to a plain connect() that did
      // NOT preserve the session, which is what flashed the search / new-session
      // empty-state on tab return. Clearing connected here (without wiping the
      // cached session/messages) lets resume() actually rejoin in place, and
      // never leaves the blocking load/create overlays up on a dead socket.
      this.stateStore.update(s => ({
        ...s,
        connected: false,
        connecting: false,
        loadingSession: false,
        creatingSession: false,
      }));
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
    // The socket producing the live stream is going away. If we carry a stale
    // isStreaming:true across the suspend/resume gap, the composer will wrongly
    // queue the next message as if the agent were still busy (and the queue
    // never drains because no agent_end ever arrives on the dead socket). The
    // authoritative value is re-established by session_created on rejoin.
    if (s.isStreaming) {
      this.stateStore.update(st => ({...st, isStreaming: false}));
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
    // Rejoin whatever session we still hold: an explicit suspend() record OR the
    // cached active session from an unsolicited drop. In BOTH cases onOpen
    // re-issues session_load, so mark resyncing here to show the affordance and
    // block sending until fresh history lands.
    if (this.resumeSessionFile || s.activeSessionFile) {
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

  // True when the store still holds an active session to rejoin in place -- from
  // an explicit suspend() OR an unsolicited drop that left activeSessionFile set.
  // Callers use this to prefer the preserve-cache resume() path over a fresh,
  // session-wiping connect() when returning to a still-live conversation.
  public hasActiveSession(): boolean {
    return this.resumeSessionFile !== null || get(this.stateStore).activeSessionFile !== null;
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

  // Arm (or re-arm) the create watchdog. Called when session_new is issued so an
  // unanswered create can never strand the blocking "Creating session..."
  // overlay. On expiry we clear creatingSession and surface a recoverable error
  // instead of an endless spin that only a reload escapes.
  private armCreateWatchdog() {
    this.clearCreateWatchdog();
    this.createWatchdog = setTimeout(() => {
      this.createWatchdog = null;
      const s = get(this.stateStore);
      if (!s.creatingSession) return;
      console.warn('[wherever] session create timed out; clearing creating state');
      this.stateStore.update(st => ({
        ...st,
        creatingSession: false,
        sessionError:
          st.sessionError ||
          'Creating the session timed out. It may still be starting on the server; check the sidebar or reload.',
      }));
    }, WhereverClient.CREATE_WATCHDOG_MS);
  }

  // Clear the create watchdog. Called at every point a create resolves
  // (session_created, session_error, session_conflict, session_interrupted,
  // disconnect, leave).
  private clearCreateWatchdog() {
    if (this.createWatchdog) {
      clearTimeout(this.createWatchdog);
      this.createWatchdog = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      console.info(`[wherever] reconnecting to relay (attempt ${++this.reconnectAttempts})`);

      // If we still hold an active session, PRESERVE the cached store across the
      // reconnect. A default connect() resets to a blank store, which wiped
      // activeSessionFile BEFORE onOpen could re-attach to it -- that is what
      // silently detached the frontend from a still-running session (frozen
      // conversation, no re-follow, not even a "connecting"/"loading" hint).
      // Preserving the store keeps the conversation on screen and lets onOpen
      // re-issue session_load from activeSessionFile.
      const preserve = !!get(this.stateStore).activeSessionFile;

      this.stateStore.update(s => ({
        ...s,
        connecting: true,
        error: 'Reconnecting...',
      }));

      this.connect(undefined, preserve);
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

    // Any message that resolves an in-flight session_new disarms the create
    // watchdog. session_created is the success path; error/conflict/interrupt end
    // it too.
    switch (msg.type) {
      case 'session_created':
      case 'session_error':
      case 'session_conflict':
      case 'session_interrupted':
        this.clearCreateWatchdog();
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
            // The server echoes the user's own message back once pi has appended
            // it: that is the delivery CONFIRMATION for an optimistic (unconfirmed)
            // echo. Confirm the matching pending message (flip delivery off, clear
            // its watchdog, update the persisted-pending store) instead of adding
            // a duplicate. If there was no pending match (e.g. another client sent
            // it), fall back to the existing content-dedupe.
            if (msg.role === 'user') {
              const confirmedPending = this.confirmDeliveredByContent(msg.content);
              if (confirmedPending) {
                // Re-read: confirmDeliveredByContent already updated the store.
                return get(this.stateStore);
              }
            }
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
          const now = Date.now();
          this.stateStore.update((s: WhereverState) => ({
            ...s,
            isStreaming: false,
            messages: s.messages.map((m: ChatMessage) =>
              m.isStreaming
                ? {
                    ...m,
                    isStreaming: false,
                    // A tool still streaming when the turn ends never got a
                    // tool_end (e.g. the turn was aborted, or its result frame
                    // was lost): its outcome is unknown. Mark it interrupted
                    // (neutral), never let it fall through to a green success
                    // tick, which would falsely claim it succeeded. Assistant/
                    // thinking messages just stop streaming.
                    ...(m.role === 'tool' ? {interrupted: true} : {}),
                    // Freeze a still-running tool's duration if it never got a
                    // tool_end (turn ended between steps), so "Elapsed" stops
                    // ticking and shows the final "Took".
                    endedAt:
                      m.role === 'tool' && m.endedAt === undefined
                        ? now
                        : m.endedAt,
                  }
                : m,
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
          const startedAt = Date.now();
          const newMsg: ChatMessage = {
            id: this.generateId(),
            role: 'tool',
            content: toolArgs
              ? `$ ${msg.toolName} ${toolArgs}`
              : `$ ${msg.toolName}`,
            timestamp: startedAt,
            isStreaming: true,
            toolName: msg.toolName,
            toolArgs: toolArgs,
            toolOutput: '',
            startedAt,
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
        // An abort (e.g. the web "abort" button killed the tool mid-run) surfaces
        // as isError with a trailing "...aborted" status. That is not a tool
        // FAILURE, so render it as the neutral interrupted state, not a red
        // error.
        const aborted = !!msg.isError && this.isAbortedToolResult(result);
        const effectiveIsError = !!msg.isError && !aborted;
        const toolImages =
          Array.isArray(msg.images) && msg.images.length > 0
            ? msg.images
            : undefined;
        this.stateStore.update((s: WhereverState) => {
          // Claim the OLDEST still-streaming tool of this name (FIFO). Parallel
          // tool calls share a name, so matching the LAST one (or any already
          // finalized one) would let two tool_end frames land on the SAME
          // message and leave the other tool stuck streaming: it would then be
          // finalized by the 'aborted'/agent_end sweep with no result and render
          // as a bogus green success. Preferring a streaming message means each
          // tool_end settles a distinct in-flight call. Fall back to the newest
          // non-error tool of this name only if none are still streaming.
          const toolMsg =
            s.messages.find(
              (m: ChatMessage) =>
                m.role === 'tool' &&
                m.toolName === msg.toolName &&
                m.isStreaming,
            ) ??
            [...s.messages]
              .reverse()
              .find(
                (m: ChatMessage) =>
                  m.role === 'tool' &&
                  m.toolName === msg.toolName &&
                  !m.content.startsWith('Tool error:'),
              );
          const endedAt = Date.now();
          if (toolMsg) {
            const errorPrefix = effectiveIsError ? 'Error: ' : '';
            return {
              ...s,
              messages: s.messages.map((m: ChatMessage) =>
                m.id === toolMsg.id
                  ? {
                      ...m,
                      content: `${errorPrefix}${m.content}\n${result}`,
                      isStreaming: false,
                      isError: effectiveIsError,
                      interrupted: aborted,
                      toolOutput: result,
                      ...(toolImages ? {images: toolImages} : {}),
                      endedAt,
                    }
                  : m,
              ),
            };
          } else {
            const content = effectiveIsError
              ? `Tool error: ${msg.toolName}\n${result}`
              : `${msg.toolName}\n${result}`;
            const message: ChatMessage = {
              id: this.generateId(),
              role: 'tool',
              content,
              timestamp: endedAt,
              isStreaming: false,
              toolName: msg.toolName,
              toolArgs: '',
              toolOutput: result,
              ...(toolImages ? {images: toolImages} : {}),
              isError: effectiveIsError,
              interrupted: aborted,
              endedAt,
            };
            return {
              ...s,
              messages: [...s.messages, message],
            };
          }
        });
        break;
      }

      case 'aborted': {
        const abortedAt = Date.now();
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          isStreaming: false,
          messages: s.messages.map((m: ChatMessage) =>
            m.isStreaming
              ? {
                  ...m,
                  isStreaming: false,
                  // A tool still streaming when the turn is aborted was killed
                  // with no result: mark it interrupted (neutral), never leave
                  // it to fall through to a green success tick. Assistant/
                  // thinking messages just stop streaming.
                  ...(m.role === 'tool' ? {interrupted: true} : {}),
                  endedAt:
                    m.role === 'tool' && m.endedAt === undefined
                      ? abortedAt
                      : m.endedAt,
                }
              : m,
          ),
        }));
        break;
      }

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
          // pending -> the history is painted now but the live agent is still
          // building; keep the composer disabled (agentPending) until
          // session_ready. A non-pending create (new session, warm reload) is
          // immediately sendable.
          agentPending: msg.pending === true,
          // Initial context-usage snapshot for the new session (null if unknown;
          // live updates arrive via 'context_usage').
          contextUsage: msg.contextUsage ?? null,
        }));
        break;

      case 'session_ready':
        // The live agent finished building for a previously-pending load. Enable
        // the composer and refresh the now-authoritative model/streaming/usage.
        this.stateStore.update((s: WhereverState) => {
          // Ignore a stale ready for a session we already switched away from.
          if (msg.sessionFile && s.activeSessionFile && msg.sessionFile !== s.activeSessionFile) {
            return s;
          }
          return {
            ...s,
            agentPending: false,
            activeModel: msg.model ?? s.activeModel,
            isStreaming: msg.isStreaming ?? s.isStreaming,
            contextUsage: msg.contextUsage ?? s.contextUsage,
          };
        });
        break;

      case 'context_usage':
        this.stateStore.update((s: WhereverState) => ({
          ...s,
          contextUsage: msg.contextUsage ?? null,
        }));
        break;

      case 'session_notice':
        // A non-fatal notice for the active session (e.g. a CLI took over while
        // this session was mid-turn here, discarding the in-flight tool call or
        // streaming reply). Keep the session attached; surface it as a
        // dismissible banner. Ignore a notice for a session we switched away from.
        this.stateStore.update((s: WhereverState) => {
          if (s.sessionId && msg.sessionId && s.sessionId !== msg.sessionId) return s;
          return { ...s, notice: { level: msg.level, message: msg.message } };
        });
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
              agentPending: false,
              notice: null,
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
          // A failed (cold) agent build clears pending: the session stays
          // readable, but sending remains blocked (no live agent) and the error
          // is surfaced. This is the degrade-to-read-only path.
          agentPending: false,
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
          agentPending: false,
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
          agentPending: false,
          notice: null,
        }));
        break;

      case 'message_history': {
        // The server transcript is authoritative for what was actually persisted.
        // Reconcile it against any unconfirmed outbound messages: keep the ones
        // that ARE in history (delivered), and re-surface the ones that are NOT
        // as recoverable 'failed' items so a message a half-open socket swallowed
        // is never silently lost across a reload/resync.
        const sessionIdForPending = msg.sessionId as string;
        // Carry-over from the CURRENT store (this-tab sends still in flight) plus
        // anything a PREVIOUS tab persisted before a reload.
        const inFlight = get(this.stateStore).messages.filter(
          (m) => m.role === 'user' && m.delivery !== undefined,
        );
        const persisted = this.loadPersistedPending(sessionIdForPending);
        const candidates = [...persisted, ...inFlight];
        this.stateStore.update((s: WhereverState) => {
          const mapped = this.mapHistory(msg.messages, msg.sessionId, s.isStreaming);
          const totalCount =
            typeof msg.totalCount === 'number' ? msg.totalCount : mapped.length;
          const offset = typeof msg.offset === 'number' ? msg.offset : 0;
          const historyContents = new Set(
            mapped.filter((m) => m.role === 'user').map((m) => m.content),
          );
          // Unconfirmed candidates whose content is NOT in the loaded history are
          // undelivered. De-dupe by content so two identical undelivered sends do
          // not multiply. Everything else the server persisted is already in
          // `mapped` (confirmed).
          const seen = new Set<string>();
          const undelivered: ChatMessage[] = [];
          for (const c of candidates) {
            if (historyContents.has(c.content)) continue;
            if (seen.has(c.content)) continue;
            seen.add(c.content);
            undelivered.push({...c, sessionId: sessionIdForPending, delivery: 'failed'});
          }
          return {
            ...s,
            messages: [...mapped, ...undelivered],
            historyTotalCount: totalCount,
            historyOffset: offset,
            loadingMoreHistory: false,
            loadingSession: false,
            resyncing: false,
          };
        });
        // Clear watchdogs for anything now confirmed, and rewrite the persisted
        // store to exactly the still-undelivered set.
        for (const c of candidates) this.clearConfirm(c.id);
        this.persistPending(sessionIdForPending);
        break;
      }

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
   * True when an errored tool result is the product of a USER ABORT (e.g. the
   * web "abort" button killed a running tool), rather than a genuine tool
   * failure. The pi tools append a trailing status line on abort ("Command
   * aborted" for bash, "Operation aborted" for edit/write, bare "aborted" for a
   * pre-execution abort). We match that trailing status so the UI can render a
   * neutral "interrupted" state instead of a red error: you cancelling a tool is
   * not the tool failing. Only meaningful when isError is already true; matched
   * as the LAST non-empty line to avoid false positives from command output that
   * merely contains the word "aborted".
   */
  private isAbortedToolResult(result: string | undefined): boolean {
    if (!result) return false;
    const lines = result.trimEnd().split('\n');
    const last = (lines[lines.length - 1] || '').trim();
    return /^(command|operation)?\s*aborted$/i.test(last);
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
    // A tool_call is rendered IN PLACE, at its position in the stream, as a tool
    // message that is initially result-less. Its matching tool_result fills it
    // in later. We track the still-open calls per tool name as indices into
    // `mapped`, so a call that never receives a result simply stays where it was
    // issued (correctly marked interrupted below) instead of being hoisted to
    // the very end of the transcript. The end-hoisting was the bug: dangling
    // tool calls from EARLIER in the conversation (e.g. an interrupted long-
    // running bash, later superseded by a new user turn) would all pile up as a
    // "series of aborted tool calls" AFTER the latest reply, even though the CLI
    // shows them inline where they happened.
    const openCalls: Record<string, number[]> = {};

    for (const m of rawMessages) {
      if (m.role === 'tool_call') {
        const tName = m.toolName || 'unknown';
        const args = m.content || '';
        const idx = mapped.length;
        mapped.push({
          id: this.generateId(),
          role: 'tool',
          content: args ? `$ ${tName} ${args}` : `$ ${tName}`,
          timestamp: m.timestamp,
          // No result yet. Marked as interrupted below if it stays unmatched;
          // the streaming tail promotes the last one back to streaming.
          isStreaming: false,
          toolName: tName,
          toolArgs: args,
          toolOutput: '',
          sessionId,
          // Keep the start so a matched result (or a still-running streaming
          // tail) can show a coherent duration / "Elapsed".
          ...(Number.isFinite(m.timestamp) ? {startedAt: m.timestamp} : {}),
        });
        if (!openCalls[tName]) openCalls[tName] = [];
        openCalls[tName].push(idx);
      } else if (m.role === 'tool_result') {
        const tName = m.toolName || 'unknown';
        // Fill the OLDEST still-open call of this name (FIFO), mirroring how
        // parallel same-named calls resolve in order.
        const callIdx =
          openCalls[tName] && openCalls[tName].length > 0
            ? openCalls[tName].shift()!
            : undefined;
        const isError = m.isError && !this.isAbortedToolResult(m.content);
        const interrupted = !!m.isError && this.isAbortedToolResult(m.content);
        if (callIdx !== undefined) {
          const call = mapped[callIdx];
          const tArgs = call.toolArgs || '';
          const startedAt = call.startedAt;
          mapped[callIdx] = {
            ...call,
            content: tArgs
              ? `$ ${tName} ${tArgs}\n${m.content}`
              : `$ ${tName}\n${m.content}`,
            isStreaming: false,
            toolOutput: m.content,
            ...(Array.isArray(m.images) && m.images.length > 0
              ? {images: m.images}
              : {}),
            // A user abort surfaces as an errored result with a trailing
            // "...aborted" status. Render it as interrupted (neutral), not a red
            // error: aborting a tool is not the tool failing.
            isError,
            interrupted,
            timestamp: m.timestamp,
            // Duration only when both timestamps are finite and coherent
            // (end >= start); otherwise leave unset rather than show a bogus one.
            ...(startedAt !== undefined &&
            Number.isFinite(startedAt) &&
            Number.isFinite(m.timestamp) &&
            m.timestamp >= startedAt
              ? {endedAt: m.timestamp}
              : {}),
          };
        } else {
          // A result with no preceding open call (shouldn't normally happen).
          // Render it in place as a standalone tool message so nothing is lost.
          mapped.push({
            id: this.generateId(),
            role: 'tool',
            content: `$ ${tName}\n${m.content}`,
            timestamp: m.timestamp,
            isStreaming: false,
            toolName: tName,
            toolArgs: '',
            toolOutput: m.content,
            ...(Array.isArray(m.images) && m.images.length > 0
              ? {images: m.images}
              : {}),
            isError,
            interrupted,
            sessionId,
          });
        }
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

    // Any call still open (issued a toolCall, never got a tool_result) is FROZEN
    // in place with no result. Meaning depends on context:
    //   - streaming tail (applyStreamingTail): only the MOST RECENT open call is
    //     plausibly still running; keep it streaming so the UI ticks "Elapsed".
    //     Earlier open calls in the same window are already superseded and are
    //     interrupted.
    //   - otherwise: its outcome is unknown (e.g. a CLI takeover / interruption
    //     killed it mid-run), so mark it `interrupted` for a neutral "no result"
    //     state instead of a bogus green success tick.
    const allOpen: number[] = [];
    for (const idxs of Object.values(openCalls)) allOpen.push(...idxs);
    allOpen.sort((a, b) => a - b);
    const lastOpenIdx =
      applyStreamingTail && allOpen.length > 0
        ? allOpen[allOpen.length - 1]
        : -1;
    for (const idx of allOpen) {
      if (idx === lastOpenIdx) {
        mapped[idx] = {...mapped[idx], isStreaming: true};
      } else {
        mapped[idx] = {...mapped[idx], interrupted: true};
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

  // Returns true only when the frame was actually handed to an OPEN socket.
  // A non-OPEN (null / CONNECTING / CLOSING / half-open) socket silently
  // dropping the frame is what made messages vanish: they rendered locally but
  // never reached the server, so they were gone after a reload. Callers that
  // carry user intent (sendMessage) must check this and surface the failure.
  public send(msg: any): boolean {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      try {
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // Returns true only if the message actually went out over an OPEN socket.
  // Callers MUST use the return value to decide whether to clear the input:
  // clearing on a false return is what loses the user's text on a dropped send.
  public sendMessage(text: string): boolean {
    const s = get(this.stateStore);
    if (!s.sessionId) return false;

    // The session's transcript is loaded but its live agent is still building
    // (cold, fast-first load). Reading is fine; sending is not possible yet, and
    // a message sent now would have no agent to receive it. Surface a clear,
    // recoverable hint and keep the text (the composer is disabled anyway, but a
    // programmatic caller could still reach here).
    if (s.agentPending) {
      this.stateStore.update((st: WhereverState) => ({
        ...st,
        sessionError:
          st.sessionError ?? 'Preparing the session agent; please wait a moment, then resend.',
      }));
      return false;
    }

    // Guard against sending on a dead / half-open socket. getIsConnected()
    // checks the real readyState (not the store's connected flag, which can lag
    // a half-open socket the liveness watchdog has not reaped yet). Sending here
    // would be silently dropped, the message would appear locally, then vanish
    // on reload. Surface a recoverable error and make sure we are reconnecting
    // instead of optimistically rendering a message that never left.
    if (!this.getIsConnected()) {
      this.stateStore.update((st: WhereverState) => ({
        ...st,
        sessionError:
          'Not connected to the relay; your message was not sent. Reconnecting, then please resend.',
      }));
      if (!this.ws && !this.reconnectTimer) {
        this.scheduleReconnect();
      }
      return false;
    }

    // Send first; only commit the optimistic local echo + clear the error once
    // the frame is confirmed handed to an OPEN socket. This way a send that
    // fails (a narrow race between the readyState check and send) leaves no
    // phantom local message and keeps the input intact for the caller to retry.
    const ok = this.send({type: 'message', message: text, sessionId: s.sessionId});
    if (!ok) {
      this.stateStore.update((st: WhereverState) => ({
        ...st,
        sessionError:
          'Message failed to send (connection dropped). Please resend once reconnected.',
      }));
      return false;
    }

    // The frame was handed to an OPEN socket, but that is NOT proof of delivery:
    // a half-open TCP connection accepts send() (buffers locally, no throw) yet
    // the bytes never reach the server. So commit the echo as delivery:'sending'
    // (unconfirmed) and arm a watchdog + persist it, so it is recoverable on
    // reload and flips to 'failed' if the server never echoes it back.
    const message: ChatMessage = {
      id: this.generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      isStreaming: false,
      sessionId: s.sessionId,
      delivery: 'sending',
    };
    this.stateStore.update((st: WhereverState) => ({
      ...st,
      sessionError: null,
      messages: [...st.messages, message],
    }));
    this.armConfirm(message.id);
    this.persistPending(s.sessionId);
    return true;
  }

  // ==========================================================================
  // Outbound-message delivery confirmation + recovery.
  //
  // An optimistic user echo is unconfirmed until the server echoes it back. This
  // machinery makes an unconfirmed message survive a reload and surface a retry
  // affordance instead of being silently lost when a half-open socket swallowed
  // the frame.
  // ==========================================================================

  private pendingKey(sessionId: string): string {
    return WhereverClient.PENDING_PREFIX + sessionId;
  }

  // Persist the current session's still-unconfirmed (delivery-tagged) user
  // messages so a reload can recover them. Cleared to empty when none remain.
  private persistPending(sessionId: string | null): void {
    if (!sessionId || typeof localStorage === 'undefined') return;
    const pending = get(this.stateStore).messages.filter(
      (m) => m.role === 'user' && m.delivery !== undefined,
    );
    try {
      if (pending.length === 0) {
        localStorage.removeItem(this.pendingKey(sessionId));
      } else {
        localStorage.setItem(
          this.pendingKey(sessionId),
          JSON.stringify(
            pending.map((m) => ({
              id: m.id,
              content: m.content,
              timestamp: m.timestamp,
              // Persist as 'failed': a reload cannot know if it ever landed, so
              // it must be presented as needs-attention, never as delivered.
              delivery: 'failed' as const,
            })),
          ),
        );
      }
    } catch {}
  }

  // Load persisted unconfirmed messages for a session (used on load/resync to
  // re-surface anything a previous tab left in limbo).
  private loadPersistedPending(sessionId: string): ChatMessage[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(this.pendingKey(sessionId));
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((m) => m && typeof m.content === 'string')
        .map((m) => ({
          id: typeof m.id === 'string' ? m.id : this.generateId(),
          role: 'user' as const,
          content: m.content,
          timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
          isStreaming: false,
          sessionId,
          delivery: 'failed' as const,
        }));
    } catch {
      return [];
    }
  }

  private armConfirm(messageId: string): void {
    this.clearConfirm(messageId);
    if (typeof setTimeout !== 'function') return;
    const timer = setTimeout(() => {
      this.confirmTimers.delete(messageId);
      // Still unconfirmed after the window: mark it failed so the UI offers a
      // retry. Delivery is genuinely uncertain (a half-open socket may have
      // eaten it), so we do NOT auto-resend: that risks a duplicate. The user
      // decides.
      let sessionId: string | null = null;
      this.stateStore.update((st: WhereverState) => {
        const m = st.messages.find((x) => x.id === messageId);
        if (!m || m.delivery !== 'sending') return st;
        sessionId = st.sessionId;
        return {
          ...st,
          messages: st.messages.map((x) =>
            x.id === messageId ? {...x, delivery: 'failed'} : x,
          ),
        };
      });
      if (sessionId) this.persistPending(sessionId);
    }, WhereverClient.CONFIRM_MS);
    if (timer && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    this.confirmTimers.set(messageId, timer);
  }

  private clearConfirm(messageId: string): void {
    const t = this.confirmTimers.get(messageId);
    if (t) {
      clearTimeout(t);
      this.confirmTimers.delete(messageId);
    }
  }

  // Mark the oldest still-unconfirmed user message with this content as
  // delivered (the server echoed it back). Content-matched because the server
  // echo carries no client message id. Returns true if one was confirmed.
  private confirmDeliveredByContent(content: string): boolean {
    let confirmedId: string | null = null;
    let sessionId: string | null = null;
    this.stateStore.update((st: WhereverState) => {
      const target = st.messages.find(
        (m) => m.role === 'user' && m.delivery !== undefined && m.content === content,
      );
      if (!target) return st;
      confirmedId = target.id;
      sessionId = st.sessionId;
      return {
        ...st,
        messages: st.messages.map((m) =>
          m.id === target.id ? {...m, delivery: undefined} : m,
        ),
      };
    });
    if (confirmedId) {
      this.clearConfirm(confirmedId);
      this.persistPending(sessionId);
      return true;
    }
    return false;
  }

  // Retry a failed (or sending) outbound message: re-send its frame and re-arm
  // confirmation. Returns false if it could not be handed to an OPEN socket (the
  // message stays failed/recoverable).
  public resendMessage(messageId: string): boolean {
    const s = get(this.stateStore);
    const m = s.messages.find((x) => x.id === messageId && x.role === 'user');
    if (!m || !s.sessionId) return false;
    if (!this.getIsConnected()) {
      if (!this.ws && !this.reconnectTimer) this.scheduleReconnect();
      return false;
    }
    const ok = this.send({type: 'message', message: m.content, sessionId: s.sessionId});
    if (!ok) return false;
    this.stateStore.update((st: WhereverState) => ({
      ...st,
      sessionError: null,
      messages: st.messages.map((x) =>
        x.id === messageId ? {...x, delivery: 'sending', timestamp: Date.now()} : x,
      ),
    }));
    this.armConfirm(messageId);
    this.persistPending(s.sessionId);
    return true;
  }

  // Drop a failed outbound message the user chooses not to resend. Removes it
  // from the transcript and from the persisted-pending store.
  public discardMessage(messageId: string): void {
    let sessionId: string | null = null;
    this.clearConfirm(messageId);
    this.stateStore.update((st: WhereverState) => {
      sessionId = st.sessionId;
      return {
        ...st,
        messages: st.messages.filter((m) => m.id !== messageId),
      };
    });
    if (sessionId) this.persistPending(sessionId);
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
      agentPending: false,
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
      notice: null,
      creatingSession: false,
      resyncing: false,
      agentPending: false,
      contextUsage: null,
      loadingSession: true,
    }));
    this.resumeSessionFile = null;
    this.resumeCwd = undefined;
    this.resumeModel = undefined;
    // Switching supersedes any in-flight create; disarm its watchdog so it can't
    // later fire against the newly loaded session.
    this.clearCreateWatchdog();
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
    // Never let the blocking "Creating session..." overlay hang if the reply is
    // lost. Symmetrical with armLoadWatchdog for session_load.
    this.armCreateWatchdog();
  }

  public leaveSession() {
    const s = get(this.stateStore);
    // Leaving abandons any in-flight create too, so disarm its watchdog even when
    // there is no sessionId yet (a create that has not resolved).
    this.clearCreateWatchdog();
    if (!s.sessionId) {
      if (s.creatingSession) {
        this.stateStore.update((st: WhereverState) => ({
          ...st,
          creatingSession: false,
        }));
      }
      return;
    }
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
      notice: null,
      creatingSession: false,
      loadingSession: false,
      resyncing: false,
      agentPending: false,
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

  public dismissNotice() {
    this.stateStore.update((s: WhereverState) => ({...s, notice: null}));
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

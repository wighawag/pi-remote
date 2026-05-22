import path from 'path';
import { createAgentSession, AuthStorage, ModelRegistry, DefaultResourceLoader, SettingsManager, getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Model, Api } from '@earendil-works/pi-ai';
import type { SessionMessageEntry, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { SessionInfo, HistoryMessage, FolderWithSessions, ModelInfo, FolderSessionInfo } from './session-types.js';

interface TrackedSession {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  model: string;
  agentSession: AgentSession;
  clients: Set<string>;
  isIdle: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  eventUnsubscribe: () => void;
  createdAt: number;
  lastActivity: number;
}

export class SessionPool {
  private sessions = new Map<string, TrackedSession>();
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private agentDir: string;
  private idleTimeoutMs: number;

  onEvent?: (sessionFile: string, event: AgentSessionEvent) => void;

  constructor(idleTimeoutMs = 300_000) {
    this.agentDir = getAgentDir();
    this.authStorage = AuthStorage.create();
    this.modelRegistry = ModelRegistry.create(this.authStorage);
    this.idleTimeoutMs = idleTimeoutMs;
  }

  async initialize(): Promise<void> {
    this.modelRegistry.refresh();
  }

  getAvailableModels(): ModelInfo[] {
    const available = this.modelRegistry.getAvailable();
    const settings = SettingsManager.create(process.cwd(), this.agentDir);
    const defaultProvider = settings.getDefaultProvider();
    const defaultModel = settings.getDefaultModel();

    return available.map((m: Model<Api>) => {
      const isDefault = m.provider === defaultProvider && m.id === defaultModel;
      return {
        provider: m.provider,
        modelId: m.id,
        label: `${this.modelRegistry.getProviderDisplayName(m.provider)}: ${m.name}`,
        isDefault,
      };
    });
  }

  findModel(provider: string, modelId: string): Model<Api> | undefined {
    return this.modelRegistry.find(provider, modelId);
  }

  async loadSession(sessionFile: string, cwd?: string, modelStr?: string): Promise<{ tracked: TrackedSession; error?: string }> {
    if (this.sessions.has(sessionFile)) {
      return { tracked: this.sessions.get(sessionFile)! };
    }

    try {
      const sessionManager = SessionManager.open(sessionFile);
      const header = sessionManager.getHeader();

      if (!header) {
        return { tracked: null as any, error: 'Session file has no header' };
      }

      const sessionCwd = cwd || header.cwd || process.cwd();
      let model: Model<Api> | undefined;

      if (modelStr) {
        const colonIdx = modelStr.indexOf(':');
        const provider = modelStr.slice(0, colonIdx);
        const id = modelStr.slice(colonIdx + 1);
        model = this.modelRegistry.find(provider, id);
      }

      if (!model && header) {
        const entries = sessionManager.getEntries();
        const modelChange = entries.find((e: SessionEntry) => e.type === 'model_change');
        if (modelChange && 'provider' in modelChange && 'modelId' in modelChange) {
          model = this.modelRegistry.find(modelChange.provider, modelChange.modelId);
        }
      }

      const settingsManager = SettingsManager.create(sessionCwd, this.agentDir);
      const resourceLoader = new DefaultResourceLoader({
        cwd: sessionCwd,
        agentDir: this.agentDir,
        settingsManager,
      });
      await resourceLoader.reload();

      const { session: agentSession } = await createAgentSession({
        cwd: sessionCwd,
        authStorage: this.authStorage,
        modelRegistry: this.modelRegistry,
        model,
        sessionManager,
        settingsManager,
        resourceLoader,
      });

      const modelLabel = agentSession.model ? `${agentSession.model.provider}:${agentSession.model.id}` : '';

      const tracked: TrackedSession = {
        sessionId: agentSession.sessionId,
        sessionFile,
        cwd: sessionCwd,
        model: modelLabel,
        agentSession,
        clients: new Set(),
        isIdle: true,
        idleTimer: null,
        eventUnsubscribe: this.setupEventListeners(sessionFile, agentSession),
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      this.sessions.set(sessionFile, tracked);
      return { tracked };
    } catch (err) {
      return { tracked: null as any, error: (err as Error).message };
    }
  }

  async createNewSession(cwd: string, modelStr?: string): Promise<{ tracked: TrackedSession; error?: string; sessionFile?: string }> {
    const existing = this.findActiveSessionByCwd(cwd);
    if (existing && existing.clients.size > 0) {
      return { tracked: existing };
    }

    try {
      const sessionManager = SessionManager.create(cwd);
      let model: Model<Api> | undefined;

      if (modelStr) {
        const colonIdx = modelStr.indexOf(':');
        const provider = modelStr.slice(0, colonIdx);
        const id = modelStr.slice(colonIdx + 1);
        model = this.modelRegistry.find(provider, id);
      }

      const settingsManager = SettingsManager.create(cwd, this.agentDir);
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: this.agentDir,
        settingsManager,
      });
      await resourceLoader.reload();

      const { session: agentSession } = await createAgentSession({
        cwd,
        authStorage: this.authStorage,
        modelRegistry: this.modelRegistry,
        model,
        sessionManager,
        settingsManager,
        resourceLoader,
      });

      const sessionFile = agentSession.sessionFile || '';
      const modelLabel = agentSession.model ? `${agentSession.model.provider}:${agentSession.model.id}` : '';

      const tracked: TrackedSession = {
        sessionId: agentSession.sessionId,
        sessionFile,
        cwd,
        model: modelLabel,
        agentSession,
        clients: new Set(),
        isIdle: true,
        idleTimer: null,
        eventUnsubscribe: this.setupEventListeners(sessionFile, agentSession),
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      this.sessions.set(sessionFile, tracked);
      return { tracked, sessionFile };
    } catch (err) {
      return { tracked: null as any, error: (err as Error).message };
    }
  }

  addClient(sessionId: string, clientId: string): TrackedSession | null {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return null;
    tracked.clients.add(clientId);
    tracked.lastActivity = Date.now();
    this.cancelIdleCheck(sessionId);
    return tracked;
  }

  removeClient(sessionId: string, clientId: string): void {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;
    tracked.clients.delete(clientId);
    this.scheduleIdleCheck(sessionId);
  }

  getSession(sessionId: string): TrackedSession | null {
    return this.sessions.get(sessionId) || null;
  }

  findActiveSessionByCwd(cwd: string): TrackedSession | null {
    for (const s of this.sessions.values()) {
      if (s.cwd === cwd) return s;
    }
    return null;
  }

  detectConflict(targetSessionId: string, targetCwd: string): { conflict: boolean; otherSessionId?: string; otherCwd?: string } {
    if (this.sessions.has(targetSessionId)) {
      return { conflict: false };
    }

    for (const s of this.sessions.values()) {
      if (s.cwd === targetCwd && s.clients.size > 0) {
        return { conflict: true, otherSessionId: s.sessionId, otherCwd: s.cwd };
      }
    }
    return { conflict: false };
  }

  getSessionHistory(sessionId: string): HistoryMessage[] {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return [];

    const entries = tracked.agentSession.sessionManager.getEntries();
    const messages: HistoryMessage[] = [];

    for (const entry of entries) {
      if (entry.type === 'message') {
        const msgEntry = entry as SessionMessageEntry;
        const msg = msgEntry.message;
        const ts = Date.parse(msgEntry.timestamp);

        if (msg.role === 'user') {
          const content = this.extractMessageText(msg);
          if (content) {
            messages.push({ role: 'user', content, timestamp: ts });
          }
        } else if (msg.role === 'assistant') {
          const content = msg.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'thinking') {
                const thinking = (block as any).thinking || '';
                if (thinking) {
                  messages.push({ role: 'thinking', content: thinking, timestamp: ts });
                }
              } else if (block.type === 'text') {
                const text = (block as any).text || '';
                if (text) {
                  messages.push({ role: 'assistant', content: text, timestamp: ts });
                }
              } else if (block.type === 'toolCall') {
                const tc = block as any;
                const toolName = tc.name || tc.toolName || 'unknown';
                const args = tc.args ? JSON.stringify(tc.args) : '';
                messages.push({ role: 'tool_call', content: args, timestamp: ts, toolName });
              }
            }
          } else if (typeof content === 'string' && content) {
            messages.push({ role: 'assistant', content, timestamp: ts });
          }
        } else if (msg.role === 'toolResult') {
          const resultMsg = msg as any;
          const toolName = resultMsg.toolName || 'unknown';
          let resultText = '';
          if (Array.isArray(resultMsg.content)) {
            resultText = resultMsg.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text || '')
              .join('\n');
          } else if (typeof resultMsg.content === 'string') {
            resultText = resultMsg.content;
          }
          messages.push({ role: 'tool_result', content: resultText, timestamp: ts, toolName });
        } else if (msg.role === 'bashExecution') {
          const bashMsg = msg as any;
          messages.push({
            role: 'tool_call',
            content: bashMsg.command || '',
            timestamp: ts,
            toolName: 'bash',
          });
          if (bashMsg.output) {
            messages.push({
              role: 'tool_result',
              content: bashMsg.output,
              timestamp: ts,
              toolName: 'bash',
            });
          }
        }
      }
    }

    return messages;
  }

  async listSessions(): Promise<FolderWithSessions[]> {
    const diskSessions = await SessionManager.listAll();
    const folderMap = new Map<string, FolderSessionInfo[]>();

    for (const s of diskSessions) {
      const rawCwd = s.cwd || '';
      const cwd = path.resolve(rawCwd);
      if (!folderMap.has(cwd)) {
        folderMap.set(cwd, []);
      }
      const active = this.sessions.get(s.path);
      folderMap.get(cwd)!.push({
        path: s.path,
        id: s.id,
        name: s.name,
        created: s.created.toISOString(),
        modified: s.modified.toISOString(),
        messageCount: s.messageCount,
        firstMessage: s.firstMessage,
        isActive: !!active,
        clientCount: active ? active.clients.size : 0,
      });
    }

    const folders: FolderWithSessions[] = [];
    for (const [cwdPath, sessions] of folderMap.entries()) {
      const name = cwdPath.split('/').pop() || cwdPath;
      folders.push({ path: cwdPath, name, sessions: sessions.sort((a, b) => b.modified.localeCompare(a.modified)) });
    }

    return folders.sort((a, b) => {
      const aActive = a.sessions.some(s => s.isActive);
      const bActive = b.sessions.some(s => s.isActive);
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return b.name.localeCompare(a.name);
    });
  }

  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(s => ({
      sessionId: s.sessionId,
      sessionFile: s.sessionFile,
      cwd: s.cwd,
      model: s.model,
      clientCount: s.clients.size,
      isIdle: s.isIdle,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    }));
  }

  async takeOver(cwd: string, targetSessionId: string): Promise<Set<string>> {
    const existing = this.findActiveSessionByCwd(cwd);
    const interruptedClientIds = new Set<string>();
    if (existing && existing.sessionId !== targetSessionId) {
      const interruptedClients = Array.from(existing.clients);
      for (const clientId of interruptedClients) {
        existing.clients.delete(clientId);
        interruptedClientIds.add(clientId);
      }
      this.scheduleIdleCheck(existing.sessionId);
    }
    return interruptedClientIds;
  }

  async sendUserMessage(sessionId: string, text: string, streamingBehavior?: 'steer' | 'followUp'): Promise<void> {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;
    tracked.lastActivity = Date.now();
    this.cancelIdleCheck(sessionId);
    await tracked.agentSession.sendUserMessage(text, { deliverAs: streamingBehavior });
  }

  async abortSession(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;
    await tracked.agentSession.abort();
  }

  async changeModel(sessionId: string, modelStr: string): Promise<{ error?: string }> {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return { error: 'Session not found' };

    const colonIdx = modelStr.indexOf(':');
    if (colonIdx === -1) return { error: `Invalid model format: ${modelStr}` };
    const provider = modelStr.slice(0, colonIdx);
    const id = modelStr.slice(colonIdx + 1);
    const model = this.modelRegistry.find(provider, id);
    if (!model) return { error: `Model not found: ${modelStr}` };

    try {
      await tracked.agentSession.setModel(model);
      tracked.model = modelStr;
      return {};
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  isStreaming(sessionId: string): boolean {
    const tracked = this.sessions.get(sessionId);
    return tracked ? tracked.agentSession.isStreaming : false;
  }

  scheduleIdleCheck(sessionId: string): void {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;
    this.cancelIdleCheck(sessionId);

    if (tracked.clients.size === 0 && tracked.isIdle) {
      tracked.idleTimer = setTimeout(() => {
        this.destroySession(sessionId, 'idle timeout');
      }, this.idleTimeoutMs);
    }
  }

  cancelIdleCheck(sessionId: string): void {
    const tracked = this.sessions.get(sessionId);
    if (!tracked || !tracked.idleTimer) return;
    clearTimeout(tracked.idleTimer);
    tracked.idleTimer = null;
  }

  destroySession(sessionId: string, reason: string): void {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;
    this.cancelIdleCheck(sessionId);
    tracked.eventUnsubscribe();
    tracked.agentSession.dispose();
    this.sessions.delete(sessionId);
  }

  async disposeAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const id of sessionIds) {
      this.destroySession(id, 'server shutdown');
    }
  }

  private setupEventListeners(sessionFile: string, agentSession: AgentSession): () => void {
    return agentSession.subscribe((event) => {
      const tracked = this.sessions.get(sessionFile);
      if (!tracked) return;

      if (this.onEvent) {
        this.onEvent(sessionFile, event);
      }

      switch (event.type) {
        case 'agent_start':
          tracked.isIdle = false;
          tracked.lastActivity = Date.now();
          this.cancelIdleCheck(sessionFile);
          break;

        case 'agent_end':
          tracked.isIdle = true;
          tracked.lastActivity = Date.now();
          this.scheduleIdleCheck(sessionFile);
          break;

        case 'message_update':
        case 'message_end':
        case 'tool_execution_start':
        case 'tool_execution_end':
          tracked.lastActivity = Date.now();
          break;
      }
    });
  }

  private extractMessageText(msg: any): string {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      }
    }

    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      }
    }

    return '';
  }
}

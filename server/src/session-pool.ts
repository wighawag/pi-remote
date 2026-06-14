import path from 'path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Normalize a path to prevent duplicate session folders.
 * - Removes trailing slashes (except for root "/")
 * - Resolves . and .. segments
 * - Ensures consistent encoding for same physical path
 */
export function normalizePath(p: string): string {
  // Resolve to absolute path first (handles . and ..)
  let normalized = path.resolve(p);
  
  // Remove trailing slash (except for root "/")
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  
  return normalized;
}

/** True only for a real Date with a finite (valid) time value. */
function isValidDate(d: Date | undefined | null): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime());
}

/**
 * Convert a Date to an ISO string, tolerating invalid/missing dates.
 * Belt-and-suspenders guard: a single malformed session timestamp must never
 * crash listSessions(), even if a bad record slips past the upstream filter.
 */
function safeToISOString(d: Date | undefined | null): string {
  return isValidDate(d) ? d.toISOString() : new Date(0).toISOString();
}

export interface RemoteRepoRule {
  pattern: string;
  provider: 'github' | 'codeberg' | 'gitea' | 'forgejo';
  visibility?: 'private' | 'public';
}

export interface WhereverConfig {
  gitInitDefault?: boolean;
  remoteRepoRules?: RemoteRepoRule[];
  commonFolders?: string[];
  speech?: {
    apiKey?: string;
    apiUrl?: string;
    model?: string;
  };
  uploads?: {
    type?: 'tmp' | 'session' | 'custom';
    dir?: string;
    subDir?: string;
    method?: 'post' | 'websocket';
  };
}

export function getWhereverConfig(): WhereverConfig {
  const configDir = path.join(os.homedir(), '.wherever');
  const configPath = path.join(configDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    try {
      fs.mkdirSync(configDir, { recursive: true });
      const defaultConfig: WhereverConfig = {
        gitInitDefault: false,
        remoteRepoRules: [],
        commonFolders: []
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      return defaultConfig;
    } catch (err) {
      console.error('Failed to create default wherever config:', err);
    }
  } else {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.error('Failed to parse wherever config file:', err);
    }
  }
  return {};
}

export function setupUpstreamTracking(resolvedCwd: string) {
  try {
    let defaultBranch = '';
    try {
      defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: resolvedCwd }).toString().trim();
    } catch (e) {
      try {
        defaultBranch = execSync('git config --get init.defaultBranch', { cwd: resolvedCwd }).toString().trim();
      } catch (e2) {}
    }
    if (!defaultBranch) {
      defaultBranch = 'main'; // fallback
    }

    execSync(`git config branch.${defaultBranch}.remote origin`, { cwd: resolvedCwd, stdio: 'ignore' });
    execSync(`git config branch.${defaultBranch}.merge refs/heads/${defaultBranch}`, { cwd: resolvedCwd, stdio: 'ignore' });
    console.log(`Successfully pre-configured branch '${defaultBranch}' upstream tracking to origin`);
  } catch (err) {
    console.error('Failed to pre-configure upstream tracking branch:', err);
  }
}

import { createAgentSession, AuthStorage, ModelRegistry, DefaultResourceLoader, SettingsManager, getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Model, Api } from '@earendil-works/pi-ai';
import type { SessionMessageEntry, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { SessionInfo, HistoryMessage, FolderWithSessions, ModelInfo, FolderSessionInfo } from './session-types.js';
import type { WebSocket } from 'ws';

export interface ServerTrackedSession {
  type: 'server';
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

export interface CliTrackedSession {
  type: 'cli';
  sessionId: string;
  sessionFile: string;
  cwd: string;
  model: string;
  clients: Set<string>;
  isIdle: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  createdAt: number;
  lastActivity: number;
  cliWs: WebSocket;
  isStreaming: boolean;
}

export type TrackedSession = ServerTrackedSession | CliTrackedSession;

export class SessionPool {
  private sessions = new Map<string, TrackedSession>();
  private pendingSessions = new Map<string, Promise<{ tracked: TrackedSession; error?: string }>>();
  private pendingCreateSessions = new Map<string, Promise<{ tracked: TrackedSession; error?: string; sessionFile?: string }>>();
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
    let resolvedFile = sessionFile;

    // Resolve short session ID/name (no path delimiters and doesn't end in .json or .jsonl) to full absolute path
    if (!sessionFile.includes('/') && !sessionFile.includes('\\') && !sessionFile.endsWith('.json') && !sessionFile.endsWith('.jsonl')) {
      // 1. Check if the session is already active in memory
      const active = Array.from(this.sessions.values()).find(s => s.sessionId === sessionFile);
      if (active) {
        resolvedFile = active.sessionFile;
      } else {
        // 2. Scan the disk to find the session with the matching ID/name
        const diskSessions = await SessionManager.listAll();
        const found = diskSessions.find(s => s.id === sessionFile || s.name === sessionFile);
        if (found) {
          resolvedFile = found.path;
        } else {
          return { tracked: null as any, error: `Session with ID "${sessionFile}" not found` };
        }
      }
    }

    // Continue with the resolved absolute path
    if (this.sessions.has(resolvedFile)) {
      return { tracked: this.sessions.get(resolvedFile)! };
    }

    if (this.pendingSessions.has(resolvedFile)) {
      return this.pendingSessions.get(resolvedFile)!;
    }

    const loadPromise = (async () => {
      try {
        const sessionManager = SessionManager.open(resolvedFile);
        const header = sessionManager.getHeader();

        if (!header) {
          return { tracked: null as any, error: 'Session file has no header' };
        }

        const sessionCwd = cwd || header.cwd || process.cwd();
        const normalizedCwd = normalizePath(sessionCwd);
        let model: Model<Api> | undefined;

        if (modelStr) {
          const parsed = this.parseModelStr(modelStr);
          if (parsed) {
            model = this.modelRegistry.find(parsed.provider, parsed.id);
          }
        }

        if (!model && header) {
          const entries = sessionManager.getEntries();
          const modelChange = [...entries].reverse().find((e: SessionEntry) => e.type === 'model_change');
          if (modelChange && 'provider' in modelChange && 'modelId' in modelChange) {
            model = this.modelRegistry.find(modelChange.provider, modelChange.modelId);
          }
        }

        const settingsManager = SettingsManager.create(normalizedCwd, this.agentDir);
        const resourceLoader = new DefaultResourceLoader({
          cwd: normalizedCwd,
          agentDir: this.agentDir,
          settingsManager,
        });
        await resourceLoader.reload();

        const { session: agentSession } = await createAgentSession({
          cwd: normalizedCwd,
          authStorage: this.authStorage,
          modelRegistry: this.modelRegistry,
          model,
          sessionManager,
          settingsManager,
          resourceLoader,
        });

        const modelLabel = agentSession.model ? `${agentSession.model.provider}:${agentSession.model.id}` : '';

        const tracked: TrackedSession = {
          type: 'server',
          sessionId: agentSession.sessionId,
          sessionFile: resolvedFile,
          cwd: normalizedCwd,
          model: modelLabel,
          agentSession,
          clients: new Set(),
          isIdle: true,
          idleTimer: null,
          eventUnsubscribe: this.setupEventListeners(resolvedFile, agentSession),
          createdAt: Date.now(),
          lastActivity: Date.now(),
        };

        this.sessions.set(resolvedFile, tracked);
        return { tracked };
      } catch (err) {
        return { tracked: null as any, error: (err as Error).message };
      } finally {
        this.pendingSessions.delete(resolvedFile);
      }
    })();

    this.pendingSessions.set(resolvedFile, loadPromise);
    return loadPromise;
  }

  async createNewSession(cwd: string, modelStr?: string, gitInit?: boolean, createRemote?: boolean, repoVisibility?: 'private' | 'public'): Promise<{ tracked: TrackedSession; error?: string; sessionFile?: string }> {
    let resolvedCwd = cwd;
    if (cwd.startsWith('~')) {
      resolvedCwd = path.join(os.homedir(), cwd.slice(1));
    } else if (!path.isAbsolute(cwd)) {
      resolvedCwd = path.join(os.homedir(), cwd);
    } else {
      resolvedCwd = path.resolve(cwd);
    }

    resolvedCwd = normalizePath(resolvedCwd);

    const existing = this.findActiveSessionByCwd(resolvedCwd);
    if (existing && existing.clients.size > 0) {
      return { tracked: existing };
    }

    if (this.pendingCreateSessions.has(resolvedCwd)) {
      return this.pendingCreateSessions.get(resolvedCwd)!;
    }

    const createPromise = (async () => {
      try {
        if (!fs.existsSync(resolvedCwd)) {
          fs.mkdirSync(resolvedCwd, { recursive: true });
        }

        // Git initialization if requested
        if (gitInit) {
          try {
            if (!fs.existsSync(path.join(resolvedCwd, '.git'))) {
              execSync('git init', { cwd: resolvedCwd, stdio: 'ignore' });
              console.log(`Initialized empty Git repository in ${resolvedCwd}`);
            }
          } catch (err) {
            console.error(`Failed to initialize git repository in ${resolvedCwd}:`, err);
          }
        }

        // Check if we should create a remote repo (GitHub/Codeberg etc) based on config patterns
        const config = getWhereverConfig();
        if (createRemote !== false && config.remoteRepoRules && Array.isArray(config.remoteRepoRules)) {
          const rule = config.remoteRepoRules.find(r => new RegExp(r.pattern).test(resolvedCwd));
          if (rule) {
            const provider = rule.provider;
            const visibility = repoVisibility || rule.visibility || 'private';
            const repoName = path.basename(resolvedCwd);

            // Initialize Git if matching rules and not yet a Git repo
            if (!fs.existsSync(path.join(resolvedCwd, '.git'))) {
              try {
                execSync('git init', { cwd: resolvedCwd, stdio: 'ignore' });
                console.log(`Initialized empty Git repository in ${resolvedCwd} (due to matching remote rule)`);
              } catch (e) {
                console.error(`Failed to initialize git repository in ${resolvedCwd} for remote rule:`, e);
              }
            }

            // Check if remote already exists
            let hasOrigin = false;
            try {
              const remotes = execSync('git remote', { cwd: resolvedCwd }).toString();
              hasOrigin = remotes.split('\n').map(r => r.trim()).includes('origin');
            } catch (e) {}

            if (!hasOrigin) {
              if (provider === 'github') {
                try {
                  console.log(`Creating GitHub repository: ${repoName} (${visibility})...`);
                  execSync(`gh repo create "${repoName}" --${visibility} --source=. --remote=origin`, { cwd: resolvedCwd, stdio: 'ignore' });
                  console.log(`Successfully created GitHub repo ${repoName} and added remote 'origin'`);
                  setupUpstreamTracking(resolvedCwd);
                } catch (err) {
                  console.error('Failed to create GitHub repository:', err);
                }
              } else if (provider === 'codeberg' || provider === 'gitea' || provider === 'forgejo') {
                try {
                  let created = false;
                  let repoUrl = '';
                  console.log(`Creating Codeberg/Gitea repository: ${repoName}...`);

                  try {
                    // Try tea CLI
                    const output = execSync(`tea repo create --name "${repoName}" ${visibility === 'private' ? '--private' : ''}`, { cwd: resolvedCwd }).toString();
                    created = true;
                    const urlMatch = output.match(/https?:\/\/\S+/i) || output.match(/git@\S+/i);
                    if (urlMatch) repoUrl = urlMatch[0];
                  } catch (err) {
                    try {
                      // Try cb CLI
                      const output = execSync(`cb repo create --name "${repoName}" ${visibility === 'private' ? '--private' : ''}`, { cwd: resolvedCwd }).toString();
                      created = true;
                      const urlMatch = output.match(/https?:\/\/\S+/i) || output.match(/git@\S+/i);
                      if (urlMatch) repoUrl = urlMatch[0];
                    } catch (err2) {
                      console.error('Failed to create repository with tea or cb CLI:', err, err2);
                    }
                  }

                  if (created) {
                    if (!repoUrl) {
                      // fallback to constructing the URL
                      const domain = provider === 'codeberg' ? 'codeberg.org' : 'gitea.com';
                      let user = '';
                      try {
                        user = execSync('tea whoami').toString().trim().split(/\s+/).pop() || '';
                      } catch (e) {
                        try {
                          const cbWho = execSync('cb auth whoami').toString().trim();
                          user = cbWho.split(/\s+/).pop() || '';
                        } catch (e2) {}
                      }
                      if (!user) {
                        user = 'username_placeholder';
                      }
                      repoUrl = `git@${domain}:${user}/${repoName}.git`;
                    }
                    execSync(`git remote add origin "${repoUrl}"`, { cwd: resolvedCwd, stdio: 'ignore' });
                    console.log(`Successfully created Codeberg/Gitea repo and added remote origin: ${repoUrl}`);
                    setupUpstreamTracking(resolvedCwd);
                  }
                } catch (err) {
                  console.error('Failed to configure remote repository:', err);
                }
              }
            }
          }
        }

        const sessionManager = SessionManager.create(resolvedCwd);
        let model: Model<Api> | undefined;

        if (modelStr) {
          const parsed = this.parseModelStr(modelStr);
          if (parsed) {
            model = this.modelRegistry.find(parsed.provider, parsed.id);
          }
        }

        const settingsManager = SettingsManager.create(resolvedCwd, this.agentDir);
        const resourceLoader = new DefaultResourceLoader({
          cwd: resolvedCwd,
          agentDir: this.agentDir,
          settingsManager,
        });
        await resourceLoader.reload();

        const { session: agentSession } = await createAgentSession({
          cwd: resolvedCwd,
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
          type: 'server',
          sessionId: agentSession.sessionId,
          sessionFile,
          cwd: resolvedCwd,
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
      } finally {
        this.pendingCreateSessions.delete(resolvedCwd);
      }
    })();

    this.pendingCreateSessions.set(resolvedCwd, createPromise);
    return createPromise;
  }

  addClient(sessionFileOrId: string, clientId: string): TrackedSession | null {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return null;
    tracked.clients.add(clientId);
    tracked.lastActivity = Date.now();
    this.cancelIdleCheck(tracked.sessionFile);
    return tracked;
  }

  removeClient(sessionFileOrId: string, clientId: string): void {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return;
    tracked.clients.delete(clientId);
    this.scheduleIdleCheck(tracked.sessionFile);
  }

  getSession(sessionFileOrId: string): TrackedSession | null {
    if (this.sessions.has(sessionFileOrId)) {
      return this.sessions.get(sessionFileOrId)!;
    }
    for (const s of this.sessions.values()) {
      if (s.sessionId === sessionFileOrId) return s;
    }
    return null;
  }

  findActiveSessionByCwd(cwd: string): TrackedSession | null {
    const normalizedCwd = normalizePath(cwd);
    for (const s of this.sessions.values()) {
      if (s.cwd === normalizedCwd) return s;
    }
    return null;
  }

  detectConflict(sessionFileOrId: string, targetCwd: string): { conflict: boolean; otherSessionId?: string; otherCwd?: string } {
    if (this.getSession(sessionFileOrId)) {
      return { conflict: false };
    }

    const normalizedTargetCwd = normalizePath(targetCwd);
    for (const s of this.sessions.values()) {
      if (s.cwd === normalizedTargetCwd && s.clients.size > 0) {
        return { conflict: true, otherSessionId: s.sessionId, otherCwd: s.cwd };
      }
    }
    return { conflict: false };
  }

  getSessionHistory(sessionFileOrId: string): HistoryMessage[] {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return [];

    const sessionManager = SessionManager.open(tracked.sessionFile);
    const entries = sessionManager.getEntries();
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
                const rawArgs = tc.arguments || tc.args;
                const args = rawArgs ? JSON.stringify(rawArgs) : '';
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
          messages.push({ role: 'tool_result', content: resultText, timestamp: ts, toolName, isError: !!resultMsg.isError });
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
              isError: bashMsg.exitCode !== undefined && bashMsg.exitCode !== 0,
            });
          }
        }
      }
    }

    return messages;
  }

  /**
   * Tail-first windowed history. Returns the last `limit` messages (the most
   * recent), along with the total count and the offset of the first returned
   * message, so the client can lazily request older history.
   *
   * `beforeOffset`, when provided, returns the window of `limit` messages
   * ending just before that offset (used for "load older" requests).
   */
  getSessionHistoryWindow(
    sessionFileOrId: string,
    limit: number,
    beforeOffset?: number,
  ): { messages: HistoryMessage[]; totalCount: number; offset: number } {
    const all = this.getSessionHistory(sessionFileOrId);
    const totalCount = all.length;

    if (limit <= 0 || totalCount === 0) {
      const end = beforeOffset ?? totalCount;
      return { messages: [], totalCount, offset: Math.max(0, Math.min(end, totalCount)) };
    }

    const end =
      beforeOffset === undefined
        ? totalCount
        : Math.max(0, Math.min(beforeOffset, totalCount));
    const start = Math.max(0, end - limit);
    return {
      messages: all.slice(start, end),
      totalCount,
      offset: start,
    };
  }

  async listSessions(): Promise<FolderWithSessions[]> {
    const diskSessions = await SessionManager.listAll();
    const folderMap = new Map<string, FolderSessionInfo[]>();

    for (const s of diskSessions) {
      // Skip incomplete/stub session files: a valid-looking `session` header
      // can still be missing its `timestamp` (e.g. test stubs written as
      // {"type":"session","id":"abc","cwd":"."}). Upstream tolerates a
      // missing timestamp for `modified` (falls back to file mtime) but not
      // for `created`, leaving it as an Invalid Date. Such a session has no
      // meaningful creation time, so we drop it from the list rather than
      // surfacing a bogus 1970 entry.
      if (!isValidDate(s.created)) {
        continue;
      }

      const rawCwd = s.cwd || '';
      let cwd = rawCwd;
      if (rawCwd.startsWith('~')) {
        cwd = path.join(os.homedir(), rawCwd.slice(1));
      } else if (!path.isAbsolute(rawCwd)) {
        cwd = path.join(os.homedir(), rawCwd);
      }
      cwd = normalizePath(cwd);

      if (!folderMap.has(cwd)) {
        folderMap.set(cwd, []);
      }
      const active = this.sessions.get(s.path);
      folderMap.get(cwd)!.push({
        path: s.path,
        id: s.id,
        name: s.name,
        created: safeToISOString(s.created),
        modified: safeToISOString(s.modified),
        messageCount: s.messageCount,
        firstMessage: s.firstMessage,
        isActive: !!active,
        clientCount: active ? active.clients.size : 0,
      });
    }

    const folders: FolderWithSessions[] = [];
    for (const [cwdPath, sessions] of folderMap.entries()) {
      const name = path.basename(cwdPath) || cwdPath;
      folders.push({ path: cwdPath, name, sessions: sessions.sort((a, b) => b.modified.localeCompare(a.modified)) });
    }

    return folders.sort((a, b) => {
      const aTime = a.sessions[0]?.modified || '';
      const bTime = b.sessions[0]?.modified || '';
      return bTime.localeCompare(aTime);
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
      try {
        if (existing.type === 'server') {
          await existing.agentSession.abort();
        } else if (existing.type === 'cli') {
          existing.cliWs.send(JSON.stringify({ type: 'cli_abort' }));
        }
      } catch (err) {
        console.error(`Failed to abort session ${existing.sessionId} during takeover:`, err);
      }
      const interruptedClients = Array.from(existing.clients);
      for (const clientId of interruptedClients) {
        existing.clients.delete(clientId);
        interruptedClientIds.add(clientId);
      }
      this.scheduleIdleCheck(existing.sessionFile);
    }
    return interruptedClientIds;
  }

  async sendUserMessage(sessionFileOrId: string, text: string, streamingBehavior?: 'steer' | 'followUp'): Promise<void> {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return;
    tracked.lastActivity = Date.now();
    this.cancelIdleCheck(tracked.sessionFile);

    const isBash = text.trimStart().startsWith('!');
    if (isBash) {
      const isExcluded = text.trimStart().startsWith('!!');
      const command = isExcluded ? text.trimStart().slice(2).trim() : text.trimStart().slice(1).trim();

      if (command) {
        if (tracked.type === 'server') {
          if (this.onEvent) {
            this.onEvent(tracked.sessionFile, {
              type: 'tool_execution_start',
              toolName: 'bash',
              args: { command },
            } as any);
          }

          try {
            const result = await tracked.agentSession.executeBash(command, (chunk) => {
              if (this.onEvent) {
                this.onEvent(tracked.sessionFile, {
                  type: 'tool_execution_update',
                  toolName: 'bash',
                  delta: chunk,
                } as any);
              }
            }, { excludeFromContext: isExcluded });

            if (this.onEvent) {
              this.onEvent(tracked.sessionFile, {
                type: 'tool_execution_end',
                toolName: 'bash',
                result: result.output,
                isError: result.exitCode !== 0,
              } as any);
            }
          } catch (err) {
            if (this.onEvent) {
              this.onEvent(tracked.sessionFile, {
                type: 'tool_execution_end',
                toolName: 'bash',
                result: (err as Error).message,
                isError: true,
              } as any);
            }
          }
        } else if (tracked.type === 'cli') {
          tracked.cliWs.send(JSON.stringify({
            type: 'cli_bash',
            command,
            excludeFromContext: isExcluded,
          }));
        }
      }
      return;
    }

    if (tracked.type === 'server') {
      await tracked.agentSession.sendUserMessage(text, { deliverAs: streamingBehavior });
    } else if (tracked.type === 'cli') {
      tracked.cliWs.send(JSON.stringify({
        type: 'cli_message',
        message: text,
        streamingBehavior,
      }));
    }
  }

  async abortSession(sessionFileOrId: string): Promise<void> {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return;
    if (tracked.type === 'server') {
      await tracked.agentSession.abort();
    } else if (tracked.type === 'cli') {
      tracked.cliWs.send(JSON.stringify({ type: 'cli_abort' }));
    }
  }

  async changeModel(sessionFileOrId: string, modelStr: string): Promise<{ error?: string }> {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return { error: 'Session not found' };

    if (tracked.type === 'server') {
      const parsed = this.parseModelStr(modelStr);
      if (!parsed) return { error: `Invalid model format: ${modelStr}` };
      const model = this.modelRegistry.find(parsed.provider, parsed.id);
      if (!model) return { error: `Model not found: ${modelStr}` };

      try {
        await tracked.agentSession.setModel(model);
        tracked.model = modelStr;
        return {};
      } catch (err) {
        return { error: (err as Error).message };
      }
    } else {
      tracked.cliWs.send(JSON.stringify({ type: 'cli_model_change', model: modelStr }));
      tracked.model = modelStr;
      return {};
    }
  }

  isStreaming(sessionFileOrId: string): boolean {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return false;
    return tracked.type === 'server' ? tracked.agentSession.isStreaming : tracked.isStreaming;
  }

  scheduleIdleCheck(sessionFileOrId: string): void {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return;
    this.cancelIdleCheck(tracked.sessionFile);

    if (tracked.clients.size === 0 && tracked.isIdle) {
      tracked.idleTimer = setTimeout(() => {
        this.destroySession(tracked.sessionFile, 'idle timeout');
      }, this.idleTimeoutMs);
    }
  }

  cancelIdleCheck(sessionFileOrId: string): void {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked || !tracked.idleTimer) return;
    clearTimeout(tracked.idleTimer);
    tracked.idleTimer = null;
  }

  destroySession(sessionFileOrId: string, reason: string): void {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return;
    this.cancelIdleCheck(tracked.sessionFile);
    if (tracked.type === 'server') {
      tracked.eventUnsubscribe();
      tracked.agentSession.dispose();
    } else {
      try {
        tracked.cliWs.close();
      } catch (err) {}
    }
    this.sessions.delete(tracked.sessionFile);
  }

  async registerCliSession(sessionFile: string, cwd: string, modelStr: string, cliWs: WebSocket): Promise<{ tracked: TrackedSession; error?: string }> {
    const existing = this.sessions.get(sessionFile);
    let clients = new Set<string>();
    if (existing) {
      clients = existing.clients;
      this.cancelIdleCheck(sessionFile);
      if (existing.type === 'server') {
        try {
          existing.eventUnsubscribe();
          existing.agentSession.dispose();
        } catch (err) {}
      }
    }

    let sessionId = existing?.sessionId;
    if (!sessionId) {
      try {
        const sessionManager = SessionManager.open(sessionFile);
        sessionId = sessionManager.getSessionId();
      } catch (err) {
        // Fallback 1: Extract from filename (e.g. some_path/TIMESTAMP_UUID.jsonl)
        const baseName = path.basename(sessionFile);
        const match = baseName.match(/_(.+)\.jsonl$/);
        if (match) {
          sessionId = match[1];
        } else {
          return { tracked: null as any, error: `Could not determine a persistent session ID from file path: ${sessionFile}` };
        }
      }
    }

    const normalizedCwd = normalizePath(cwd);

    const tracked: CliTrackedSession = {
      type: 'cli',
      sessionId,
      sessionFile,
      cwd: normalizedCwd,
      model: modelStr || '',
      clients,
      isIdle: true,
      idleTimer: null,
      createdAt: existing?.createdAt || Date.now(),
      lastActivity: Date.now(),
      cliWs,
      isStreaming: false,
    };

    this.sessions.set(sessionFile, tracked);
    return { tracked };
  }

  async unregisterCliSession(sessionFile: string): Promise<void> {
    const tracked = this.sessions.get(sessionFile);
    if (!tracked || tracked.type !== 'cli') return;

    this.cancelIdleCheck(sessionFile);
    this.sessions.delete(sessionFile);

    if (tracked.clients.size > 0) {
      console.log(`CLI Bridge disconnected for ${sessionFile}. Restarting server-side agent session...`);
      const result = await this.loadSession(sessionFile, tracked.cwd, tracked.model);
      if (!result.error && result.tracked) {
        result.tracked.clients = tracked.clients;
        if (this.onEvent) {
          if (tracked.isStreaming) {
            this.onEvent(sessionFile, {
              type: 'session_error' as any,
              error: 'CLI terminal disconnected. Active execution was aborted.'
            } as any);
          }
          this.onEvent(sessionFile, { type: 'agent_end' } as any);
        }
      }
    }
  }

  handleCliEvent(sessionFile: string, event: AgentSessionEvent): void {
    const tracked = this.sessions.get(sessionFile);
    if (!tracked || tracked.type !== 'cli') return;

    tracked.lastActivity = Date.now();

    if (event.type === 'agent_start') {
      tracked.isIdle = false;
      tracked.isStreaming = true;
      this.cancelIdleCheck(sessionFile);
    } else if (event.type === 'agent_end') {
      tracked.isIdle = true;
      tracked.isStreaming = false;
      this.scheduleIdleCheck(sessionFile);
    } else if (event.type === 'model_select' as any) {
      const modelStr = (event as any).model;
      if (modelStr) {
        tracked.model = modelStr;
      }
    }

    if (this.onEvent) {
      this.onEvent(sessionFile, event);
    }
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

        case 'model_select' as any: {
          const evt = event as any;
          const modelStr = evt.model ? `${evt.model.provider}:${evt.model.id}` : '';
          if (modelStr) {
            tracked.model = modelStr;
          }
          break;
        }
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

  private parseModelStr(modelStr: string): { provider: string; id: string } | null {
    const colonIdx = modelStr.indexOf(':');
    if (colonIdx === -1) return null;
    return {
      provider: modelStr.slice(0, colonIdx),
      id: modelStr.slice(colonIdx + 1),
    };
  }
}

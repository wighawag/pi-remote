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

/**
 * Canonicalize a session .jsonl path so it can be used as a stable map key.
 *
 * The pool keys its in-memory `sessions` map by the session FILE PATH. That key
 * is produced by two independent producers that must agree on the exact string:
 *   1. the server itself (createNewSession/loadSession, via pi's SessionManager), and
 *   2. the CLI bridge extension, which reports `ctx.sessionManager.getSessionFile()`
 *      from whatever pi version the user's `pi` binary runs.
 *
 * pi >=0.80 canonicalizes the cwd before encoding the session directory name
 * (resolvePath: strips trailing slash, resolves `.`/`..`), whereas <0.80 encoded
 * the raw cwd. If the server SDK and the CLI are on different sides of that
 * change, the same logical session yields two different path strings, the map
 * keys don't collide, and the browser + CLI end up as two parallel sessions.
 *
 * Running everything through path.resolve() here makes both producers converge
 * on one key regardless of trailing slashes, `.`/`..` segments, or a future
 * version skew, without depending on symlink resolution (which could diverge if
 * only one side follows links). This is belt-and-suspenders on top of aligning
 * the SDK version.
 */
export function normalizeSessionFile(sessionFile: string): string {
  if (!sessionFile) return sessionFile;
  return path.resolve(sessionFile);
}

/** True only for a real Date with a finite (valid) time value. */
function isValidDate(d: Date | undefined | null): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime());
}

/**
 * Max length of the first-message PREVIEW shipped in the /sessions list. The
 * sidebar only renders a ~40-char snippet and filters on the text, so the full
 * (often huge: pasted prompts, PRDs, specs) first message must never cross the
 * wire for every session. This caps each entry, which is the dominant factor in
 * the /sessions payload size.
 */
const FIRST_MESSAGE_PREVIEW_MAX = 160;

/**
 * Collapse whitespace and cap to a short preview. Keeps the /sessions payload
 * tens-of-KB instead of multi-MB while preserving what the sidebar displays and
 * filters on.
 */
function previewText(text: string | undefined | null): string {
  const collapsed = (text || '').replace(/\s+/g, ' ').trim();
  return collapsed.length > FIRST_MESSAGE_PREVIEW_MAX
    ? collapsed.slice(0, FIRST_MESSAGE_PREVIEW_MAX) + '\u2026'
    : collapsed;
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
  /** Folder used by "search mode" sessions. No default; must be set explicitly. */
  searchFolder?: string;
  /** When true, the on-demand search folder gets a remote, forced to private visibility. Default false. */
  searchCreateRemote?: boolean;
  /** Session listing controls. */
  sessions?: {
    /**
     * Glob patterns matched against a session's resolved cwd. Any session whose
     * cwd matches is fully excluded from the listing AND its folder is skipped
     * BEFORE its file bodies are read, so a large pile of throwaway sessions
     * (e.g. "/tmp/**") no longer slows down /sessions. Tilde (~) is expanded.
     * Empty/omitted = nothing ignored (no behaviour change).
     */
    ignore?: string[];
    /**
     * Glob patterns (same syntax as `ignore`) matched against a session's
     * resolved cwd. Matching sessions are HIDDEN from the default list (and,
     * like ignore, their folders are skipped before their bodies are read on
     * the default view), but remain viewable on a separate read-only page
     * (`/sessions?view=readonly`). Opening one is forced read-only: the server
     * refuses writes and the UI hides the composer. Intended for autonomous
     * fleets (e.g. agent-runner) you want to observe but not drive.
     */
    readOnly?: string[];
  };
}

/**
 * Convert a single glob pattern into a RegExp matched against a normalized,
 * absolute filesystem path. Supports `*` (does not cross a path separator),
 * `**` (crosses separators), and `?`. Tilde (`~`) is expanded to the home dir.
 * No new dependency: this is a deliberately small, path-oriented matcher.
 */
function globToRegExp(glob: string): RegExp {
  let g = glob.trim();
  if (g.startsWith('~')) {
    g = path.join(os.homedir(), g.slice(1));
  }
  // Normalize separators and collapse a trailing slash so "/tmp/" == "/tmp".
  g = g.replace(/\\/g, '/');
  if (g.length > 1 && g.endsWith('/')) g = g.slice(0, -1);

  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**` -> any chars including separators (optionally followed by a `/`).
        i++;
        if (g[i + 1] === '/') i++;
        re += '.*';
      } else {
        // `*` -> any chars except a path separator.
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

/**
 * Build a predicate that returns true when a resolved cwd should be IGNORED.
 * A cwd matches if it equals, or is nested under, any ignore glob. Patterns are
 * compiled once; an empty list yields a predicate that never matches.
 */
export function makeIgnoreMatcher(patterns: string[] | undefined): (cwd: string) => boolean {
  const globs = (patterns || []).filter((p) => typeof p === 'string' && p.trim().length > 0);
  if (globs.length === 0) return () => false;
  const regexps: RegExp[] = [];
  for (const g of globs) {
    try {
      // A pattern should ignore both the directory itself AND everything nested
      // under it, regardless of how it was written:
      //   "/tmp"      -> match "/tmp" and "/tmp/anything"
      //   "/tmp/**"   -> match "/tmp" and "/tmp/anything"
      //   "/tmp/*"    -> match "/tmp" and "/tmp/anything"
      // So we strip a trailing /* or /** to get the base, then add both the base
      // and a "/**" nested variant.
      const base = g.replace(/\/+\*{1,2}$/, '').replace(/\/+$/, '') || g;
      regexps.push(globToRegExp(base));
      regexps.push(globToRegExp(base + '/**'));
      // Also honour the pattern exactly as written (e.g. a mid-path glob).
      regexps.push(globToRegExp(g));
    } catch (err) {
      console.error(`Invalid sessions.ignore glob ${JSON.stringify(g)}:`, err);
    }
  }
  return (cwd: string) => {
    const norm = normalizePath(cwd).replace(/\\/g, '/');
    return regexps.some((re) => re.test(norm));
  };
}

/**
 * Read only the header (first line) of a session .jsonl to recover its
 * authoritative cwd, WITHOUT parsing the whole file. Returns '' if the header
 * is missing/unreadable. This is the cheap pre-filter that lets us skip an
 * ignored folder before reading its (potentially many, large) file bodies.
 */
function readSessionCwdFromHeader(filePath: string): string {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(8192);
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
      const text = buf.toString('utf8', 0, bytes);
      const nl = text.indexOf('\n');
      const firstLine = nl === -1 ? text : text.slice(0, nl);
      const header = JSON.parse(firstLine);
      return typeof header?.cwd === 'string' ? header.cwd : '';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

/**
 * Resolve a session's raw header cwd into a normalized absolute path, matching
 * how listSessions() buckets folders (tilde-expand; relative -> under home).
 */
function resolveSessionCwd(rawCwd: string): string {
  const raw = rawCwd || '';
  let cwd = raw;
  if (raw.startsWith('~')) {
    cwd = path.join(os.homedir(), raw.slice(1));
  } else if (!path.isAbsolute(raw)) {
    cwd = path.join(os.homedir(), raw);
  }
  return normalizePath(cwd);
}

export interface DiskSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
}

/**
 * Parse one session .jsonl into the subset of fields the listing needs. This is
 * the directory-aware path's equivalent of pi's internal buildSessionInfo
 * (which is not exported), used ONLY for folders that survived the ignore
 * pre-filter. Returns null for a non-session / empty / unreadable file.
 */
function buildDiskSessionInfo(filePath: string): DiskSessionInfo | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    const entries: any[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch { /* skip malformed line */ }
    }
    if (entries.length === 0) return null;
    const header = entries[0];
    if (header?.type !== 'session') return null;

    const stats = fs.statSync(filePath);
    let messageCount = 0;
    let firstMessage = '';
    let name: string | undefined;
    let lastMessageTime = 0;
    for (const entry of entries) {
      if (entry?.type === 'session_info') {
        name = (entry.name && String(entry.name).trim()) || undefined;
      }
      if (entry?.type !== 'message') continue;
      messageCount++;
      const message = entry.message;
      const role = message?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      let textContent = '';
      const c = message?.content;
      if (typeof c === 'string') {
        textContent = c;
      } else if (Array.isArray(c)) {
        textContent = c.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
      }
      if (!textContent) continue;
      if (!firstMessage && role === 'user') firstMessage = textContent;
      const t = typeof entry.timestamp === 'string' ? new Date(entry.timestamp).getTime() : NaN;
      if (Number.isFinite(t)) lastMessageTime = Math.max(lastMessageTime, t);
    }

    const headerTime = typeof header.timestamp === 'string' ? new Date(header.timestamp).getTime() : NaN;
    const created = Number.isFinite(headerTime) ? new Date(headerTime) : new Date(NaN);
    const modified = lastMessageTime > 0 ? new Date(lastMessageTime) : stats.mtime;
    return {
      path: filePath,
      id: typeof header.id === 'string' ? header.id : '',
      cwd: typeof header.cwd === 'string' ? header.cwd : '',
      name,
      created,
      modified,
      messageCount,
      firstMessage: firstMessage || '(no messages)',
    };
  } catch {
    return null;
  }
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

const SEARCH_WORKSPACE_AGENTS_MD = `# Search workspace

This folder is a **search workspace**, not a coding project. Sessions started
here (from the wherever search bar, or via \`pisearch\`) exist to answer questions
with current information from the live web.

## How to behave here

- Use the **web-search skill**: lead with \`web_search\`, open the most promising
  1-3 results with \`web_fetch\` to verify, then answer.
- Answer the question **directly and concisely**, then list the **source URLs**
  you actually used. Prefer recent, authoritative sources; weight recency for
  time-sensitive questions.
- **Do not start a coding task** or edit files unless explicitly asked. There is
  no project to build here.
- If the web tools cannot reach Ollama (connection refused / 401), say so and
  tell the user to start Ollama or run \`ollama signin\`. Do not silently answer
  from memory without flagging it.
`;

/**
 * If resolvedCwd is the configured search folder, drop a default AGENTS.md into
 * it when none exists. Resolves the config's searchFolder (tilde-expanded) and
 * compares it to resolvedCwd via normalizePath. Best-effort: never throws, never
 * overwrites an existing AGENTS.md.
 */
export function maybeSeedSearchWorkspace(resolvedCwd: string): void {
  try {
    const config = getWhereverConfig();
    let searchFolder = config.searchFolder;
    if (!searchFolder) return;
    if (searchFolder.startsWith('~')) {
      searchFolder = path.join(os.homedir(), searchFolder.slice(1));
    }
    if (normalizePath(searchFolder) !== normalizePath(resolvedCwd)) return;
    const agentsPath = path.join(resolvedCwd, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) return;
    fs.writeFileSync(agentsPath, SEARCH_WORKSPACE_AGENTS_MD, 'utf8');
    console.log(`Seeded search workspace AGENTS.md in ${resolvedCwd}`);
  } catch (err) {
    console.error('Failed to seed search workspace AGENTS.md:', err);
  }
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
import type { SessionInfo, HistoryMessage, FolderWithSessions, ModelInfo, FolderSessionInfo, ContextUsageInfo } from './session-types.js';
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
  // Number of tool executions currently IN FLIGHT (tool_execution_start seen,
  // matching tool_execution_end not yet). > 0 means a tool call is running right
  // now. Used to decide, on a CLI takeover, whether an actual tool call was
  // interrupted (which leaves a dangling toolCall in the transcript), as opposed
  // to merely streaming assistant text (a normal, resumable state). Mirrors the
  // CLI's findDanglingToolCalls warning trigger.
  inFlightToolCount: number;
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
  // Latest context-usage snapshot reported by the CLI bridge (the server does
  // not run the agent for CLI sessions, so it cannot compute this itself).
  contextUsage?: ContextUsageInfo | null;
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

  /**
   * List available models. `isDefault` is resolved against `cwd` (falling back to
   * the server's process cwd), so a folder-local harness/pi config default is
   * honored, not just the server global default.
   */
  getAvailableModels(cwd?: string): ModelInfo[] {
    const available = this.modelRegistry.getAvailable();
    const settings = SettingsManager.create(cwd || process.cwd(), this.agentDir);
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

  /**
   * Resolve the default model (as "provider:modelId") for a given folder, using
   * that folder's resolved settings (folder-local harness/pi config wins over the
   * server global). Returns null when no default is configured or the resolved
   * model is not among the available models.
   */
  getDefaultModelFor(cwd: string): string | null {
    const settings = SettingsManager.create(cwd, this.agentDir);
    const defaultProvider = settings.getDefaultProvider();
    const defaultModel = settings.getDefaultModel();
    if (!defaultProvider || !defaultModel) return null;
    const found = this.modelRegistry
      .getAvailable()
      .some((m: Model<Api>) => m.provider === defaultProvider && m.id === defaultModel);
    return found ? `${defaultProvider}:${defaultModel}` : null;
  }

  findModel(provider: string, modelId: string): Model<Api> | undefined {
    return this.modelRegistry.find(provider, modelId);
  }

  /**
   * Resolve a session identifier (short ID/name OR an absolute .jsonl path) to a
   * canonical absolute session file path, without building an agent.
   */
  private async resolveSessionFile(sessionFile: string): Promise<{ resolvedFile?: string; error?: string }> {
    let resolvedFile = sessionFile;
    if (!sessionFile.includes('/') && !sessionFile.includes('\\') && !sessionFile.endsWith('.json') && !sessionFile.endsWith('.jsonl')) {
      const active = Array.from(this.sessions.values()).find(s => s.sessionId === sessionFile);
      if (active) {
        resolvedFile = active.sessionFile;
      } else {
        const diskSessions = await SessionManager.listAll();
        const found = diskSessions.find(s => s.id === sessionFile || s.name === sessionFile);
        if (found) {
          resolvedFile = found.path;
        } else {
          return { error: `Session with ID "${sessionFile}" not found` };
        }
      }
    }
    return { resolvedFile: normalizeSessionFile(resolvedFile) };
  }

  /**
   * CHEAP read of a session's metadata + history WITHOUT building a live agent.
   * Opening a session for VIEWING only needs the header (id/cwd/model) and the
   * transcript (a file read); instantiating the agent (createAgentSession ->
   * extension/MCP load) is seconds and only needed to SEND. Splitting the two
   * lets the UI paint the conversation immediately and build the agent lazily
   * (see docs/plan-speed-up-long-session-load.md). Reads from a resident session
   * when present so a warm session stays a warm read.
   */
  async readSessionMeta(
    sessionFile: string,
    limit: number,
    modelStr?: string,
  ): Promise<
    | {
        sessionFile: string;
        sessionId: string;
        cwd: string;
        model: string;
        history: { messages: HistoryMessage[]; totalCount: number; offset: number };
        readOnly: boolean;
        resident: boolean;
      }
    | { error: string }
  > {
    const resolved = await this.resolveSessionFile(sessionFile);
    if (resolved.error || !resolved.resolvedFile) {
      return { error: resolved.error ?? 'Could not resolve session' };
    }
    const resolvedFile = resolved.resolvedFile;

    const residentTracked = this.sessions.get(resolvedFile);
    if (residentTracked) {
      return {
        sessionFile: resolvedFile,
        sessionId: residentTracked.sessionId,
        cwd: residentTracked.cwd,
        model: residentTracked.model,
        history: this.getSessionHistoryWindow(resolvedFile, limit),
        readOnly: this.isReadOnlyCwd(residentTracked.cwd),
        resident: true,
      };
    }

    try {
      const sessionManager = SessionManager.open(resolvedFile);
      const header = sessionManager.getHeader();
      if (!header) {
        return { error: 'Session file has no header' };
      }
      const sessionId = sessionManager.getSessionId();
      const cwd = normalizePath(header.cwd || process.cwd());

      let model = '';
      if (modelStr) {
        model = modelStr;
      } else {
        const entries = sessionManager.getEntries();
        const modelChange = [...entries].reverse().find((e: SessionEntry) => e.type === 'model_change');
        if (modelChange && 'provider' in modelChange && 'modelId' in modelChange) {
          model = `${(modelChange as any).provider}:${(modelChange as any).modelId}`;
        }
      }

      const all = this.mapEntriesToHistory(sessionManager.getEntries(), sessionId);
      const history = this.windowHistory(all, limit);
      return { sessionFile: resolvedFile, sessionId, cwd, model, history, readOnly: this.isReadOnlyCwd(cwd), resident: false };
    } catch (err) {
      return { error: (err as Error).message };
    }
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

    // Canonicalize the resolved path so the map key matches the one the CLI
    // bridge reports for the same session (see normalizeSessionFile).
    resolvedFile = normalizeSessionFile(resolvedFile);

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
          inFlightToolCount: 0,
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

        // If this is the configured search folder, seed a default AGENTS.md so
        // search sessions behave correctly even in the browser path (where the
        // web-search skill is only discoverable, not preloaded). Self-healing:
        // re-created if the folder was deleted. Never clobbers an existing file.
        maybeSeedSearchWorkspace(resolvedCwd);

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

        const sessionFile = normalizeSessionFile(agentSession.sessionFile || '');
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
          inFlightToolCount: 0,
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
    // The caller may pass a session FILE PATH that differs only cosmetically
    // from the stored key (trailing slash, ./.. segments, or a version-skewed
    // encoding). Canonicalize and retry before falling back to an id scan, so a
    // CLI-reported path still resolves to the server-tracked session.
    const canonical = normalizeSessionFile(sessionFileOrId);
    if (canonical !== sessionFileOrId && this.sessions.has(canonical)) {
      return this.sessions.get(canonical)!;
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
    return this.mapEntriesToHistory(sessionManager.getEntries());
  }

  /**
   * Map raw pi session entries to the UI-facing HistoryMessage[]. Shared by the
   * resident path (getSessionHistory) and the cheap cold-read path
   * (readSessionMeta), so both produce identical history regardless of whether a
   * live agent exists. The `sessionId` parameter is accepted for parity/future
   * use; message shape does not depend on it today.
   */
  private mapEntriesToHistory(entries: SessionEntry[], _sessionId?: string): HistoryMessage[] {
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
                const toolCallId = typeof tc.id === 'string' ? tc.id : undefined;
                messages.push({ role: 'tool_call', content: args, timestamp: ts, toolName, ...(toolCallId ? { toolCallId } : {}) });
              }
            }
          } else if (typeof content === 'string' && content) {
            messages.push({ role: 'assistant', content, timestamp: ts });
          }
        } else if (msg.role === 'toolResult') {
          const resultMsg = msg as any;
          const toolName = resultMsg.toolName || 'unknown';
          let resultText = '';
          const resultImages: { mimeType: string; data: string }[] = [];
          if (Array.isArray(resultMsg.content)) {
            resultText = resultMsg.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text || '')
              .join('\n');
            // Pull image blocks (e.g. `read` on an image file) so reloaded
            // history renders them inline, mirroring live tool_end.
            for (const c of resultMsg.content) {
              if (c && c.type === 'image' && typeof c.data === 'string' && c.data) {
                resultImages.push({ mimeType: typeof c.mimeType === 'string' ? c.mimeType : 'image/png', data: c.data });
              }
            }
          } else if (typeof resultMsg.content === 'string') {
            resultText = resultMsg.content;
          }
          const toolCallId = typeof resultMsg.toolCallId === 'string' ? resultMsg.toolCallId : undefined;
          messages.push({ role: 'tool_result', content: resultText, timestamp: ts, toolName, isError: !!resultMsg.isError, ...(toolCallId ? { toolCallId } : {}), ...(resultImages.length > 0 ? { images: resultImages } : {}) });
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
   * Pure windowing math over an already-mapped HistoryMessage[]. Returns the
   * last `limit` messages (or the window ending at `beforeOffset`) plus the
   * total count and the offset of the first returned message. Shared by the
   * resident and cold-read paths.
   */
  private windowHistory(
    all: HistoryMessage[],
    limit: number,
    beforeOffset?: number,
  ): { messages: HistoryMessage[]; totalCount: number; offset: number } {
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
    return { messages: all.slice(start, end), totalCount, offset: start };
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
    return this.windowHistory(this.getSessionHistory(sessionFileOrId), limit, beforeOffset);
  }

  /**
   * List session folders.
   * - view='default' (the dashboard's main list): excludes `sessions.ignore`
   *   AND `sessions.readOnly` folders.
   * - view='readonly' (the separate read-only page): returns ONLY the
   *   `sessions.readOnly` folders (still excluding `sessions.ignore`), each
   *   tagged `readOnly: true`.
   * In both cases, excluded folders are pruned BEFORE their file bodies are
   *   read (cheap one-header probe per folder), so they cost nothing to scan.
   */
  async listSessions(view: 'default' | 'readonly' = 'default'): Promise<FolderWithSessions[]> {
    const cfg = getWhereverConfig().sessions;
    const ignorePatterns = cfg?.ignore;
    const readOnlyPatterns = cfg?.readOnly;
    const isIgnored = makeIgnoreMatcher(ignorePatterns);
    const isReadOnly = makeIgnoreMatcher(readOnlyPatterns);
    const hasIgnore = !!ignorePatterns && ignorePatterns.length > 0;
    const hasReadOnly = !!readOnlyPatterns && readOnlyPatterns.length > 0;

    // Fast path: no ignore AND no read-only patterns, and the caller wants the
    // default view -> keep pi's listAll() exactly as before (zero behaviour or
    // perf change for users who haven't opted in).
    if (view === 'default' && !hasIgnore && !hasReadOnly) {
      const diskSessions = await SessionManager.listAll();
      return this.buildFolders(
        diskSessions.map((s) => ({
          path: s.path,
          id: s.id,
          cwd: s.cwd,
          name: s.name,
          created: s.created,
          modified: s.modified,
          messageCount: s.messageCount,
          firstMessage: s.firstMessage,
        })),
      );
    }

    // A folder is KEPT only if its cwd belongs in the requested view:
    // - default: not ignored AND not read-only.
    // - readonly: not ignored AND read-only.
    const folderWanted = (cwd: string): boolean => {
      if (isIgnored(cwd)) return false;
      return view === 'readonly' ? isReadOnly(cwd) : !isReadOnly(cwd);
    };

    // Directory-aware path: prune unwanted folders BEFORE reading their file
    // bodies, so the excluded sessions do not slow down /sessions.
    const sessionsRoot = path.join(this.agentDir, 'sessions');
    let dirNames: string[] = [];
    try {
      dirNames = fs
        .readdirSync(sessionsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }

    const survivingFiles: string[] = [];
    let prunedFolders = 0;
    for (const dirName of dirNames) {
      const dirPath = path.join(sessionsRoot, dirName);
      let files: string[];
      try {
        files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      if (files.length === 0) continue;

      // Cheap pre-filter: read ONLY the header of the first file to recover the
      // authoritative cwd. All sessions in one folder share a cwd, so one header
      // decides the whole folder. If the folder is not wanted in this view, skip
      // it entirely (its file bodies are never read).
      const probeCwd = resolveSessionCwd(readSessionCwdFromHeader(path.join(dirPath, files[0])));
      if (probeCwd && !folderWanted(probeCwd)) {
        prunedFolders++;
        continue;
      }
      for (const f of files) survivingFiles.push(path.join(dirPath, f));
    }

    const infos: DiskSessionInfo[] = [];
    for (const file of survivingFiles) {
      const info = buildDiskSessionInfo(file);
      if (!info) continue;
      // Defensive per-session re-check (mixed/edge cases the folder probe missed).
      if (!folderWanted(resolveSessionCwd(info.cwd))) continue;
      infos.push(info);
    }

    if (prunedFolders > 0) {
      console.log(`[wherever] /sessions (${view}): skipped ${prunedFolders} folder(s) before reading file bodies`);
    }
    return this.buildFolders(infos, view === 'readonly' ? isReadOnly : undefined);
  }

  /** True when the given (raw or resolved) cwd matches a sessions.readOnly glob. */
  isReadOnlyCwd(cwd: string): boolean {
    const patterns = getWhereverConfig().sessions?.readOnly;
    if (!patterns || patterns.length === 0) return false;
    return makeIgnoreMatcher(patterns)(resolveSessionCwd(cwd));
  }

  /**
   * Group flat disk-session infos into per-cwd folders, dropping stub sessions
   * with no valid creation time, and sorted newest-first. Shared by both the
   * fast (listAll) and directory-aware listing paths. When `isReadOnly` is
   * provided, each folder is tagged `readOnly` per its cwd.
   */
  private buildFolders(
    diskSessions: DiskSessionInfo[],
    isReadOnly?: (cwd: string) => boolean,
  ): FolderWithSessions[] {
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

      const cwd = resolveSessionCwd(s.cwd);

      if (!folderMap.has(cwd)) {
        folderMap.set(cwd, []);
      }
      const active = this.getSession(s.path);
      folderMap.get(cwd)!.push({
        path: s.path,
        id: s.id,
        name: s.name,
        created: safeToISOString(s.created),
        modified: safeToISOString(s.modified),
        messageCount: s.messageCount,
        // Capped, whitespace-collapsed PREVIEW (not the full first message): the
        // dominant lever on /sessions payload size.
        firstMessage: previewText(s.firstMessage),
        isActive: !!active,
        clientCount: active ? active.clients.size : 0,
      });
    }

    const folders: FolderWithSessions[] = [];
    for (const [cwdPath, sessions] of folderMap.entries()) {
      const name = path.basename(cwdPath) || cwdPath;
      folders.push({
        path: cwdPath,
        name,
        sessions: sessions.sort((a, b) => b.modified.localeCompare(a.modified)),
        readOnly: isReadOnly ? isReadOnly(cwdPath) : undefined,
      });
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

  /**
   * Context-window usage for a session, for the "11.3% / 1.0M" UI indicator.
   * Server sessions compute it from the live agent; CLI-bridge sessions return
   * the latest snapshot the bridge reported (the server does not run their
   * agent). Returns undefined when unknown (no model / no usage yet).
   */
  getContextUsage(sessionFileOrId: string): ContextUsageInfo | null | undefined {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return undefined;
    if (tracked.type === 'server') {
      const usage = tracked.agentSession.getContextUsage();
      if (!usage) return undefined;
      return { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent };
    }
    return tracked.contextUsage;
  }

  /** Record a context-usage snapshot reported by a CLI bridge for its session. */
  setCliContextUsage(sessionFileOrId: string, usage: ContextUsageInfo | null): void {
    const tracked = this.getSession(sessionFileOrId);
    if (tracked && tracked.type === 'cli') {
      tracked.contextUsage = usage;
    }
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

  async registerCliSession(rawSessionFile: string, cwd: string, modelStr: string, cliWs: WebSocket, isStreaming = false): Promise<{ tracked: TrackedSession; error?: string; interruptedTurn?: boolean; interruptedToolCall?: boolean }> {
    // Canonicalize the CLI-reported path so it keys the same entry the server
    // would compute itself (see normalizeSessionFile). Without this, a CLI on a
    // different pi version can register a second, parallel session for the same
    // work under a cosmetically different path string.
    const sessionFile = normalizeSessionFile(rawSessionFile);
    const existing = this.sessions.get(sessionFile);
    let clients = new Set<string>();
    // A CLI registering for a session that already had a LIVE server-side agent
    // seizes control: we dispose that agent below. Disposing MID-TURN discards
    // the whole in-flight turn WITHOUT persisting it (persistence only happens
    // on message_end, which never fires here), so the web viewer who was
    // watching the turn loses it silently. Two flavours, both worth warning:
    //   - a TOOL CALL was executing (inFlightToolCount > 0): its result is never
    //     produced;
    //   - only assistant TEXT was streaming: the partial reply is discarded.
    // We report `interruptedTurn` (either flavour) and `interruptedToolCall`
    // (the tool-call flavour specifically) so the caller can warn accurately.
    let interruptedTurn = false;
    let interruptedToolCall = false;
    if (existing) {
      clients = existing.clients;
      this.cancelIdleCheck(sessionFile);
      if (existing.type === 'server') {
        interruptedToolCall = existing.inFlightToolCount > 0;
        interruptedTurn = interruptedToolCall || existing.agentSession.isStreaming;
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
      // Honor the CLI's CURRENT streaming state at register time. The CLI only
      // forwards agent_start/agent_end going forward, so a turn already in flight
      // when the bridge (re)connects would otherwise be invisible: a viewer
      // joining a mid-tool-call CLI session would see Abort disabled + an enabled
      // composer while the CLI is still working. isStreaming carries that state.
      isStreaming,
    };
    // A session registered mid-turn is not idle; keep it from being idle-reaped.
    if (isStreaming) {
      tracked.isIdle = false;
      this.cancelIdleCheck(sessionFile);
    }

    this.sessions.set(sessionFile, tracked);
    return { tracked, interruptedTurn, interruptedToolCall };
  }

  async unregisterCliSession(rawSessionFile: string): Promise<void> {
    const sessionFile = normalizeSessionFile(rawSessionFile);
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

  handleCliEvent(rawSessionFile: string, event: AgentSessionEvent): void {
    const sessionFile = normalizeSessionFile(rawSessionFile);
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
    } else if ((event.type as any) === 'context_usage') {
      // The CLI bridge reports its agent's context usage (the server cannot
      // compute it for CLI sessions). Cache it so getContextUsage() can serve it
      // on join, and let it flow through onEvent for live broadcast.
      tracked.contextUsage = (event as any).contextUsage ?? null;
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
          // A turn ended: nothing is in flight anymore. Reset defensively in case
          // a start/end pair was ever missed, so the count cannot drift positive.
          if (tracked.type === 'server') tracked.inFlightToolCount = 0;
          this.scheduleIdleCheck(sessionFile);
          break;

        case 'tool_execution_start':
          if (tracked.type === 'server') tracked.inFlightToolCount++;
          tracked.lastActivity = Date.now();
          break;

        case 'tool_execution_end':
          // Clamp at 0: an unmatched end must never make the count negative.
          if (tracked.type === 'server')
            tracked.inFlightToolCount = Math.max(0, tracked.inFlightToolCount - 1);
          tracked.lastActivity = Date.now();
          break;

        case 'message_update':
        case 'message_end':
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

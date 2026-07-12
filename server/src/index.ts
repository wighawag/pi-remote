#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, request as httpRequest } from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { SessionPool, getWhereverConfig, type WhereverConfig } from './session-pool.js';
import type { ClientMessage, ServerMessage, ToolImage } from './protocol.js';
import { INITIAL_HISTORY_LIMIT, HISTORY_PAGE_SIZE } from './protocol.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  runInstall,
  runUninstall,
  runServiceStatus,
  parseInstallOptions,
  printInstallHelp,
} from './commands/install.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devStaticPath = path.resolve(__dirname, '../../web/build');
const prodStaticPath = path.resolve(__dirname, '../public');
const staticDir = fs.existsSync(devStaticPath) ? devStaticPath : prodStaticPath;

function serveStaticFile(reqPath: string, res: ServerResponse) {
  let filePath = path.join(staticDir, reqPath === '/' ? 'index.html' : reqPath);

  if (!filePath.startsWith(staticDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(staticDir, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm',
    '.txt': 'text/plain',
    '.webmanifest': 'application/manifest+json'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Cache-Control: content-hashed build assets under /_app/immutable/ never
  // change for a given URL, so they can be cached aggressively. Everything
  // else (HTML app shell, the manifest, top-level icons) must stay revalidated
  // so a freshly deployed build is picked up. This addresses Lighthouse's
  // "efficient cache lifetimes" audit without affecting the service worker's
  // own caching (which keys off the build version).
  // Only treat it as an immutable asset when the resolved file actually lives
  // under the hashed immutable folder (not when the SPA fallback served
  // index.html for an /_app/immutable/* miss).
  const servedImmutable =
    reqPath.startsWith('/_app/immutable/') &&
    filePath.includes(`${path.sep}_app${path.sep}immutable${path.sep}`);
  const cacheControl = servedImmutable
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end(`Server Error: ${err.code}`);
    } else {
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
      res.end(data);
    }
  });
}

interface WSClient {
  id: string;
  ws: WebSocket;
  sessionId: string | null;
  readOnly: boolean;
  isCliBridge?: boolean;
}

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function parseArgs(): { port: number; host: string; token?: string; idleTimeout: number; sslKey?: string; sslCert?: string; noSsl: boolean; httpLocalhostFallbackPort?: number } {
  const args = process.argv.slice(2);
  let port = parseInt(process.env.PI_REMOTE_PORT || '31415', 10);
  let host = process.env.PI_REMOTE_HOST || '127.0.0.1';
  let token = process.env.PI_REMOTE_TOKEN || undefined;
  // Idle eviction window. Longer than the old 5 min so a dip-in/dip-out mobile
  // user returns to a still-WARM session (no agent rebuild) most of the time.
  // With fast-first load a cold return is no longer slow to READ, but a warm
  // session also avoids the async agent build entirely. Override via
  // PI_IDLE_TIMEOUT (ms). See docs/plan-speed-up-long-session-load.md.
  let idleTimeout = parseInt(process.env.PI_IDLE_TIMEOUT || '1200000', 10);
  let sslKey = process.env.PI_REMOTE_SSL_KEY || undefined;
  let sslCert = process.env.PI_REMOTE_SSL_CERT || undefined;
  let noSsl = process.env.PI_REMOTE_NO_SSL === 'true' || process.env.PI_REMOTE_HTTP === 'true';
  let httpLocalhostFallbackPort: number | undefined = undefined;

  if (process.env.PI_REMOTE_HTTP_LOCALHOST_FALLBACK) {
    const envVal = process.env.PI_REMOTE_HTTP_LOCALHOST_FALLBACK;
    if (envVal === 'true') {
      httpLocalhostFallbackPort = -1; // auto
    } else {
      const parsed = parseInt(envVal, 10);
      httpLocalhostFallbackPort = isNaN(parsed) ? -1 : parsed;
    }
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        port = parseInt(args[++i] || '31415', 10);
        break;
      case '--host':
        host = args[++i] || '127.0.0.1';
        break;
      case '--token':
        token = args[++i];
        break;
      case '--idle-timeout':
        idleTimeout = parseInt(args[++i] || '300000', 10);
        break;
      case '--ssl-key':
        sslKey = args[++i];
        break;
      case '--ssl-cert':
        sslCert = args[++i];
        break;
      case '--no-ssl':
      case '--http':
        noSsl = true;
        break;
      case '--http-localhost-fallback': {
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith('--')) {
          const parsedPort = parseInt(nextArg, 10);
          if (!isNaN(parsedPort)) {
            httpLocalhostFallbackPort = parsedPort;
            i++; // consume port
          } else {
            httpLocalhostFallbackPort = -1; // auto
          }
        } else {
          httpLocalhostFallbackPort = -1; // auto
        }
        break;
      }
    }
  }

  return { port, host, token, idleTimeout, sslKey, sslCert, noSsl, httpLocalhostFallbackPort };
}

function authenticate(req: IncomingMessage, token?: string): boolean {
  if (!token) return true;
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const provided = url.searchParams.get('token') || req.headers.authorization?.replace('Bearer ', '') || '';
  return provided === token;
}

function resolveUploadDir(config: WhereverConfig, cwd?: string): string {
  const type = config.uploads?.type || 'tmp';

  if (type === 'session' && cwd) {
    const subDir = config.uploads?.subDir || '.wherever/uploads';
    const resolved = path.resolve(cwd, subDir);
    return resolved;
  }

  if (type === 'custom' && config.uploads?.dir) {
    let customDir = config.uploads.dir;
    if (customDir.startsWith('~')) {
      customDir = path.join(os.homedir(), customDir.slice(1));
    }
    return path.resolve(customDir);
  }

  // Default to tmp
  return os.tmpdir();
}

function sendJSON(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage, maxLimitBytes = 1e6): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > maxLimitBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', (err) => reject(err));
  });
}

function sendWS(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error('Failed to send WS message:', err);
    }
  }
}

async function main(): Promise<void> {
  const { port, host, token, idleTimeout, sslKey, sslCert, noSsl, httpLocalhostFallbackPort } = parseArgs();
  const sessionPool = new SessionPool(idleTimeout);
  await sessionPool.initialize();

  const clients = new Map<string, WSClient>();

  let actualSslKey = sslKey;
  let actualSslCert = sslCert;
  let isSecure = !noSsl;

  if (isSecure) {
    if (!actualSslKey || !actualSslCert) {
      // Automatic self-signed certificate generation
      const homeDir = os.homedir();
      const certsDir = path.join(homeDir, '.wherever', 'certs');
      const defaultKeyPath = path.join(certsDir, 'localhost.key');
      const defaultCertPath = path.join(certsDir, 'localhost.crt');

      if (!fs.existsSync(defaultKeyPath) || !fs.existsSync(defaultCertPath)) {
        console.log('Generating self-signed SSL certificates for secure HTTPS/WSS...');
        try {
          fs.mkdirSync(certsDir, { recursive: true });
          const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${defaultKeyPath}" -out "${defaultCertPath}" -sha256 -days 3650 -nodes -subj "/CN=localhost"`;
          execSync(cmd, { stdio: 'ignore' });
          console.log(`Self-signed certificates generated successfully in ${certsDir}`);
        } catch (err) {
          console.warn('Failed to generate self-signed certificates using OpenSSL. Falling back to HTTP.', (err as Error).message);
          isSecure = false;
        }
      }

      if (isSecure) {
        actualSslKey = defaultKeyPath;
        actualSslCert = defaultCertPath;
      }
    }
  }

  function broadcastToSession(sessionFile: string, msg: ServerMessage, excludeClientId?: string): void {
    const tracked = sessionPool.getSession(sessionFile);
    if (!tracked) return;
    for (const cid of tracked.clients) {
      if (cid === excludeClientId) continue;
      const c = clients.get(cid);
      if (c) sendWS(c.ws, msg);
    }
  }

  function broadcastSessionsUpdated(): void {
    const updateMsg: ServerMessage = { type: 'sessions_updated' };
    for (const c of clients.values()) {
      sendWS(c.ws, updateMsg);
    }
  }

  function broadcastAgentEvent(sessionFile: string, event: AgentSessionEvent): void {
    let msg: ServerMessage | null = null;
    const sessionId = sessionPool.getSession(sessionFile)?.sessionId || '';

    switch (event.type) {
      case 'agent_start':
        msg = { type: 'agent_start', sessionId };
        break;
      case 'message_update': {
        if (event.message.role !== 'assistant') break;
        const evt = (event as any).assistantMessageEvent;
        if (evt?.type === 'text_delta') {
          msg = { type: 'message_update', sessionId, delta: evt.delta };
        } else if (evt?.type === 'thinking_delta') {
          msg = { type: 'thinking_update', sessionId, delta: evt.delta };
        }
        break;
      }
      case 'message_end': {
        const role = (event.message as any)?.role;
        if (role !== 'assistant' && role !== 'user') break;
        const content = extractText(event.message as any);
        msg = { type: 'message_end', sessionId, content, role };
        break;
      }
      case 'agent_end': {
        msg = { type: 'agent_end', sessionId };
        const messages = (event as any).messages;
        if (Array.isArray(messages) && messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.stopReason === 'error' && lastMsg.errorMessage) {
            // Send a session_error message to all clients of this session
            const errMsg: ServerMessage = {
              type: 'session_error',
              sessionId,
              error: lastMsg.errorMessage
            };
            for (const c of clients.values()) {
              if (c.sessionId === sessionFile) {
                sendWS(c.ws, errMsg);
              }
            }
          }
        }
        break;
      }
      case 'auto_retry_start': {
        const evt = event as any;
        const errMsg: ServerMessage = {
          type: 'session_error',
          sessionId,
          error: `Error: ${evt.errorMessage}. Retrying (attempt ${evt.attempt}/${evt.maxAttempts}) in ${Math.round(evt.delayMs / 1000)}s...`
        };
        for (const c of clients.values()) {
          if (c.sessionId === sessionFile) {
            sendWS(c.ws, errMsg);
          }
        }
        break;
      }
      case 'auto_retry_end': {
        const evt = event as any;
        if (!evt.success && evt.finalError) {
          const errMsg: ServerMessage = {
            type: 'session_error',
            sessionId,
            error: `Retry failed: ${evt.finalError}`
          };
          for (const c of clients.values()) {
            if (c.sessionId === sessionFile) {
              sendWS(c.ws, errMsg);
            }
          }
        } else if (evt.success) {
          for (const c of clients.values()) {
            if (c.sessionId === sessionFile) {
              sendWS(c.ws, { type: 'session_error', sessionId, error: '' });
            }
          }
        }
        break;
      }
      case 'session_error' as any: {
        msg = {
          type: 'session_error',
          sessionId,
          error: (event as any).error
        };
        break;
      }
      case 'tool_execution_start':
        msg = { type: 'tool_start', sessionId, toolName: event.toolName, args: event.args };
        break;
      case 'tool_execution_update': {
        const evt = event as any;
        msg = { type: 'tool_update', sessionId, toolName: event.toolName, delta: evt.delta || '' };
        break;
      }
      case 'tool_execution_end': {
        const toolResult = extractToolResult(event as any);
        const toolImages = extractToolImages(event as any);
        msg = {
          type: 'tool_end',
          sessionId,
          toolName: event.toolName,
          isError: event.isError,
          result: toolResult,
          ...(toolImages.length > 0 ? { images: toolImages } : {}),
        };
        break;
      }
      case 'model_select' as any: {
        const evt = event as any;
        const modelStr = typeof evt.model === 'string'
          ? evt.model
          : (evt.model ? `${evt.model.provider}:${evt.model.id}` : '');
        if (modelStr) {
          msg = { type: 'model_changed', sessionId, model: modelStr };
        }
        break;
      }
      case 'context_usage' as any: {
        // Emitted by the CLI bridge for CLI sessions (server sessions use the
        // broadcastContextUsage path below). The snapshot is already cached.
        msg = {
          type: 'context_usage',
          sessionId,
          contextUsage: (event as any).contextUsage ?? null,
        };
        break;
      }
    }

    if (msg) {
      for (const c of clients.values()) {
        if (c.sessionId === sessionFile) {
          sendWS(c.ws, msg);
        }
      }
    }

    // Push an updated context-usage snapshot at points where it can change:
    // a finished turn, a settled message, or a model switch (context window
    // changes). Cheap and keeps the "11.3% / 1.0M" indicator live.
    if (
      event.type === 'agent_end' ||
      event.type === 'message_end' ||
      (event.type as any) === 'model_select'
    ) {
      broadcastContextUsage(sessionFile);
    }

    if (event.type === 'message_end' || event.type === 'agent_end') {
      broadcastSessionsUpdated();
    }
  }

  function broadcastContextUsage(sessionFile: string): void {
    const tracked = sessionPool.getSession(sessionFile);
    if (!tracked) return;
    const usage = sessionPool.getContextUsage(sessionFile);
    if (usage === undefined) return;
    const msg: ServerMessage = {
      type: 'context_usage',
      sessionId: tracked.sessionId,
      contextUsage: usage,
    };
    for (const c of clients.values()) {
      if (c.sessionId === sessionFile) {
        sendWS(c.ws, msg);
      }
    }
  }

  sessionPool.onEvent = broadcastAgentEvent;

  const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/health') {
      sendJSON(res, 200, { status: 'ok', timestamp: Date.now() });
      return;
    }

    const isApiRequest = pathname.startsWith('/sessions') || 
                          pathname.startsWith('/models') || 
                          pathname.startsWith('/config') || 
                          pathname.startsWith('/check-path') || 
                          pathname.startsWith('/autocomplete-path') || 
                          pathname.startsWith('/session/');

    if (isApiRequest && !authenticate(req, token)) {
      sendJSON(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (pathname === '/sessions' && req.method === 'GET') {
      // ?view=readonly returns only the sessions.readOnly folders (the separate
      // read-only page); default returns the main list (ignore + readOnly hidden).
      const view = url.searchParams.get('view') === 'readonly' ? 'readonly' : 'default';
      const folders = await sessionPool.listSessions(view);
      const active = sessionPool.getActiveSessions();
      sendJSON(res, 200, { folders, activeSessions: active });
      return;
    }

    if (pathname === '/models' && req.method === 'GET') {
      const models = sessionPool.getAvailableModels();
      sendJSON(res, 200, { models });
      return;
    }

    if (pathname === '/config' && req.method === 'GET') {
      const config = getWhereverConfig();
      let searchFolder: string | undefined = config.searchFolder;
      if (searchFolder && searchFolder.startsWith('~')) {
        searchFolder = path.join(os.homedir(), searchFolder.slice(1));
      }
      // Resolve the search folder's default model against that folder's settings
      // (folder-local harness/pi config wins), so the search composer can seed its
      // model picker with the folder default rather than the server global.
      const searchDefaultModel = searchFolder
        ? sessionPool.getDefaultModelFor(searchFolder)
        : null;
      sendJSON(res, 200, {
        gitInitDefault: !!config.gitInitDefault,
        uploadMethod: config.uploads?.method || 'websocket',
        searchFolder: searchFolder || null,
        searchCreateRemote: !!config.searchCreateRemote,
        searchDefaultModel
      });
      return;
    }

    if (pathname === '/check-path' && req.method === 'GET') {
      const qPath = url.searchParams.get('path');
      if (!qPath) {
        sendJSON(res, 400, { error: 'Missing path' });
        return;
      }
      let resolved = qPath;
      if (qPath.startsWith('~')) {
        resolved = path.join(os.homedir(), qPath.slice(1));
      } else if (!path.isAbsolute(qPath)) {
        resolved = path.join(os.homedir(), qPath);
      } else {
        resolved = path.resolve(qPath);
      }

      const exists = fs.existsSync(resolved);
      let isGit = false;
      if (exists) {
        isGit = fs.existsSync(path.join(resolved, '.git'));
      }

      // Check matching remote rules
      let matchingRule = null;
      const config = getWhereverConfig();
      if (config.remoteRepoRules && Array.isArray(config.remoteRepoRules)) {
        const rule = config.remoteRepoRules.find(r => new RegExp(r.pattern).test(resolved));
        if (rule) {
          matchingRule = {
            provider: rule.provider,
            visibility: rule.visibility || 'private'
          };
        }
      }

      sendJSON(res, 200, { exists, isGit, resolvedPath: resolved, matchingRule });
      return;
    }

    if (pathname === '/autocomplete-path' && req.method === 'GET') {
      const qPath = url.searchParams.get('path') || '';
      let parentPath = '';
      let prefix = '';

      const lastSlashIndex = qPath.lastIndexOf('/');
      if (lastSlashIndex === -1) {
        parentPath = '~';
        prefix = qPath;
      } else {
        parentPath = qPath.slice(0, lastSlashIndex + 1);
        prefix = qPath.slice(lastSlashIndex + 1);
      }

      let resolvedParent = parentPath;
      if (parentPath.startsWith('~')) {
        resolvedParent = path.join(os.homedir(), parentPath.slice(1));
      } else if (!path.isAbsolute(parentPath)) {
        resolvedParent = path.join(os.homedir(), parentPath);
      } else {
        resolvedParent = path.resolve(parentPath);
      }

      const config = getWhereverConfig();
      
      // Resolve the query path
      let resolvedQuery = qPath;
      if (qPath.startsWith('~')) {
        resolvedQuery = path.join(os.homedir(), qPath.slice(1));
      } else if (!path.isAbsolute(qPath)) {
        resolvedQuery = path.join(os.homedir(), qPath);
      } else {
        resolvedQuery = path.resolve(qPath);
      }
      const resolvedQueryLower = resolvedQuery.toLowerCase();

      // Format matched common folder to match the user's input prefix style
      const formatCommonFolder = (folderPath: string) => {
        let resolved = folderPath;
        if (folderPath.startsWith('~')) {
          resolved = path.join(os.homedir(), folderPath.slice(1));
        } else if (!path.isAbsolute(folderPath)) {
          resolved = path.join(os.homedir(), folderPath);
        } else {
          resolved = path.resolve(folderPath);
        }

        // Apply trailing slash if missing
        if (!resolved.endsWith('/')) {
          resolved = resolved + '/';
        }

        if (qPath.startsWith('~')) {
          const home = os.homedir() + '/';
          if (resolved.startsWith(home)) {
            return '~/' + resolved.slice(home.length);
          }
          return resolved;
        } else if (qPath.startsWith('/')) {
          return resolved;
        } else {
          const home = os.homedir() + '/';
          if (resolved.startsWith(home)) {
            return resolved.slice(home.length);
          }
          return resolved;
        }
      };

      // Filter and format matching common folders
      const matchingCommons = (config.commonFolders || [])
        .filter(folder => {
          let resolved = folder;
          if (folder.startsWith('~')) {
            resolved = path.join(os.homedir(), folder.slice(1));
          } else if (!path.isAbsolute(folder)) {
            resolved = path.join(os.homedir(), folder);
          } else {
            resolved = path.resolve(folder);
          }
          return resolved.toLowerCase().startsWith(resolvedQueryLower);
        })
        .map(folder => formatCommonFolder(folder));

      try {
        if (!fs.existsSync(resolvedParent)) {
          sendJSON(res, 200, { completions: matchingCommons });
          return;
        }

        const stat = fs.statSync(resolvedParent);
        if (!stat.isDirectory()) {
          sendJSON(res, 200, { completions: matchingCommons });
          return;
        }

        const entries = fs.readdirSync(resolvedParent, { withFileTypes: true });
        const actualCompletionsWithStats = entries
          .filter(entry => {
            if (!entry.isDirectory()) return false;
            if (entry.name.startsWith('.') && !prefix.startsWith('.')) return false;
            return entry.name.toLowerCase().startsWith(prefix.toLowerCase());
          })
          .map(entry => {
            const entryPath = path.join(resolvedParent, entry.name);
            let mtimeMs = 0;
            try {
              mtimeMs = fs.statSync(entryPath).mtimeMs;
            } catch (e) {
              // Ignore stats errors
            }
            return {
              name: entry.name,
              mtimeMs
            };
          });

        // Sort by mtimeMs descending (most recent first)
        actualCompletionsWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

        const actualCompletions = actualCompletionsWithStats.map(item => {
          let formattedParent = parentPath;
          if (parentPath === '~') {
            formattedParent = '~/';
          }
          return formattedParent + item.name + '/';
        });

        const combined = [...matchingCommons, ...actualCompletions];
        const uniqueCompletions = Array.from(new Set(combined));

        sendJSON(res, 200, { completions: uniqueCompletions });
      } catch (e) {
        sendJSON(res, 200, { completions: matchingCommons });
      }
      return;
    }

    if (pathname === '/session/model' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { sessionId, model } = JSON.parse(body) as { sessionId: string; model: string };
        if (!sessionId || !model) {
          sendJSON(res, 400, { error: 'Missing sessionId or model' });
          return;
        }
        const result = await sessionPool.changeModel(sessionId, model);
        if (result.error) {
          sendJSON(res, 400, { error: result.error });
        } else {
          const tracked = sessionPool.getSession(sessionId);
          if (tracked) {
            const wsMsg: ServerMessage = {
              type: 'model_changed',
              sessionId: tracked.sessionId,
              model,
            };
            for (const cid of tracked.clients) {
              const c = clients.get(cid);
              if (c) sendWS(c.ws, wsMsg);
            }
          }
          sendJSON(res, 200, { status: 'changed', model });
        }
      } catch (err) {
        sendJSON(res, 400, { error: (err as Error).message || 'Invalid request' });
      }
      return;
    }

    if (pathname === '/session/destroy' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { sessionId } = JSON.parse(body) as { sessionId: string };
        if (!sessionId) {
          sendJSON(res, 400, { error: 'Missing sessionId' });
          return;
        }

        const tracked = sessionPool.getSession(sessionId);
        if (tracked) {
          const wsMsg: ServerMessage = {
            type: 'session_destroyed',
            sessionId: tracked.sessionId,
            reason: 'Session destroyed manually'
          };
          for (const cid of tracked.clients) {
            const c = clients.get(cid);
            if (c) {
              sendWS(c.ws, wsMsg);
              c.sessionId = null;
              c.readOnly = false;
            }
          }
        }

        sessionPool.destroySession(sessionId, 'manual');
        sendJSON(res, 200, { status: 'destroyed' });
      } catch (err) {
        sendJSON(res, 400, { error: (err as Error).message || 'Invalid request' });
      }
      return;
    }

    if (pathname === '/session/delete' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { sessionFile } = JSON.parse(body) as { sessionFile: string };
        if (!sessionFile) {
          sendJSON(res, 400, { error: 'Missing sessionFile' });
          return;
        }

        let resolved = sessionFile;
        if (sessionFile.startsWith('~')) {
          resolved = path.join(os.homedir(), sessionFile.slice(1));
        } else if (!path.isAbsolute(sessionFile)) {
          resolved = path.join(os.homedir(), sessionFile);
        } else {
          resolved = path.resolve(sessionFile);
        }

        // Security check: only allow deleting files ending with .jsonl
        if (!resolved.endsWith('.jsonl')) {
          sendJSON(res, 400, { error: 'Invalid session file format' });
          return;
        }

        // Get the active session if any, using either the sessionFile path or resolved path
        const tracked = sessionPool.getSession(sessionFile) || sessionPool.getSession(resolved);
        if (tracked) {
          const wsMsg: ServerMessage = {
            type: 'session_destroyed',
            sessionId: tracked.sessionId,
            reason: 'Session deleted'
          };
          for (const cid of tracked.clients) {
            const c = clients.get(cid);
            if (c) {
              sendWS(c.ws, wsMsg);
              c.sessionId = null;
              c.readOnly = false;
            }
          }
          sessionPool.destroySession(tracked.sessionFile, 'deleted');
        }

        if (fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }

        // Broadcast 'sessions_updated' to all connected websocket clients
        const updateMsg: ServerMessage = {
          type: 'sessions_updated'
        };
        for (const c of clients.values()) {
          sendWS(c.ws, updateMsg);
        }

        sendJSON(res, 200, { status: 'deleted' });
      } catch (err) {
        sendJSON(res, 400, { error: (err as Error).message || 'Invalid request' });
      }
      return;
    }

    if (pathname === '/session/new' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { cwd, model, gitInit, createRemote, repoVisibility } = JSON.parse(body) as { cwd: string; model?: string; gitInit?: boolean; createRemote?: boolean; repoVisibility?: 'private' | 'public' };
        if (!cwd) {
          sendJSON(res, 400, { error: 'Missing cwd' });
          return;
        }
        const result = await sessionPool.createNewSession(cwd, model, gitInit, createRemote, repoVisibility);
        if (result.error) {
          sendJSON(res, 500, { error: result.error });
        } else {
          broadcastSessionsUpdated();
          sendJSON(res, 201, {
            sessionId: result.tracked.sessionId,
            sessionFile: result.tracked.sessionFile,
            cwd: result.tracked.cwd,
            model: result.tracked.model,
          });
        }
      } catch (err) {
        sendJSON(res, 400, { error: (err as Error).message || 'Invalid request' });
      }
      return;
    }

    if (pathname === '/session/upload' && req.method === 'POST') {
      try {
        const qSessionId = url.searchParams.get('sessionId') || '';
        const qFilename = url.searchParams.get('filename') || '';

        if (!qSessionId || !qFilename) {
          sendJSON(res, 400, { error: 'Missing sessionId or filename' });
          return;
        }

        const tracked = sessionPool.getSession(qSessionId);
        const cwd = tracked?.cwd;

        const config = getWhereverConfig();
        const targetDir = resolveUploadDir(config, cwd);

        fs.mkdirSync(targetDir, { recursive: true });

        const timestamp = Date.now();
        const safeFilename = `${timestamp}_${path.basename(qFilename)}`;
        const destPath = path.join(targetDir, safeFilename);

        const writeStream = fs.createWriteStream(destPath);
        req.pipe(writeStream);

        writeStream.on('finish', () => {
          sendJSON(res, 200, {
            status: 'uploaded',
            filename: qFilename,
            savedPath: destPath
          });
        });

        writeStream.on('error', (err) => {
          sendJSON(res, 500, { error: `Failed to write file: ${err.message}` });
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Upload error: ${(err as Error).message}` });
      }
      return;
    }

    if (pathname === '/session/transcribe' && req.method === 'POST') {
      const config = getWhereverConfig();
      const apiKey = config.speech?.apiKey || process.env.SPEECH_API_KEY;
      const apiUrl = config.speech?.apiUrl || process.env.SPEECH_API_URL || 'https://api.z.ai/api/paas/v4/audio/transcriptions';
      const apiModel = config.speech?.model || process.env.SPEECH_MODEL || 'glm-asr-2512';

      if (!apiKey) {
        sendJSON(res, 400, { error: 'Server speech transcription API key not configured' });
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const audioBuffer = Buffer.concat(chunks);
        if (audioBuffer.length === 0) {
          sendJSON(res, 400, { error: 'Empty audio payload' });
          return;
        }

        const boundary = '----SpeechBoundary' + Math.random().toString(16);
        const header = `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="model"\r\n\r\n` +
          `${apiModel}\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
          `Content-Type: audio/wav\r\n\r\n`;

        const footer = `\r\n--${boundary}--\r\n`;

        const headerBuffer = Buffer.from(header, 'utf-8');
        const footerBuffer = Buffer.from(footer, 'utf-8');
        const totalPayload = Buffer.concat([headerBuffer, audioBuffer, footerBuffer]);

        const parsedUrl = new URL(apiUrl);
        const apiReq = httpRequest({
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': totalPayload.length
          }
        }, (apiRes) => {
          let responseBody = '';
          apiRes.on('data', (chunk) => responseBody += chunk);
          apiRes.on('end', () => {
            try {
              const parsed = JSON.parse(responseBody);
              if (apiRes.statusCode && apiRes.statusCode >= 400) {
                sendJSON(res, apiRes.statusCode, { error: parsed.error?.message || parsed.message || 'API request failed' });
              } else {
                sendJSON(res, 200, { text: parsed.text || '' });
              }
            } catch (e) {
              sendJSON(res, 500, { error: 'Failed to parse cloud response' });
            }
          });
        });

        apiReq.on('error', (err) => {
          sendJSON(res, 500, { error: err.message });
        });

        apiReq.write(totalPayload);
        apiReq.end();
      });
      return;
    }

    serveStaticFile(pathname, res);
  };

  let server;
  let httpServer: any = null;
  let isSecureServer = false;
  if (isSecure && actualSslKey && actualSslCert) {
    try {
      const options = {
        key: fs.readFileSync(actualSslKey),
        cert: fs.readFileSync(actualSslCert),
      };
      server = createHttpsServer(options, requestHandler);
      isSecureServer = true;
      // Instantiate plain HTTP server on localhost if fallback option is enabled
      if (httpLocalhostFallbackPort !== undefined) {
        httpServer = createHttpServer(requestHandler);
      }
    } catch (err) {
      console.error(`Failed to load SSL certificates from ${actualSslKey} and ${actualSslCert}. Falling back to HTTP.`, (err as Error).message);
      server = createHttpServer(requestHandler);
    }
  } else {
    server = createHttpServer(requestHandler);
  }

  const wss = new WebSocketServer({ noServer: true });

  // Connection-liveness heartbeat. A half-open TCP socket (peer vanished without
  // a clean FIN/RST: process restart, network blip, dropped upstream) stays in
  // ESTAB and fires neither 'close' nor 'error', so the connected agent/session
  // is never reaped and hangs forever. We send a protocol-level ping frame on a
  // fixed interval and terminate any socket that did not answer the previous
  // ping. terminate() fires 'close', routing through the existing cleanup
  // (unregisterCliSession / removeClient + broadcastSessionsUpdated).
  // See work/observations/ws-half-open-connection-hangs-agent-no-heartbeat.md.
  const HEARTBEAT_MS = 30_000;
  const liveSockets = new WeakSet<WebSocket>();

  const upgradeHandler = (req: any, socket: any, head: any) => {
    if (req.url?.startsWith('/ws')) {
      if (!authenticate(req, token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  };

  server.on('upgrade', upgradeHandler);
  if (httpServer) {
    httpServer.on('upgrade', upgradeHandler);
  }

  wss.on('connection', (ws) => {
    const clientId = generateId();
    const client: WSClient = {
      id: clientId,
      ws,
      sessionId: null,
      readOnly: false,
    };
    clients.set(clientId, client);

    // Liveness: assume alive on connect; any pong (reply to the heartbeat ping
    // frame below) re-marks the socket alive for the next interval.
    liveSockets.add(ws);
    ws.on('pong', () => {
      liveSockets.add(ws);
    });

    sendWS(ws, { type: 'connected', clientId });

    ws.on('message', async (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        console.error('WS parse error:', err);
        sendWS(ws, {
          type: 'session_error',
          error: 'Invalid message format (JSON parse failed)'
        });
        return;
      }

      try {
        await handleWSMessage(msg, client, sessionPool, clients, broadcastToSession, broadcastSessionsUpdated);
      } catch (err) {
        console.error('WS message processing error:', err);
        const errorText = (err as Error).message || 'An error occurred';
        if (client.sessionId) {
          const tracked = sessionPool.getSession(client.sessionId);
          const sId = tracked?.sessionId;
          const errMsg: ServerMessage = {
            type: 'session_error',
            sessionId: sId,
            error: errorText
          };
          if (tracked) {
            for (const cid of tracked.clients) {
              const c = clients.get(cid);
              if (c) {
                sendWS(c.ws, errMsg);
              }
            }
          }
        } else {
          sendWS(ws, {
            type: 'session_error',
            error: errorText
          });
        }
      }
    });

    ws.on('close', async () => {
      if (client.sessionId) {
        if (client.isCliBridge) {
          await sessionPool.unregisterCliSession(client.sessionId);
        } else {
          sessionPool.removeClient(client.sessionId, clientId);
        }
        broadcastSessionsUpdated();
      }
      clients.delete(clientId);
    });

    ws.on('error', (err) => {
      console.error(`WS error for ${clientId}:`, err.message);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!liveSockets.has(ws)) {
        // Missed the previous ping: treat as dead and reap. 'close' fires the
        // existing teardown so the agent's session is released, not left dangling.
        // Log with whatever client/session context we can recover so a reaped
        // (hung) agent shows up as an event rather than as silence.
        let reaped: WSClient | undefined;
        for (const c of clients.values()) {
          if (c.ws === ws) { reaped = c; break; }
        }
        console.warn(
          `[wherever] reaping dead WebSocket (missed heartbeat pong): ` +
          `client=${reaped?.id ?? 'unknown'} ` +
          `session=${reaped?.sessionId ?? 'none'} ` +
          `${reaped?.isCliBridge ? 'cli-bridge' : 'viewer'}`,
        );
        try { ws.terminate(); } catch {}
        continue;
      }
      liveSockets.delete(ws);
      try { ws.ping(); } catch {}
    }
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  server.listen(port, host, () => {
    const protocol = isSecureServer ? 'https' : 'http';
    const authInfo = token ? ' (token-protected)' : ' (no authentication)';
    console.log(`\n🔐 Wherever Server: ${protocol}://${host}:${port}${authInfo}`);

    if (isSecureServer) {
      console.log(`
👉 FIRST TIME CONNECTING?
Since the server uses an automatically generated self-signed SSL certificate:
1. Open https://${host}:${port} in your browser/phone.
2. You will see a "Your connection is not private" warning.
3. Click "Advanced" (or "More Info") and choose "Proceed to ${host} (unsafe)".
This encrypts all network traffic securely and enables safe, private remote access!
`);
    }
  });

  if (httpServer && httpLocalhostFallbackPort !== undefined) {
    const insecurePort = httpLocalhostFallbackPort === -1 ? port + 1 : httpLocalhostFallbackPort;
    const authInfo = token ? ' (token-protected)' : ' (no authentication)';
    // Strictly bind to 127.0.0.1 (localhost) for absolute security
    httpServer.listen(insecurePort, '127.0.0.1', () => {
      console.log(`\n🔓 Wherever Server (Insecure HTTP/WS Fallback): http://127.0.0.1:${insecurePort}${authInfo}`);
    });
    httpServer.on('error', (err: any) => {
      console.warn('Insecure HTTP Server fallback failed to start:', err.message);
    });
  }

  server.on('error', (err) => {
    console.error('Server error:', err.message);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    clearInterval(heartbeat);
    for (const c of clients.values()) {
      c.ws.close();
    }
    await sessionPool.disposeAll();
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function switchClientSession(client: WSClient, newSessionFile: string | null, pool: SessionPool, onSessionsUpdated?: () => void) {
  if (client.sessionId && client.sessionId !== newSessionFile) {
    pool.removeClient(client.sessionId, client.id);
  }
  client.sessionId = newSessionFile;
  if (onSessionsUpdated) {
    onSessionsUpdated();
  }
}

async function handleWSMessage(
  msg: ClientMessage,
  client: WSClient,
  pool: SessionPool,
  clients: Map<string, WSClient>,
  broadcast: (sessionFile: string, message: ServerMessage, excludeId?: string) => void,
  onSessionsUpdated: () => void,
): Promise<void> {
  switch (msg.type) {
    case 'cli_register': {
      client.isCliBridge = true;
      client.sessionId = msg.sessionFile;
      const result = await pool.registerCliSession(msg.sessionFile, msg.cwd, msg.model || '', client.ws, msg.isStreaming === true);
      if (result.error) {
        sendWS(client.ws, { type: 'session_error', error: result.error });
      } else {
        console.log(`Registered CLI Bridge for session ${msg.sessionFile} at ${msg.cwd}`);
        onSessionsUpdated();
        const sId = result.tracked.sessionId;

        // The CLI just took over a session the server was running MID-TURN, so
        // registering disposed that server-side agent and discarded the in-flight
        // turn. Tell the CLI explicitly so it can surface the takeover: its own
        // dangling-tool-call heuristic reads the persisted transcript, which
        // never captured a still-streaming (unpersisted) turn, so it cannot
        // detect the streaming-text case on its own. Symmetric with the web
        // client's session_notice below.
        if (result.interruptedTurn) {
          sendWS(client.ws, {
            type: 'cli_takeover_interrupted',
            sessionId: sId,
            toolCall: result.interruptedToolCall === true,
          });
        }
        const msgToWeb: ServerMessage = {
          type: 'session_created',
          sessionId: sId,
          sessionFile: msg.sessionFile,
          cwd: msg.cwd,
          model: msg.model || '',
          isStreaming: pool.isStreaming(msg.sessionFile),
        };
        for (const c of clients.values()) {
          if (c.sessionId === msg.sessionFile && !c.isCliBridge) {
            sendWS(c.ws, msgToWeb);
            const history = pool.getSessionHistoryWindow(msg.sessionFile, INITIAL_HISTORY_LIMIT);
            sendWS(c.ws, {
              type: 'message_history',
              sessionId: sId,
              messages: history.messages,
              totalCount: history.totalCount,
              offset: history.offset,
            });
            // The CLI took control of this session. If the server agent was
            // MID-TURN, disposing it above discarded that in-flight turn without
            // persisting it, so the web viewer who was watching it lost it
            // silently. Warn, tailoring the wording to what was lost: a running
            // tool call (its result never arrives) vs a streaming assistant
            // reply (the partial text is discarded).
            if (result.interruptedTurn) {
              const lost = result.interruptedToolCall
                ? 'a tool call was running. That tool call was interrupted and its result will not appear here.'
                : 'a reply was streaming. That in-progress reply was interrupted here and will not be saved.';
              const message =
                `A terminal (CLI) took over this session while ${lost} ` +
                'The CLI now controls this session: anything you send from here is relayed to it. ' +
                'The web frontend regains control only once that CLI disconnects.';
              sendWS(c.ws, {
                type: 'session_notice',
                sessionId: sId,
                level: 'warning',
                message,
              });
            }
          }
        }
      }
      break;
    }

    case 'cli_event': {
      if (!client.isCliBridge || !client.sessionId) return;
      pool.handleCliEvent(client.sessionId, msg.event);
      break;
    }

    case 'connect':
      break;

    case 'ping':
      sendWS(client.ws, { type: 'pong', timestamp: Date.now() });
      break;

    case 'session_load': {
      // FAST-FIRST session load (docs/plan-speed-up-long-session-load.md):
      // 1. Cheap read of header + history (no agent build). Paint the
      //    conversation immediately so opening a session to READ is instant even
      //    for a cold, idle-evicted session with huge files.
      // 2. Build the live agent (createAgentSession -> extension/MCP load, the
      //    seconds-long part) ASYNC, then signal session_ready so the composer
      //    enables. Sending needs the live agent; reading does not.
      const meta = await pool.readSessionMeta(msg.sessionFile, INITIAL_HISTORY_LIMIT, msg.model);
      if ('error' in meta) {
        sendWS(client.ws, { type: 'session_error', error: meta.error });
        return;
      }

      // Conflict detection is cheap (in-memory pool scan) and must happen before
      // we claim the session for this client.
      const conflict = pool.detectConflict(meta.sessionFile, meta.cwd);
      if (conflict.conflict && conflict.otherSessionId) {
        sendWS(client.ws, {
          type: 'session_conflict',
          sessionId: meta.sessionId,
          conflictingSession: conflict.otherSessionId!,
          conflictingCwd: conflict.otherCwd!,
        });
        return;
      }

      // A session whose cwd matches a sessions.readOnly glob is forced read-only.
      const forcedReadOnly = meta.readOnly;
      client.readOnly = forcedReadOnly;

      // Paint immediately. `pending` is true when the live agent is not resident
      // yet, so the client keeps the composer disabled (with a "preparing
      // agent..." hint) until session_ready, while reading/scrolling work now.
      sendWS(client.ws, {
        type: 'session_created',
        sessionId: meta.sessionId,
        sessionFile: meta.sessionFile,
        cwd: meta.cwd,
        model: meta.model,
        isStreaming: meta.resident ? pool.isStreaming(meta.sessionFile) : false,
        readOnly: forcedReadOnly,
        contextUsage: meta.resident ? (pool.getContextUsage(meta.sessionFile) ?? null) : null,
        pending: !meta.resident,
      });
      sendWS(client.ws, {
        type: 'message_history',
        sessionId: meta.sessionId,
        messages: meta.history.messages,
        totalCount: meta.history.totalCount,
        offset: meta.history.offset,
      });

      // Already resident (warm): attach immediately, no async build needed.
      if (meta.resident) {
        pool.addClient(meta.sessionFile, client.id);
        switchClientSession(client, meta.sessionFile, pool, onSessionsUpdated);
        client.readOnly = forcedReadOnly;
        sendWS(client.ws, {
          type: 'session_ready',
          sessionId: meta.sessionId,
          sessionFile: meta.sessionFile,
          model: meta.model,
          isStreaming: pool.isStreaming(meta.sessionFile),
          contextUsage: pool.getContextUsage(meta.sessionFile) ?? null,
        });
        break;
      }

      // Cold: build the live agent in the background, then attach + signal ready.
      // Errors degrade to a session_error (the conversation stays readable).
      void (async () => {
        const result = await pool.loadSession(msg.sessionFile, msg.cwd, msg.model);
        if (result.error) {
          sendWS(client.ws, { type: 'session_error', sessionId: meta.sessionId, error: result.error });
          return;
        }
        // The socket may have gone away while the agent was building.
        if (client.ws.readyState !== client.ws.OPEN) {
          // Nobody to attach; let idle eviction reclaim the freshly built session.
          pool.scheduleIdleCheck(result.tracked.sessionFile);
          return;
        }
        pool.addClient(result.tracked.sessionFile, client.id);
        switchClientSession(client, result.tracked.sessionFile, pool, onSessionsUpdated);
        client.readOnly = pool.isReadOnlyCwd(result.tracked.cwd);
        sendWS(client.ws, {
          type: 'session_ready',
          sessionId: result.tracked.sessionId,
          sessionFile: result.tracked.sessionFile,
          model: result.tracked.model,
          isStreaming: pool.isStreaming(result.tracked.sessionFile),
          contextUsage: pool.getContextUsage(result.tracked.sessionFile) ?? null,
        });
      })();
      break;
    }

    case 'history_load_more': {
      // Lazily fetch an older window of history for the client's active session.
      const targetFile = client.sessionId;
      if (!targetFile) return;
      const tracked = pool.getSession(targetFile);
      if (!tracked) return;
      const window = pool.getSessionHistoryWindow(
        targetFile,
        HISTORY_PAGE_SIZE,
        msg.beforeOffset,
      );
      sendWS(client.ws, {
        type: 'message_history_prepend',
        sessionId: tracked.sessionId,
        messages: window.messages,
        offset: window.offset,
      });
      break;
    }

    case 'session_new': {
      const existing = pool.findActiveSessionByCwd(msg.cwd);
      const hasOtherClients = existing && (
        existing.clients.size > 1 || 
        (existing.clients.size === 1 && !existing.clients.has(client.id))
      );
      if (hasOtherClients && existing) {
        sendWS(client.ws, {
          type: 'session_conflict',
          sessionId: '',
          conflictingSession: existing.sessionId,
          conflictingCwd: existing.cwd,
        });
        return;
      }

      // If the client is currently associated with the existing session in this CWD and wants to start a fresh new one,
      // let's switch their session to null first so that the existing session has 0 clients. This ensures
      // pool.createNewSession will create a brand new session instead of returning the existing one.
      if (existing && existing.clients.has(client.id)) {
        switchClientSession(client, null, pool, onSessionsUpdated);
      }

      const result = await pool.createNewSession(msg.cwd, msg.model, msg.gitInit, msg.createRemote, msg.repoVisibility);
      if (result.error) {
        sendWS(client.ws, { type: 'session_error', error: result.error });
        return;
      }

      pool.addClient(result.tracked.sessionFile, client.id);
      switchClientSession(client, result.tracked.sessionFile, pool, onSessionsUpdated);
      client.readOnly = false;

      sendWS(client.ws, {
        type: 'session_created',
        sessionId: result.tracked.sessionId,
        sessionFile: result.tracked.sessionFile,
        cwd: result.tracked.cwd,
        model: result.tracked.model,
        isStreaming: pool.isStreaming(result.tracked.sessionFile),
      });

      sendWS(client.ws, {
        type: 'message_history',
        sessionId: result.tracked.sessionId,
        messages: [],
      });
      break;
    }

    case 'session_leave': {
      if (client.sessionId) {
        switchClientSession(client, null, pool, onSessionsUpdated);
        client.readOnly = false;
      }
      break;
    }

    case 'session_resolve_conflict': {
      let tracked = pool.getSession(msg.sessionId);
      const isNewSessionConflict = !msg.sessionId;

      // For new sessions, targetSessionId is empty; find by cwd
      const existingTracked = tracked || (msg.cwd ? pool.findActiveSessionByCwd(msg.cwd) : null);

      if (existingTracked) {
        if (msg.action === 'take_over') {
          const interrupted = await pool.takeOver(existingTracked.cwd, msg.sessionId);
          for (const intClientId of interrupted) {
            // Do not interrupt the current client itself if we are creating a new session
            if (isNewSessionConflict && intClientId === client.id) continue;

            const intClient = clients.get(intClientId);
            if (intClient) {
              sendWS(intClient.ws, {
                type: 'session_interrupted',
                sessionId: intClient.sessionId || '',
                reason: isNewSessionConflict
                  ? 'Another client started a new session in this folder'
                  : 'Another client took over this folder',
              });
              switchClientSession(intClient, null, pool, onSessionsUpdated);
            }
          }

          if (isNewSessionConflict) {
            // Create a brand-new session as requested!
            const result = await pool.createNewSession(msg.cwd!, undefined);
            if (result.error) {
              sendWS(client.ws, { type: 'session_error', error: result.error });
              return;
            }

            pool.addClient(result.tracked.sessionFile, client.id);
            switchClientSession(client, result.tracked.sessionFile, pool, onSessionsUpdated);
            client.readOnly = false;

            sendWS(client.ws, {
              type: 'session_created',
              sessionId: result.tracked.sessionId,
              sessionFile: result.tracked.sessionFile,
              cwd: result.tracked.cwd,
              model: result.tracked.model,
              isStreaming: pool.isStreaming(result.tracked.sessionFile),
            });

            sendWS(client.ws, {
              type: 'message_history',
              sessionId: result.tracked.sessionId,
              messages: [],
            });
          } else if (tracked) {
            // Join the existing session
            pool.addClient(tracked.sessionFile, client.id);
            switchClientSession(client, tracked.sessionFile, pool, onSessionsUpdated);
            client.readOnly = false;

            sendWS(client.ws, {
              type: 'session_created',
              sessionId: tracked.sessionId,
              sessionFile: tracked.sessionFile,
              cwd: tracked.cwd,
              model: tracked.model,
              isStreaming: pool.isStreaming(tracked.sessionFile),
            });

            const history = pool.getSessionHistoryWindow(tracked.sessionFile, INITIAL_HISTORY_LIMIT);
            sendWS(client.ws, {
              type: 'message_history',
              sessionId: tracked.sessionId,
              messages: history.messages,
              totalCount: history.totalCount,
              offset: history.offset,
            });
          }
        } else {
          // Join the existing session as read-only
          pool.addClient(existingTracked.sessionFile, client.id);
          switchClientSession(client, existingTracked.sessionFile, pool, onSessionsUpdated);
          client.readOnly = true;

          sendWS(client.ws, {
            type: 'session_created',
            sessionId: existingTracked.sessionId,
            sessionFile: existingTracked.sessionFile,
            cwd: existingTracked.cwd,
            model: existingTracked.model,
            isStreaming: pool.isStreaming(existingTracked.sessionFile),
          });

          const history = pool.getSessionHistoryWindow(existingTracked.sessionFile, INITIAL_HISTORY_LIMIT);
          sendWS(client.ws, {
            type: 'message_history',
            sessionId: existingTracked.sessionId,
            messages: history.messages,
            totalCount: history.totalCount,
            offset: history.offset,
          });
        }
      }
      break;
    }

    case 'message': {
      if (!client.sessionId) return;
      if (client.readOnly) return;
      const streaming = pool.isStreaming(client.sessionId);
      await pool.sendUserMessage(client.sessionId, msg.message, streaming ? 'steer' : undefined);
      break;
    }

    case 'abort': {
      if (!client.sessionId) return;
      await pool.abortSession(client.sessionId);
      break;
    }

    case 'model_change': {
      if (!client.sessionId) return;
      const result = await pool.changeModel(client.sessionId, msg.model);
      if (result.error) {
        sendWS(client.ws, { type: 'session_error', error: result.error });
      } else {
        const tracked = pool.getSession(client.sessionId);
        const sId = tracked?.sessionId || '';
        const modelChangedMsg: ServerMessage = { type: 'model_changed', sessionId: sId, model: msg.model };
        for (const c of clients.values()) {
          if (c.sessionId === client.sessionId) {
            sendWS(c.ws, modelChangedMsg);
          }
        }
      }
      break;
    }

    case 'file_upload': {
      const { uploadId, sessionId, filename, data } = msg as any;
      if (!uploadId || !sessionId || !filename || !data) {
        sendWS(client.ws, {
          type: 'file_upload_error',
          uploadId: uploadId || '',
          sessionId: sessionId || '',
          error: 'Missing parameters for file upload'
        });
        break;
      }

      try {
        const tracked = pool.getSession(sessionId);
        const cwd = tracked?.cwd;

        const config = getWhereverConfig();
        const targetDir = resolveUploadDir(config, cwd);

        fs.mkdirSync(targetDir, { recursive: true });

        const timestamp = Date.now();
        const safeFilename = `${timestamp}_${path.basename(filename)}`;
        const destPath = path.join(targetDir, safeFilename);

        const fileBuffer = Buffer.from(data, 'base64');
        fs.writeFileSync(destPath, fileBuffer);

        sendWS(client.ws, {
          type: 'file_uploaded',
          uploadId,
          sessionId,
          filename,
          savedPath: destPath
        });
      } catch (err) {
        sendWS(client.ws, {
          type: 'file_upload_error',
          uploadId,
          sessionId,
          error: (err as Error).message || 'Failed to save file'
        });
      }
      break;
    }
  }
}

/**
 * Extract image blocks from a tool result so the web frontend can render them
 * inline (mirroring the CLI's inline image display). The `read` tool returns
 * `{ content: [{type:'text',...},{type:'image', data, mimeType}] }` for image
 * files; `extractToolResult` keeps only text, so image blocks are pulled out
 * here and shipped separately as base64.
 */
function extractToolImages(event: any): ToolImage[] {
  const result = event?.result;
  if (!result || typeof result !== 'object') return [];
  const content = (result as any).content;
  if (!Array.isArray(content)) return [];
  const images: ToolImage[] = [];
  for (const c of content) {
    if (c && c.type === 'image' && typeof c.data === 'string' && c.data) {
      images.push({ mimeType: typeof c.mimeType === 'string' ? c.mimeType : 'image/png', data: c.data });
    }
  }
  return images;
}

function extractToolResult(event: any): string {
  const result = event.result;
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    if (result.content) {
      if (typeof result.content === 'string') return result.content;
      if (Array.isArray(result.content)) {
        return result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text || '')
          .join('\n');
      }
    }
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

function extractText(msg: any): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text || '')
      .join('\n');
  }
  return '';
}

/**
 * Resolve this package's version from its package.json, which sits next to the
 * compiled entrypoint (`dist/index.js` -> `../package.json`). Read at runtime so
 * it stays correct for the installed package regardless of how it was launched
 * (npm, Volta shim, absolute service path). Falls back to 'unknown' if the file
 * cannot be read.
 */
function getVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Subcommand dispatch. Every action is an explicit verb:
 *   - `wherever start [server flags]` runs the server
 *   - `wherever install|uninstall|service-status` manage the background service
 *   - `wherever --version` (or `-v` / `version`) prints the version
 *   - bare `wherever` (or `help`) prints usage
 * Server flags after `start` are consumed by parseArgs() (which reads
 * process.argv), so `start` is stripped from argv before main() runs.
 */
function dispatch(): void {
  const argv = process.argv.slice(2);
  const verb = argv[0];
  const rest = argv.slice(1);

  switch (verb) {
    case 'start':
      // Drop the `start` verb so the existing flag parser sees only server
      // flags (it reads process.argv directly).
      process.argv.splice(2, 1);
      main().catch((err) => {
        console.error('Fatal server startup error:', err);
        process.exit(1);
      });
      return;
    case 'install':
      runInstall(parseInstallOptions(rest));
      return;
    case 'uninstall':
      runUninstall(parseInstallOptions(rest));
      return;
    case 'service-status':
    case 'status':
      runServiceStatus(parseInstallOptions(rest));
      return;
    case 'version':
    case '--version':
    case '-v':
      console.log(getVersion());
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printInstallHelp();
      return;
    default:
      console.error(`Unknown command: ${verb}\n`);
      printInstallHelp();
      process.exit(1);
  }
}

dispatch();

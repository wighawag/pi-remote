#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { SessionPool, getPiRemoteConfig } from './session-pool.js';
import type { ClientMessage, ServerMessage } from './protocol.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync } from 'node:child_process';

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
    '.wasm': 'application/wasm'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end(`Server Error: ${err.code}`);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
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

function parseArgs(): { port: number; host: string; token?: string; idleTimeout: number; sslKey?: string; sslCert?: string; noSsl: boolean } {
  const args = process.argv.slice(2);
  let port = parseInt(process.env.PI_REMOTE_PORT || '8765', 10);
  let host = process.env.PI_REMOTE_HOST || '127.0.0.1';
  let token = process.env.PI_REMOTE_TOKEN || undefined;
  let idleTimeout = parseInt(process.env.PI_IDLE_TIMEOUT || '300000', 10);
  let sslKey = process.env.PI_REMOTE_SSL_KEY || undefined;
  let sslCert = process.env.PI_REMOTE_SSL_CERT || undefined;
  let noSsl = process.env.PI_REMOTE_NO_SSL === 'true' || process.env.PI_REMOTE_HTTP === 'true';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        port = parseInt(args[++i] || '8765', 10);
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
    }
  }

  return { port, host, token, idleTimeout, sslKey, sslCert, noSsl };
}

function authenticate(req: IncomingMessage, token?: string): boolean {
  if (!token) return true;
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const provided = url.searchParams.get('token') || req.headers.authorization?.replace('Bearer ', '') || '';
  return provided === token;
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
  const { port, host, token, idleTimeout, sslKey, sslCert, noSsl } = parseArgs();
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
      const certsDir = path.join(homeDir, '.pi', 'remote', 'certs');
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
      case 'tool_execution_start':
        msg = { type: 'tool_start', sessionId, toolName: event.toolName, args: event.args };
        break;
      case 'tool_execution_end':
        const toolResult = extractToolResult(event as any);
        msg = { type: 'tool_end', sessionId, toolName: event.toolName, isError: event.isError, result: toolResult };
        break;
    }

    if (msg) {
      for (const c of clients.values()) {
        if (c.sessionId === sessionFile) {
          sendWS(c.ws, msg);
        }
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
                          pathname.startsWith('/session/');

    if (isApiRequest && !authenticate(req, token)) {
      sendJSON(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (pathname === '/sessions' && req.method === 'GET') {
      const folders = await sessionPool.listSessions();
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
      const config = getPiRemoteConfig();
      sendJSON(res, 200, { gitInitDefault: !!config.gitInitDefault });
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
      const config = getPiRemoteConfig();
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

    serveStaticFile(pathname, res);
  };

  let server;
  let isSecureServer = false;
  if (isSecure && actualSslKey && actualSslCert) {
    try {
      const options = {
        key: fs.readFileSync(actualSslKey),
        cert: fs.readFileSync(actualSslCert),
      };
      server = createHttpsServer(options, requestHandler);
      isSecureServer = true;
    } catch (err) {
      console.error(`Failed to load SSL certificates from ${actualSslKey} and ${actualSslCert}. Falling back to HTTP.`, (err as Error).message);
      server = createHttpServer(requestHandler);
    }
  } else {
    server = createHttpServer(requestHandler);
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
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
  });

  wss.on('connection', (ws) => {
    const clientId = generateId();
    const client: WSClient = {
      id: clientId,
      ws,
      sessionId: null,
      readOnly: false,
    };
    clients.set(clientId, client);

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
        await handleWSMessage(msg, client, sessionPool, clients, broadcastToSession);
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
      }
      clients.delete(clientId);
    });

    ws.on('error', (err) => {
      console.error(`WS error for ${clientId}:`, err.message);
    });
  });

  server.listen(port, host, () => {
    const protocol = isSecureServer ? 'https' : 'http';
    const authInfo = token ? ' (token-protected)' : ' (no authentication)';
    console.log(`\n🔐 Pi Remote Server: ${protocol}://${host}:${port}${authInfo}`);

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

  server.on('error', (err) => {
    console.error('Server error:', err.message);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
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

function switchClientSession(client: WSClient, newSessionFile: string | null, pool: SessionPool) {
  if (client.sessionId && client.sessionId !== newSessionFile) {
    pool.removeClient(client.sessionId, client.id);
  }
  client.sessionId = newSessionFile;
}

async function handleWSMessage(
  msg: ClientMessage,
  client: WSClient,
  pool: SessionPool,
  clients: Map<string, WSClient>,
  broadcast: (sessionFile: string, message: ServerMessage, excludeId?: string) => void,
): Promise<void> {
  switch (msg.type) {
    case 'cli_register': {
      client.isCliBridge = true;
      client.sessionId = msg.sessionFile;
      const result = await pool.registerCliSession(msg.sessionFile, msg.cwd, msg.model || '', client.ws);
      if (result.error) {
        sendWS(client.ws, { type: 'session_error', error: result.error });
      } else {
        console.log(`Registered CLI Bridge for session ${msg.sessionFile} at ${msg.cwd}`);
        const sId = result.tracked.sessionId;
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
            const history = pool.getSessionHistory(msg.sessionFile);
            sendWS(c.ws, {
              type: 'message_history',
              sessionId: sId,
              messages: history,
            });
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
      const result = await pool.loadSession(msg.sessionFile, msg.cwd, msg.model);
      if (result.error) {
        sendWS(client.ws, { type: 'session_error', error: result.error });
        return;
      }

      const conflict = pool.detectConflict(result.tracked.sessionFile, result.tracked.cwd);
      if (conflict.conflict && conflict.otherSessionId) {
        sendWS(client.ws, {
          type: 'session_conflict',
          sessionId: result.tracked.sessionId,
          conflictingSession: conflict.otherSessionId!,
          conflictingCwd: conflict.otherCwd!,
        });
        return;
      }

      pool.addClient(result.tracked.sessionFile, client.id);
      switchClientSession(client, result.tracked.sessionFile, pool);
      client.readOnly = false;

      sendWS(client.ws, {
        type: 'session_created',
        sessionId: result.tracked.sessionId,
        sessionFile: result.tracked.sessionFile,
        cwd: result.tracked.cwd,
        model: result.tracked.model,
        isStreaming: pool.isStreaming(result.tracked.sessionFile),
      });

      const history = pool.getSessionHistory(result.tracked.sessionFile);
      sendWS(client.ws, {
        type: 'message_history',
        sessionId: result.tracked.sessionId,
        messages: history,
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

      const result = await pool.createNewSession(msg.cwd, msg.model, msg.gitInit, msg.createRemote, msg.repoVisibility);
      if (result.error) {
        sendWS(client.ws, { type: 'session_error', error: result.error });
        return;
      }

      pool.addClient(result.tracked.sessionFile, client.id);
      switchClientSession(client, result.tracked.sessionFile, pool);
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
        switchClientSession(client, null, pool);
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
              switchClientSession(intClient, null, pool);
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
            switchClientSession(client, result.tracked.sessionFile, pool);
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
            switchClientSession(client, tracked.sessionFile, pool);
            client.readOnly = false;

            sendWS(client.ws, {
              type: 'session_created',
              sessionId: tracked.sessionId,
              sessionFile: tracked.sessionFile,
              cwd: tracked.cwd,
              model: tracked.model,
              isStreaming: pool.isStreaming(tracked.sessionFile),
            });

            const history = pool.getSessionHistory(tracked.sessionFile);
            sendWS(client.ws, {
              type: 'message_history',
              sessionId: tracked.sessionId,
              messages: history,
            });
          }
        } else {
          // Join the existing session as read-only
          pool.addClient(existingTracked.sessionFile, client.id);
          switchClientSession(client, existingTracked.sessionFile, pool);
          client.readOnly = true;

          sendWS(client.ws, {
            type: 'session_created',
            sessionId: existingTracked.sessionId,
            sessionFile: existingTracked.sessionFile,
            cwd: existingTracked.cwd,
            model: existingTracked.model,
            isStreaming: pool.isStreaming(existingTracked.sessionFile),
          });

          const history = pool.getSessionHistory(existingTracked.sessionFile);
          sendWS(client.ws, {
            type: 'message_history',
            sessionId: existingTracked.sessionId,
            messages: history,
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
  }
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

main().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});

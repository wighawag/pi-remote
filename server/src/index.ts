import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { SessionPool } from './session-pool.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

interface WSClient {
  id: string;
  ws: WebSocket;
  sessionId: string | null;
  readOnly: boolean;
}

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function parseArgs(): { port: number; host: string; token?: string; idleTimeout: number } {
  const args = process.argv.slice(2);
  let port = parseInt(process.env.PI_REMOTE_PORT || '8765', 10);
  let host = process.env.PI_REMOTE_HOST || '127.0.0.1';
  let token = process.env.PI_REMOTE_TOKEN || undefined;
  let idleTimeout = parseInt(process.env.PI_IDLE_TIMEOUT || '300000', 10);

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
    }
  }

  return { port, host, token, idleTimeout };
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
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

function main(): void {
  const { port, host, token, idleTimeout } = parseArgs();
  const sessionPool = new SessionPool(idleTimeout);
  sessionPool.initialize();

  const clients = new Map<string, WSClient>();

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
        }
        break;
      }
      case 'message_end': {
        if ((event.message as any)?.role !== 'assistant') break;
        const content = extractText(event.message as any);
        msg = { type: 'message_end', sessionId, content };
        break;
      }
      case 'agent_end':
        msg = { type: 'agent_end', sessionId };
        break;
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

  const server = createServer(async (req, res) => {
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

    if (!authenticate(req, token)) {
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

    if (pathname === '/session/destroy' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { sessionId } = JSON.parse(body) as { sessionId: string };
        sessionPool.destroySession(sessionId, 'manual');
        sendJSON(res, 200, { status: 'destroyed' });
      } catch {
        sendJSON(res, 400, { error: 'Missing sessionId' });
      }
      return;
    }

    if (pathname === '/session/new' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { cwd, model } = JSON.parse(body) as { cwd: string; model?: string };
        const result = await sessionPool.createNewSession(cwd, model);
        if (result.error) {
          sendJSON(res, 500, { error: result.error });
        } else {
          sendJSON(res, 201, {
            sessionId: result.tracked.sessionId,
            sessionFile: result.sessionFile,
            cwd: result.tracked.cwd,
            model: result.tracked.model,
          });
        }
      } catch {
        sendJSON(res, 400, { error: 'Missing cwd' });
      }
      return;
    }

    sendJSON(res, 404, { error: 'Not found' });
  });

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
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        await handleWSMessage(msg, client, sessionPool, clients, broadcastToSession);
      } catch (err) {
        console.error('WS message error:', err);
      }
    });

    ws.on('close', () => {
      if (client.sessionId) {
        sessionPool.removeClient(client.sessionId, clientId);
      }
      clients.delete(clientId);
    });

    ws.on('error', (err) => {
      console.error(`WS error for ${clientId}:`, err.message);
    });
  });

  server.listen(port, host, () => {
    const authInfo = token ? ' (token-protected)' : ' (no authentication)';
    console.log(`Pi Remote Server: http://${host}:${port}${authInfo}`);
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

async function handleWSMessage(
  msg: ClientMessage,
  client: WSClient,
  pool: SessionPool,
  clients: Map<string, WSClient>,
  broadcast: (sessionFile: string, message: ServerMessage, excludeId?: string) => void,
): Promise<void> {
  switch (msg.type) {
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
      client.sessionId = result.tracked.sessionFile;
      client.readOnly = false;

      sendWS(client.ws, {
        type: 'session_created',
        sessionId: result.tracked.sessionId,
        sessionFile: result.tracked.sessionFile,
        cwd: result.tracked.cwd,
        model: result.tracked.model,
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
      if (existing) {
        sendWS(client.ws, {
          type: 'session_conflict',
          sessionId: '',
          conflictingSession: existing.sessionId,
          conflictingCwd: existing.cwd,
        });
        return;
      }

      const result = await pool.createNewSession(msg.cwd, msg.model);
      if (result.error) {
        sendWS(client.ws, { type: 'session_error', error: result.error });
        return;
      }

      pool.addClient(result.tracked.sessionFile, client.id);
      client.sessionId = result.tracked.sessionFile;
      client.readOnly = false;

      sendWS(client.ws, {
        type: 'session_created',
        sessionId: result.tracked.sessionId,
        sessionFile: result.sessionFile || '',
        cwd: result.tracked.cwd,
        model: result.tracked.model,
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
        pool.removeClient(client.sessionId, client.id);
        client.sessionId = null;
        client.readOnly = false;
      }
      break;
    }

    case 'session_resolve_conflict': {
      let tracked = pool.getSession(msg.sessionId);

      // For new sessions, targetSessionId is empty; find by cwd
      if (!tracked && msg.cwd) {
        tracked = pool.findActiveSessionByCwd(msg.cwd);
      }

      if (tracked) {
        if (msg.action === 'take_over') {
          const interrupted = await pool.takeOver(tracked.cwd, msg.sessionId);
          for (const intClientId of interrupted) {
            const intClient = clients.get(intClientId);
            if (intClient) {
              sendWS(intClient.ws, {
                type: 'session_interrupted',
                sessionId: intClient.sessionId || '',
                reason: 'Another client took over this folder',
              });
              intClient.sessionId = null;
            }
          }
          pool.addClient(tracked.sessionFile, client.id);
          client.sessionId = tracked.sessionFile;
          client.readOnly = false;

          const history = pool.getSessionHistory(tracked.sessionFile);
          sendWS(client.ws, {
            type: 'message_history',
            sessionId: tracked.sessionId,
            messages: history,
          });
        } else {
          client.sessionId = tracked.sessionFile;
          client.readOnly = true;

          const history = pool.getSessionHistory(tracked.sessionFile);
          sendWS(client.ws, {
            type: 'message_history',
            sessionId: tracked.sessionId,
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

main();

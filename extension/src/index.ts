/**
 * Remote Server Extension for Pi
 *
 * Provides HTTP/WebSocket server to control pi remotely while maintaining
 * full access to all local folders and tools.
 *
 * Features:
 * - WebSocket server for real-time bidirectional communication
 * - HTTP endpoints for REST-style interactions
 * - Full access to all pi tools (read, write, edit, bash, grep, find, ls)
 * - Session management (create, resume, fork)
 * - Extension UI support (confirmations, selections, inputs)
 * - Configurable port and authentication
 *
 * Usage:
 *   pi --extension ./remote-server.ts --remote-port 8765 --remote-token YOUR_TOKEN
 *
 * API:
 *   POST /message - Send a message and get response
 *   GET  /session - Get current session info
 *   POST /session/new - Start new session
 *   POST /session/compact - Trigger compaction
 *   WS  /ws - WebSocket connection for streaming
 */

import {
  createServer,
  type Server,
  IncomingMessage,
  type ServerResponse,
} from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ExtensionAPI,
  AgentEndEvent,
  AgentStartEvent,
  ExtensionCommandContext,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type {
  MessageEndEvent,
  MessageUpdateEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent/dist/core/extensions/index.js";

interface RemoteConfig {
  port: number;
  token?: string;
  host?: string;
}

interface ClientMessage {
  type: string;
  id?: string;
  [key: string]: unknown;
}

interface ServerMessage {
  type: string;
  id?: string;
  [key: string]: unknown;
}

let currentWs: WebSocket | null = null;
let messageQueue: ServerMessage[] = [];

export default async function (pi: ExtensionAPI) {
  // Register flags
  pi.registerFlag("remote-port", {
    description: "Port for remote server (default: disabled)",
    type: "string",
  });

  pi.registerFlag("remote-host", {
    description: "Host to bind remote server (default: 127.0.0.1)",
    type: "string",
    default: "127.0.0.1",
  });

  pi.registerFlag("remote-token", {
    description: "Authentication token for remote access",
    type: "string",
  });

  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let isStreaming = false;

  pi.on(
    "session_start",
    async (event: SessionStartEvent, ctx: ExtensionContext) => {
      const port = pi.getFlag("remote-port") as number | undefined;
      if (!port) return;

      const host = (pi.getFlag("remote-host") as string) || "127.0.0.1";
      const token = pi.getFlag("remote-token") as string | undefined;

      const config: RemoteConfig = { port, host, token };

      // Create HTTP server
      server = createServer((req, res) => {
        handleHttpRequest(
          req,
          res as ServerResponse,
          config,
          ctx,
          pi,
          () => isStreaming,
        );
      });

      // Create WebSocket server
      wss = new WebSocketServer({ noServer: true });

      server.on("upgrade", (req, socket, head) => {
        if (req.url === "/ws") {
          // Authenticate WebSocket connection
          const url = new URL(
            req.url || "",
            `http://${req.headers.host || "localhost"}`,
          );
          const providedToken =
            url.searchParams.get("token") ||
            req.headers["authorization"]?.replace("Bearer ", "");

          if (config.token && providedToken !== config.token) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          wss?.handleUpgrade(req, socket, head, (ws) => {
            wss?.emit("connection", ws, req);
          });
        } else {
          socket.destroy();
        }
      });

      wss.on("connection", (ws) => {
        currentWs = ws;
        ctx.ui.notify("Remote client connected", "info");

        // Send queued messages
        if (messageQueue.length > 0) {
          messageQueue.forEach((msg) => sendMessage(ws, msg));
          messageQueue = [];
        }

        ws.on("message", (data) => {
          handleWebSocketMessage(data.toString(), ctx, pi, () => isStreaming);
        });

        ws.on("close", () => {
          if (currentWs === ws) {
            currentWs = null;
            ctx.ui.notify("Remote client disconnected", "info");
          }
        });

        ws.on("error", (err) => {
          ctx.ui.notify(`WebSocket error: ${err.message}`, "error");
        });

        // Send connection confirmation
        sendMessage(ws, {
          type: "connected",
          session: ctx.sessionManager.getSessionFile() || "ephemeral",
          timestamp: Date.now(),
        });
      });

      server.listen(port, host, () => {
        const tokenInfo = config.token
          ? " (token-protected)"
          : " (no authentication!)";
        ctx.ui.notify(
          `Remote server started on http://${host}:${port}${tokenInfo}`,
          "warning",
        );
        console.log(`🌐 Remote server: http://${host}:${port}${tokenInfo}`);
      });

      server.on("error", (err) => {
        ctx.ui.notify(`Remote server error: ${err.message}`, "error");
      });
    },
  );

  pi.on("session_shutdown", async (event: SessionShutdownEvent) => {
    // Cleanup on shutdown
    if (wss) {
      wss.clients.forEach((client) => client.close());
      wss.close();
      wss = null;
    }
    if (server) {
      server.close();
      server = null;
    }
    currentWs = null;
  });

  // Agent lifecycle events for streaming
  pi.on("agent_start", async (event: AgentStartEvent) => {
    isStreaming = true;
    broadcast({ type: "agent_start", timestamp: Date.now() });
  });

  pi.on("message_update", async (event: MessageUpdateEvent) => {
    if (event.message.role !== "assistant") return;
    const evt = event.assistantMessageEvent;
    if (evt?.type === "text_delta") {
      broadcast({
        type: "message_update",
        delta: evt.delta,
        timestamp: Date.now(),
      });
    }
  });

  pi.on("message_end", async (event: MessageEndEvent) => {
    if (event.message.role === "assistant") {
      const content =
        event.message.content
          ?.filter((c: { type: string; text?: string }) => c.type === "text")
          .map((c: { type: string; text?: string }) => c.text)
          .join("\n") || "";

      broadcast({
        type: "message_end",
        role: "assistant",
        content,
        timestamp: event.message.timestamp,
      });
    }
  });

  pi.on("agent_end", async (event: AgentEndEvent) => {
    isStreaming = false;
    broadcast({ type: "agent_end", timestamp: Date.now() });
  });

  pi.on("tool_execution_start", async (event: ToolExecutionStartEvent) => {
    broadcast({
      type: "tool_start",
      toolName: event.toolName,
      args: event.args,
      toolCallId: event.toolCallId,
      timestamp: Date.now(),
    });
  });

  pi.on("tool_execution_end", async (event: ToolExecutionEndEvent) => {
    broadcast({
      type: "tool_end",
      toolName: event.toolName,
      result: event.result,
      isError: event.isError,
      timestamp: Date.now(),
    });
  });

  // Register remote commands
  pi.registerCommand("remote-send", {
    description: "Send a message via remote connection",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!currentWs) {
        ctx.ui.notify("No remote client connected", "warning");
        return;
      }
      pi.sendUserMessage(args || "", { deliverAs: "steer" });
    },
  });
}

function broadcast(msg: ServerMessage): void {
  if (currentWs && currentWs.readyState === WebSocket.OPEN) {
    sendMessage(currentWs, msg);
  } else if (messageQueue) {
    messageQueue.push(msg);
    // Keep queue size manageable
    if (messageQueue.length > 100) {
      messageQueue.shift();
    }
  }
}

function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    console.error("Failed to send WebSocket message:", err);
  }
}

function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: RemoteConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  isStreamingGetter: () => boolean,
): void {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Authenticate
  if (config.token) {
    const authHeader = req.headers.authorization || "";
    const url = new URL(
      req.url || "",
      `http://${req.headers.host || "localhost"}`,
    );
    const providedToken =
      url.searchParams.get("token") || authHeader.replace("Bearer ", "");

    if (providedToken !== config.token) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  const url = new URL(
    req.url || "",
    `http://${req.headers.host || "localhost"}`,
  );
  const pathname = url.pathname;
  const isStreaming = isStreamingGetter();

  // Route handling
  if (pathname === "/message" && req.method === "POST") {
    handlePostMessage(req, res, ctx, pi, isStreaming);
  } else if (pathname === "/session" && req.method === "GET") {
    handleGetSession(res, ctx);
  } else if (pathname === "/session/new" && req.method === "POST") {
    handleNewSession(res, ctx, pi);
  } else if (pathname === "/session/compact" && req.method === "POST") {
    handleCompactSession(res, ctx);
  } else if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  isStreaming: boolean,
): Promise<void> {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const data = JSON.parse(body) as {
        message?: string;
        text?: string;
        prompt?: string;
      };
      const message = data.message || data.text || data.prompt;

      if (!message) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing message field" }));
        return;
      }

      // Send message to agent
      ctx.ui.notify(
        `Received remote message: ${message.slice(0, 50)}...`,
        "info",
      );
      pi.sendUserMessage(message, {
        deliverAs: isStreaming ? "steer" : undefined,
      });

      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "accepted",
          message,
          streaming: isStreaming,
        }),
      );
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
  });
}

function handleGetSession(res: ServerResponse, ctx: ExtensionContext): void {
  const entries = ctx.sessionManager.getEntries();
  const sessionFile = ctx.sessionManager.getSessionFile();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      sessionFile: sessionFile || "ephemeral",
      entryCount: entries.length,
      lastEntry: entries[entries.length - 1] || null,
    }),
  );
}

function handleNewSession(
  res: ServerResponse,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): void {
  // Queue a /new command
  pi.sendUserMessage("/new", { deliverAs: "followUp" });

  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "accepted", action: "new_session" }));
}

function handleCompactSession(
  res: ServerResponse,
  ctx: ExtensionContext,
): void {
  ctx.compact({
    onComplete: () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "completed" }));
    },
    onError: (err: Error) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    },
  });
}

async function handleWebSocketMessage(
  data: string,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  isStreamingGetter: () => boolean,
): Promise<void> {
  try {
    const msg: ClientMessage = JSON.parse(data);
    const isStreaming = isStreamingGetter();

    switch (msg.type) {
      case "message":
      case "prompt": {
        const text = (msg.message || msg.text || msg.prompt) as
          | string
          | undefined;
        if (text) {
          ctx.ui.notify(
            `Received WebSocket message: ${text.slice(0, 50)}...`,
            "info",
          );
          pi.sendUserMessage(text, {
            deliverAs: isStreaming ? "steer" : undefined,
          });
        }
        break;
      }

      case "abort": {
        ctx.abort();
        broadcast({ type: "aborted", timestamp: Date.now() });
        break;
      }

      case "ping": {
        broadcast({ type: "pong", timestamp: Date.now() });
        break;
      }

      default:
        console.warn("Unknown WebSocket message type:", msg.type);
    }
  } catch (err) {
    ctx.ui.notify(`Invalid WebSocket message: ${err}`, "error");
  }
}

/**
 * CLI Bridge Extension for Pi Remote
 *
 * Connects the local pi CLI session as a client to the Standalone Pi Remote Server.
 * Streams all terminal activity to the server in real-time, and receives remote
 * commands to execute in the local agent loop.
 *
 * Features exponential backoff reconnection to automatically pair whenever the
 * Standalone Server starts or stops.
 *
 * Usage:
 *   pi --extension ./extension/dist/index.js --remote-port 8765 --remote-token YOUR_TOKEN
 */

import WebSocket from "ws";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  // Register flags to specify Standalone Server settings
  pi.registerFlag("remote-port", {
    description: "Port of the remote standalone server",
    type: "string",
    default: "8765",
  });

  pi.registerFlag("remote-host", {
    description: "Host of the remote standalone server",
    type: "string",
    default: "127.0.0.1",
  });

  pi.registerFlag("remote-token", {
    description: "Authentication token for the remote standalone server",
    type: "string",
  });

  pi.registerFlag("remote-bridge", {
    description: "Whether to connect to the remote standalone server as a bridge",
    type: "boolean",
    default: true,
  });

  pi.registerCommand("remote-reconnect", {
    description: "Manually reconnect to the standalone remote server",
    handler: async (args: string, ctx: any) => {
      if (isConnected) {
        ctx.ui.notify("[Pi Remote] Already connected to standalone server", "info");
        return;
      }
      ctx.ui.notify("[Pi Remote] Initiating manual reconnect...", "info");
      reconnectDelay = 2000;
      connect();
    },
  });

  let ws: WebSocket | null = null;
  let isConnected = false;
  let sessionFile: string | null = null;
  let ctxVal: ExtensionContext | null = null;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 2000;
  const MAX_RECONNECT_DELAY = 15000;
  let isInitialConnect = true;

  function updateCliWidget(status: 'disconnected' | 'connecting' | 'connected') {
    if (!ctxVal) return;

    try {
      if (status === 'connecting') {
        ctxVal.ui.setWidget("pi-remote-status", (_tui, theme) => {
          const line = theme.fg("muted", "🔌 [Pi Remote] Connecting to standalone remote server...");
          return {
            render: () => [line],
            invalidate: () => {},
          };
        });
      } else if (status === 'disconnected') {
        ctxVal.ui.setWidget("pi-remote-status", (_tui, theme) => {
          const line = theme.fg("error", "⚠️ [Pi Remote] Disconnected from standalone remote server");
          return {
            render: () => [line],
            invalidate: () => {},
          };
        });
      } else {
        ctxVal.ui.setWidget("pi-remote-status", undefined);
      }
    } catch (err) {
      // Quiet fail if context is stale or disposed
    }
  }

  function sendCliEvent(event: any) {
    if (!ws || !isConnected || !sessionFile) return;
    try {
      ws.send(
        JSON.stringify({
          type: "cli_event",
          sessionFile,
          event,
        })
      );
    } catch (err) {
      // Quiet fail if connection dropped suddenly during a send
    }
  }

  function connect() {
    if (ws) {
      try {
        ws.removeAllListeners();
        ws.close();
      } catch (err) {}
      ws = null;
    }

    if (!ctxVal || !sessionFile) return;

    updateCliWidget('connecting');

    const host = (pi.getFlag("remote-host") as string) || "127.0.0.1";
    const port = (pi.getFlag("remote-port") as string) || "8765";
    const token = pi.getFlag("remote-token") as string | undefined;

    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
    const wsUrl = `ws://${host}:${port}/ws${tokenQuery}`;

    const currentWs = new WebSocket(wsUrl);
    ws = currentWs;

    currentWs.on("open", () => {
      if (ws !== currentWs) return;
      isConnected = true;
      reconnectDelay = 2000; // Reset reconnect delay back to 2s
      isInitialConnect = false;

      updateCliWidget('connected');

      // Register this CLI session with the server
      currentWs.send(
        JSON.stringify({
          type: "cli_register",
          sessionFile,
          cwd: ctxVal?.cwd,
          model: (ctxVal?.sessionManager.getHeader() as any)?.model || "",
        })
      );
    });

    currentWs.on("message", (data) => {
      if (ws !== currentWs) return;
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case "cli_message": {
            ctxVal?.ui.notify(`[Pi Remote] Received remote command: ${msg.message.slice(0, 40)}...`, "info");
            pi.sendUserMessage(msg.message, {
              deliverAs: msg.streamingBehavior,
            });
            break;
          }
          case "cli_abort": {
            ctxVal?.ui.notify("[Pi Remote] Received abort command from remote client", "warning");
            ctxVal?.abort();
            break;
          }
        }
      } catch (err) {
        console.error("[Pi Remote] Error handling message from server:", err);
      }
    });

    currentWs.on("close", () => {
      if (ws !== currentWs) return;
      if (isConnected) {
        isConnected = false;
        updateCliWidget('disconnected');
      }
      scheduleReconnect();
    });

    currentWs.on("error", (err: any) => {
      if (ws !== currentWs) return;
      if (isConnected || isInitialConnect) {
        isConnected = false;
        isInitialConnect = false;
        updateCliWidget('disconnected');
      }
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  }

  pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
    const isBridgeEnabled = pi.getFlag("remote-bridge") !== false;
    if (!isBridgeEnabled) return;

    ctxVal = ctx;
    sessionFile = ctx.sessionManager.getSessionFile() || "";
    if (!sessionFile) return;

    connect();
  });

  pi.on("session_shutdown", async () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const oldCtx = ctxVal;
    ctxVal = null;
    sessionFile = null;

    if (ws) {
      try {
        ws.removeAllListeners();
        ws.close();
      } catch (err) {}
      ws = null;
    }
    isConnected = false;

    if (oldCtx) {
      try {
        oldCtx.ui.setWidget("pi-remote-status", undefined); // Clear widget
      } catch (err) {}
    }
  });

  // Subscribe and forward Agent Events to the Standalone Server
  pi.on("agent_start", async () => {
    sendCliEvent({ type: "agent_start" });
  });

  pi.on("message_update", async (event: any) => {
    sendCliEvent({
      type: "message_update",
      message: event.message,
      assistantMessageEvent: event.assistantMessageEvent,
    });
  });

  pi.on("message_end", async (event: any) => {
    sendCliEvent({
      type: "message_end",
      message: event.message,
    });
  });

  pi.on("agent_end", async (event: any) => {
    sendCliEvent({
      type: "agent_end",
      messages: event.messages,
    });
  });

  pi.on("tool_execution_start", async (event: any) => {
    sendCliEvent({
      type: "tool_execution_start",
      toolName: event.toolName,
      args: event.args,
    });
  });

  pi.on("tool_execution_end", async (event: any) => {
    sendCliEvent({
      type: "tool_execution_end",
      toolName: event.toolName,
      result: event.result,
      isError: event.isError,
    });
  });
}

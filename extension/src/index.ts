/**
 * CLI Bridge Extension for Pi Remote
 *
 * Connects the local pi CLI session as a client to the Standalone Pi Remote Server.
 * Streams all terminal activity to the server in real-time, and receives remote
 * commands to execute in the local agent loop.
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

  let ws: WebSocket | null = null;
  let isConnected = false;
  let sessionFile: string | null = null;

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
      console.error("[Pi Remote] Failed to send event to standalone server:", err);
    }
  }

  pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
    const isBridgeEnabled = pi.getFlag("remote-bridge") !== false;
    if (!isBridgeEnabled) return;

    const host = (pi.getFlag("remote-host") as string) || "127.0.0.1";
    const port = (pi.getFlag("remote-port") as string) || "8765";
    const token = pi.getFlag("remote-token") as string | undefined;

    sessionFile = ctx.sessionManager.getSessionFile() || "";
    if (!sessionFile) return;

    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
    const wsUrl = `ws://${host}:${port}/ws${tokenQuery}`;

    console.log(`🌐 [Pi Remote] Bridging to standalone server at ${wsUrl}...`);

    ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      isConnected = true;
      ctx.ui.notify("[Pi Remote] Connected to standalone remote server as bridge", "info");

      // Register this CLI session with the server
      ws?.send(
        JSON.stringify({
          type: "cli_register",
          sessionFile,
          cwd: ctx.cwd,
          model: (ctx.sessionManager.getHeader() as any)?.model || "",
        })
      );
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case "cli_message": {
            ctx.ui.notify(`[Pi Remote] Received remote command: ${msg.message.slice(0, 40)}...`, "info");
            pi.sendUserMessage(msg.message, {
              deliverAs: msg.streamingBehavior,
            });
            break;
          }
          case "cli_abort": {
            ctx.ui.notify("[Pi Remote] Received abort command from remote client", "warning");
            ctx.abort();
            break;
          }
        }
      } catch (err) {
        console.error("[Pi Remote] Error handling message from server:", err);
      }
    });

    ws.on("close", () => {
      isConnected = false;
      console.log("🔌 [Pi Remote] Disconnected from standalone remote server");
    });

    ws.on("error", (err) => {
      isConnected = false;
      console.warn(`⚠️ [Pi Remote] Standalone server connection error: ${err.message}. Standard terminal active.`);
    });
  });

  pi.on("session_shutdown", async () => {
    if (ws) {
      ws.close();
      ws = null;
    }
    isConnected = false;
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

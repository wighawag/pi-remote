/**
 * CLI Bridge Extension for Wherever
 *
 * Connects the local pi CLI session as a client to the Standalone Wherever Server.
 * Streams all terminal activity to the server in real-time, and receives remote
 * commands to execute in the local agent loop.
 *
 * Features exponential backoff reconnection to automatically pair whenever the
 * Standalone Server starts or stops.
 *
 * Usage:
 *   pi --extension ./extension/dist/index.js --remote-port 31415 --remote-token YOUR_TOKEN
 */

import WebSocket from "ws";
import { spawn } from "node:child_process";
import { WhereverClient } from "@wherever-dev/client";
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
    default: "31415",
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

  pi.registerFlag("remote-secure", {
    description: "Whether to connect to the remote standalone server using SSL (WSS)",
    type: "boolean",
    default: true,
  });

  pi.registerCommand("remote-reconnect", {
    description: "Manually reconnect to the standalone remote server",
    handler: async (args: string, ctx: any) => {
      if (client && client.getIsConnected()) {
        ctx.ui.notify("[Wherever] Already connected to standalone server", "info");
        return;
      }
      ctx.ui.notify("[Wherever] Initiating manual reconnect...", "info");
      connect();
    },
  });

  let client: WhereverClient | null = null;
  let sessionFile: string | null = null;
  let ctxVal: ExtensionContext | null = null;

  function updateCliWidget(status: 'disconnected' | 'connecting' | 'connected') {
    if (!ctxVal) return;

    try {
      if (status === 'connecting') {
        ctxVal.ui.setWidget("wherever-status", (_tui, theme) => {
          const line = theme.fg("muted", "🔌 [Wherever] Connecting to standalone remote server...");
          return {
            render: () => [line],
            invalidate: () => {},
          };
        });
      } else if (status === 'disconnected') {
        ctxVal.ui.setWidget("wherever-status", (_tui, theme) => {
          const line = theme.fg("error", "⚠️ [Wherever] Disconnected from standalone remote server");
          return {
            render: () => [line],
            invalidate: () => {},
          };
        });
      } else {
        ctxVal.ui.setWidget("wherever-status", undefined);
      }
    } catch (err) {
      // Quiet fail if context is stale or disposed
    }
  }

  function sendCliEvent(event: any) {
    if (!client || !client.getIsConnected() || !sessionFile) return;
    try {
      client.send({
        type: "cli_event",
        sessionFile,
        event,
      });
    } catch (err) {
      // Quiet fail if connection dropped suddenly during a send
    }
  }

  function connect() {
    if (client) {
      try {
        client.disconnect(true);
      } catch (err) {}
      client = null;
    }

    if (!ctxVal || !sessionFile) return;

    updateCliWidget('connecting');

    const host = (pi.getFlag("remote-host") as string) || "127.0.0.1";
    const port = (pi.getFlag("remote-port") as string) || "31415";
    const token = pi.getFlag("remote-token") as string | undefined;
    const isSecure = pi.getFlag("remote-secure") !== false;

    client = new WhereverClient({
      host,
      port,
      token,
      secure: isSecure,
      WebSocketCtor: WebSocket
    });

    client.stateStore.subscribe((s) => {
      if (s.connected) {
        updateCliWidget('connected');
      } else if (s.connecting) {
        updateCliWidget('connecting');
      } else {
        updateCliWidget('disconnected');
      }
    });

    client.onMessage((msg) => {
      try {
        switch (msg.type) {
          case "cli_message": {
            ctxVal?.ui.notify(`[Wherever] Received remote command: ${msg.message.slice(0, 40)}...`, "info");
            pi.sendUserMessage(msg.message, {
              deliverAs: msg.streamingBehavior,
            });
            break;
          }
          case "cli_bash": {
            const { command, excludeFromContext } = msg;
            ctxVal?.ui.notify(`[Wherever] Executing remote bash command: ${command.slice(0, 40)}...`, "info");

            sendCliEvent({
              type: "tool_execution_start",
              toolName: "bash",
              args: { command },
            });

            const shell = process.platform === "win32" ? "cmd.exe" : "bash";
            const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];
            const child = spawn(shell, shellArgs, { cwd: ctxVal?.cwd });
            let output = "";

            child.stdout?.on("data", (data: any) => {
              const chunk = data.toString();
              output += chunk;
              sendCliEvent({
                type: "tool_execution_update",
                toolName: "bash",
                delta: chunk,
              });
            });

            child.stderr?.on("data", (data: any) => {
              const chunk = data.toString();
              output += chunk;
              sendCliEvent({
                type: "tool_execution_update",
                toolName: "bash",
                delta: chunk,
              });
            });

            child.on("close", (code: number) => {
              sendCliEvent({
                type: "tool_execution_end",
                toolName: "bash",
                result: output,
                isError: code !== 0,
              });

              // Record bash result locally
              const bashMessage = {
                role: "bashExecution",
                command,
                output,
                exitCode: code,
                timestamp: Date.now(),
                excludeFromContext,
              };

              try {
                if (ctxVal?.sessionManager) {
                  (ctxVal.sessionManager as any).appendMessage(bashMessage);
                }
              } catch (err) {
                console.error("[Wherever] Failed to append bash message locally:", err);
              }
            });

            child.on("error", (err: any) => {
              const errMsg = err.message || String(err);
              sendCliEvent({
                type: "tool_execution_end",
                toolName: "bash",
                result: errMsg,
                isError: true,
              });
            });
            break;
          }
          case "cli_abort": {
            ctxVal?.ui.notify("[Wherever] Received abort command from remote client", "warning");
            ctxVal?.abort();
            break;
          }
          case "cli_model_change": {
            const { model: modelStr } = msg;
            if (modelStr && ctxVal) {
              const idx = modelStr.indexOf(':');
              if (idx !== -1) {
                const provider = modelStr.slice(0, idx);
                const id = modelStr.slice(idx + 1);
                const model = ctxVal.modelRegistry.find(provider, id);
                if (model) {
                  ctxVal.ui.notify(`[Wherever] Changing model to ${modelStr}...`, "info");
                  pi.setModel(model).catch((err) => {
                    ctxVal?.ui.notify(`[Wherever] Failed to set model: ${err.message || err}`, "error");
                  });
                } else {
                  ctxVal.ui.notify(`[Wherever] Model not found in registry: ${modelStr}`, "error");
                }
              }
            }
            break;
          }
        }
      } catch (err) {
        console.error("[Wherever] Error handling message from server:", err);
      }
    });

    let wasConnected = false;
    client.stateStore.subscribe((s) => {
      if (s.connected && !wasConnected) {
        wasConnected = true;
        client?.send({
          type: "cli_register",
          sessionFile,
          cwd: ctxVal?.cwd,
          model: ctxVal?.model ? `${ctxVal.model.provider}:${ctxVal.model.id}` : "",
        });
      } else if (!s.connected) {
        wasConnected = false;
      }
    });

    client.connect();
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
    const oldCtx = ctxVal;
    ctxVal = null;
    sessionFile = null;

    if (client) {
      try {
        client.disconnect(true);
      } catch (err) {}
      client = null;
    }

    if (oldCtx) {
      try {
        oldCtx.ui.setWidget("wherever-status", undefined); // Clear widget
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

  pi.on("model_select", async (event: any) => {
    const modelStr = event.model ? `${event.model.provider}:${event.model.id}` : "";
    sendCliEvent({
      type: "model_select",
      model: modelStr,
    });
  });
}

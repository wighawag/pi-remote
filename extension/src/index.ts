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
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

// Minimal shapes for tool-call/tool-result detection. The coding-agent package
// does not re-export AgentMessage/ToolCall, so we narrow structurally instead of
// importing them. Only the fields we read are described here.
type ToolCallContent = { type: "toolCall"; id: string; name: string };
type AssistantLikeMessage = {
  role: "assistant";
  content?: Array<{ type?: string; id?: string; name?: string }>;
};
type ToolResultLikeMessage = { role: "toolResult"; toolCallId?: string };

/** A tool call that was issued by the assistant but has no matching toolResult. */
interface DanglingToolCall {
  id: string;
  name: string;
}

/**
 * Walk the ACTIVE branch (leaf -> root, like buildSessionContext) of the loaded
 * session and return tool calls from the last assistant turn(s) that have no
 * matching toolResult. A non-empty result means the transcript was persisted
 * mid-tool-call: typically another process (the web frontend / standalone
 * server) is still running that tool, or the run was interrupted. pi cannot
 * auto-continue from a trailing unsatisfied tool call (the agent loop requires
 * the last context message to be a user/toolResult), so on resume the CLI sits
 * idle as if the turn were done. Detecting this lets us surface it instead.
 */
function findDanglingToolCalls(ctx: ExtensionContext): DanglingToolCall[] {
  let entries: SessionEntry[];
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return [];
  }
  if (!entries || entries.length === 0) return [];

  // Index by id and walk the active branch from the leaf to the root, mirroring
  // buildSessionContext() so we only consider messages actually in context.
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  let leafId: string | null | undefined;
  try {
    leafId = ctx.sessionManager.getLeafId();
  } catch {
    leafId = undefined;
  }

  let leaf: SessionEntry | undefined;
  if (leafId === null) return []; // navigated before first entry: no context
  if (leafId) leaf = byId.get(leafId);
  if (!leaf) leaf = entries[entries.length - 1];
  if (!leaf) return [];

  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  // Collect satisfied tool-call ids (those with a matching toolResult) and the
  // tool calls issued, both restricted to the active branch.
  const satisfied = new Set<string>();
  const issued: DanglingToolCall[] = [];
  for (const entry of path) {
    if (entry.type !== "message") continue;
    const message = (entry as SessionMessageEntry).message as unknown;
    const role = (message as { role?: string })?.role;
    if (role === "toolResult") {
      const tcId = (message as ToolResultLikeMessage).toolCallId;
      if (tcId) satisfied.add(tcId);
    } else if (role === "assistant") {
      const content = (message as AssistantLikeMessage).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && part.type === "toolCall" && typeof part.id === "string") {
          const tc = part as ToolCallContent;
          issued.push({ id: tc.id, name: tc.name || "tool" });
        }
      }
    }
  }

  return issued.filter((tc) => !satisfied.has(tc.id));
}

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

  // Forward the agent's current context-window usage so the web UI can show the
  // "11.3% / 1.0M" indicator for CLI-bridged sessions (the server cannot compute
  // it for these). Best-effort: undefined usage (no model / no turn yet) is sent
  // as null so the client can clear a stale value.
  function sendContextUsage() {
    try {
      const usage = ctxVal?.getContextUsage?.();
      sendCliEvent({
        type: "context_usage",
        contextUsage: usage
          ? {
              tokens: usage.tokens,
              contextWindow: usage.contextWindow,
              percent: usage.percent,
            }
          : null,
      });
    } catch (err) {
      // Quiet fail.
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

  // Clear the "resumed mid-tool-call" warning widget, if shown. Safe to call
  // unconditionally; it is a no-op when nothing was set.
  function clearResumeToolWarning() {
    if (!ctxVal) return;
    try {
      ctxVal.ui.setWidget("wherever-resume-warning", undefined);
    } catch (err) {
      // Quiet fail if context is stale or disposed.
    }
  }

  pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
    const isBridgeEnabled = pi.getFlag("remote-bridge") !== false;
    if (!isBridgeEnabled) return;

    ctxVal = ctx;
    sessionFile = ctx.sessionManager.getSessionFile() || "";
    if (!sessionFile) return;

    // On resume/reload, the loaded transcript may end mid-tool-call (the matching
    // toolResult was never persisted). This happens when another process (the web
    // frontend / standalone server) is still running that tool, or the previous
    // run was interrupted. pi cannot auto-continue from a trailing unsatisfied
    // tool call, so the CLI would silently sit idle as if the turn were done.
    // Surface it so the user understands why nothing is happening, rather than
    // mistaking it for a completed turn awaiting input.
    if (event.reason === "resume" || event.reason === "reload" || event.reason === "startup") {
      try {
        const dangling = findDanglingToolCalls(ctx);
        if (dangling.length > 0) {
          const names = dangling.map((d) => d.name).join(", ");
          const detail =
            dangling.length === 1
              ? `the "${names}" tool call`
              : `${dangling.length} tool calls (${names})`;
          ctx.ui.notify(
            `[Wherever] This session was resumed mid-run: ${detail} has no result yet. ` +
              `If it is still running in the web frontend, its result will not appear here; ` +
              `send a message to take over and continue, or wait/abort.`,
            "warning",
          );
          ctx.ui.setWidget("wherever-resume-warning", (_tui, theme) => {
            const line = theme.fg(
              "warning",
              `⏳ [Wherever] Resumed mid-run: ${detail} has no result yet (may be running in another client).`,
            );
            return {
              render: () => [line],
              invalidate: () => {},
            };
          });
        } else {
          clearResumeToolWarning();
        }
      } catch (err) {
        // Detection is best-effort; never block session start on it.
      }
    } else {
      clearResumeToolWarning();
    }

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
        oldCtx.ui.setWidget("wherever-resume-warning", undefined); // Clear resume warning
      } catch (err) {}
    }
  });

  // Subscribe and forward Agent Events to the Standalone Server
  pi.on("agent_start", async () => {
    // The agent is running again (the user took over / continued the session), so
    // the "resumed mid-tool-call" warning is no longer relevant.
    clearResumeToolWarning();
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
    // Context usage is freshest right after a turn completes.
    sendContextUsage();
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
    // Context window can change with the model, so refresh the indicator.
    sendContextUsage();
  });
}

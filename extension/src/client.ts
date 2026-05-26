/**
 * Remote Client Example for Pi
 *
 * Demonstrates how to connect to and control a remote pi instance
 * using the remote-server extension.
 *
 * Usage:
 *   npx tsx remote-client.ts --url ws://localhost:31415 --token YOUR_TOKEN
 */

import WebSocket from "ws";

interface Config {
  url: string;
  token?: string;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = { url: "ws://localhost:31415" };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      config.url = args[++i];
    } else if (args[i] === "--token" && args[i + 1]) {
      config.token = args[++i];
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();

  // Connect to WebSocket
  const wsUrl = config.token
    ? `${config.url}?token=${config.token}`
    : config.url;
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("✅ Connected to pi remote server");
    console.log("\nCommands:");
    console.log("  Type a message and press Enter");
    console.log("  !abort - abort current operation");
    console.log("  !exit  - exit this client\n");
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  });

  ws.on("close", () => {
    console.log("\n❌ Disconnected from pi remote server");
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
    process.exit(1);
  });

  // Read user input
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function prompt() {
    rl.question("You: ", (input) => {
      const trimmed = input.trim();

      if (trimmed === "!exit") {
        ws.close();
        rl.close();
        return;
      }

      if (trimmed === "!abort") {
        ws.send(JSON.stringify({ type: "abort" }));
        console.log("🚫 Abort sent");
        prompt();
        return;
      }

      if (trimmed) {
        ws.send(JSON.stringify({ type: "message", message: trimmed }));
      }

      prompt();
    });
  }

  prompt();
}

function handleMessage(msg: any): void {
  switch (msg.type) {
    case "connected":
      console.log(`📡 Session: ${msg.session}`);
      break;

    case "agent_start":
      console.log("\n🤖 Agent: Working...");
      break;

    case "message_update":
      process.stdout.write(msg.delta || "");
      break;

    case "message_end":
      console.log("\n");
      break;

    case "agent_end":
      console.log("✅ Agent finished\n");
      break;

    case "tool_start":
      console.log(`🔧 Tool: ${msg.toolName}`);
      break;

    case "tool_end":
      console.log(`✅ Tool completed (error: ${msg.isError})\n`);
      break;

    case "aborted":
      console.log("🚫 Aborted\n");
      break;

    case "pong":
      console.log("🏓 Pong");
      break;

    default:
      console.log("📨", msg.type, msg);
  }
}

main().catch(console.error);

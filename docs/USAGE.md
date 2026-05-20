# Pi Remote Server Extension

Control your pi coding agent remotely via HTTP/WebSocket while maintaining full access to all local folders and tools.

## Features

- **WebSocket real-time communication** - Stream agent responses as they happen
- **HTTP REST API** - Simple endpoints for programmatic control
- **Full tool access** - All pi tools work remotely (read, write, edit, bash, grep, find, ls)
- **Session management** - Create, resume, and manage sessions remotely
- **Authentication** - Optional token-based security
- **Extension UI support** - Handle confirmations and selections remotely

## Installation

The extension is already installed at `~/.pi/agent/extensions/remote-server.ts`.

**Dependencies:** The extension requires the `ws` package (WebSocket library). If it's not already available, create a package.json next to the extension:

```bash
cd ~/.pi/agent/extensions/
mkdir remote-server
mv remote-server.ts remote-server/index.ts
cd remote-server
pnpm init -y
pnpm install ws
```

Then update the extension path in your usage commands to point to the directory.

## Usage

### Start pi with remote server

```bash
# Basic (localhost only, no auth - for development)
pi --extension ~/.pi/agent/extensions/remote-server.ts --remote-port 8765

# With authentication token (recommended)
pi --extension ~/.pi/agent/extensions/remote-server.ts --remote-port 8765 --remote-token YOUR_SECRET_TOKEN

# Bind to all interfaces (use with authentication!)
pi --extension ~/.pi/agent/extensions/remote-server.ts --remote-port 8765 --remote-host 0.0.0.0 --remote-token YOUR_SECRET_TOKEN
```

### Security Notes

⚠️ **Important:**

- Always use `--remote-token` when exposing pi remotely
- By default, binds to `127.0.0.1` (localhost only)
- Use `--remote-host 0.0.0.0` only with strong authentication
- Consider using SSH tunneling instead of direct exposure:

  ```bash
  # On remote machine
  pi --extension ./remote-server.ts --remote-port 8765 --remote-token YOUR_TOKEN

  # On your local machine, create SSH tunnel
  ssh -L 8765:localhost:8765 user@remote-machine
  # Then connect to ws://localhost:8765 locally
  ```

## API Reference

### WebSocket API (`ws://host:port/ws`)

Real-time bidirectional communication.

#### Connection

```javascript
const ws = new WebSocket(`ws://localhost:8765/ws?token=YOUR_TOKEN`);
```

#### Client → Server Messages

```javascript
// Send a message to the agent
ws.send(
  JSON.stringify({
    type: "message",
    message: "List all TypeScript files in src/",
  }),
);

// Abort current operation
ws.send(JSON.stringify({ type: "abort" }));

// Ping (get pong response)
ws.send(JSON.stringify({ type: "ping" }));
```

#### Server → Client Messages

```javascript
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case "connected":
      // Connection established
      console.log(`Session: ${msg.session}`);
      break;

    case "agent_start":
      // Agent started processing
      console.log("Agent is working...");
      break;

    case "message_update":
      // Streaming response (text delta)
      process.stdout.write(msg.delta);
      break;

    case "message_end":
      // Message complete
      console.log("Message complete");
      break;

    case "agent_end":
      // Agent finished all work
      console.log("Agent finished");
      break;

    case "tool_start":
      // Tool execution started
      console.log(`Tool: ${msg.toolName}`, msg.args);
      break;

    case "tool_end":
      // Tool execution finished
      console.log(`Tool completed, error: ${msg.isError}`);
      break;

    case "aborted":
      // Operation was aborted
      console.log("Aborted");
      break;

    case "pong":
      // Response to ping
      console.log("Pong!");
      break;
  }
});
```

### HTTP API

#### POST `/message`

Send a message to the agent.

```bash
curl -X POST http://localhost:8765/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message": "List all .ts files"}'
```

**Response:**

```json
{
  "status": "accepted",
  "message": "List all .ts files",
  "streaming": false
}
```

#### GET `/session`

Get current session information.

```bash
curl http://localhost:8765/session \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
  "sessionFile": "/home/user/.pi/agent/sessions/project/2026-05-20.jsonl",
  "entryCount": 42,
  "lastEntry": { ... }
}
```

#### POST `/session/new`

Start a new session.

```bash
curl -X POST http://localhost:8765/session/new \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
  "status": "accepted",
  "action": "new_session"
}
```

#### POST `/session/compact`

Trigger context compaction.

```bash
curl -X POST http://localhost:8765/session/compact \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
  "status": "completed"
}
```

#### GET `/health`

Health check endpoint (no auth required).

```bash
curl http://localhost:8765/health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": 1716201234567
}
```

## Example Clients

### TypeScript Client (Included)

A reference client implementation is provided at `remote-client.ts`:

```bash
# Install dependencies first
cd ~/.pi/agent/extensions/
pnpm install ws

# Run the client
npx tsx remote-client.ts --url ws://localhost:8765 --token YOUR_TOKEN
```

### JavaScript/Node.js Example

```javascript
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8765/ws?token=YOUR_TOKEN");

ws.on("open", () => {
  console.log("Connected!");

  // Send a message
  ws.send(
    JSON.stringify({
      type: "message",
      message: "What files are in the current directory?",
    }),
  );
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("Received:", msg.type);

  if (msg.type === "message_update") {
    process.stdout.write(msg.delta);
  }
});
```

### Python Example

```python
import websocket
import json
import threading
import time

def on_message(ws, message):
    data = json.loads(message)
    print(f"Received: {data['type']}")

    if data['type'] == 'message_update':
        print(data['delta'], end='', flush=True)

def on_open(ws):
    print("Connected!")

    def run():
        ws.send(json.dumps({
            "type": "message",
            "message": "List all Python files"
        }))
        time.sleep(1)
        ws.close()

    threading.Thread(target=run).start()

ws = websocket.WebSocketApp(
    "ws://localhost:8765/ws?token=YOUR_TOKEN",
    on_message=on_message,
    on_open=on_open
)

ws.run_forever()
```

### cURL Examples

```bash
# Send a message
curl -X POST http://localhost:8765/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message": "Hello pi!"}'

# Get session info
curl http://localhost:8765/session \
  -H "Authorization: Bearer YOUR_TOKEN"

# Health check
curl http://localhost:8765/health
```

## Mobile Usage

For mobile access, you have several options:

### Option 1: SSH Tunnel + Any WebSocket Client

1. Set up SSH tunnel from mobile to remote pi instance
2. Use any WebSocket client app to connect to `ws://localhost:8765/ws`

### Option 2: Direct HTTPS + WSS

1. Put pi behind a reverse proxy (nginx, caddy) with SSL
2. Connect using `wss://your-domain.com/ws`
3. Use mobile apps like:
   - **Web Socket Tool** (iOS/Android)
   - **HTTP Shortcuts** (Android, supports WebSocket)
   - Custom web app (see below)

### Option 3: Simple Web Interface

Create a simple HTML page:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Pi Remote</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        font-family: system-ui;
        padding: 20px;
      }
      #output {
        background: #1a1a1a;
        color: #fff;
        padding: 15px;
        border-radius: 8px;
        min-height: 300px;
        max-height: 60vh;
        overflow-y: auto;
        margin-bottom: 15px;
        font-family: monospace;
        white-space: pre-wrap;
      }
      input {
        width: 100%;
        padding: 12px;
        font-size: 16px;
        box-sizing: border-box;
        margin-bottom: 10px;
      }
      button {
        padding: 12px 24px;
        font-size: 16px;
        background: #007bff;
        color: white;
        border: none;
        border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <h1>🤖 Pi Remote</h1>
    <div id="output"></div>
    <input id="input" placeholder="Type a message..." autocomplete="off" />
    <button onclick="send()">Send</button>
    <button onclick="abort()">Abort</button>

    <script>
      const ws = new WebSocket("ws://YOUR_SERVER:8765/ws?token=YOUR_TOKEN");
      const output = document.getElementById("output");
      const input = document.getElementById("input");

      ws.onopen = () => log("✅ Connected");
      ws.onclose = () => log("❌ Disconnected");
      ws.onerror = (e) => log("❌ Error: " + e);

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "message_update") {
          output.textContent += msg.delta;
          output.scrollTop = output.scrollHeight;
        } else {
          log("📨 " + msg.type);
        }
      };

      function send() {
        const text = input.value.trim();
        if (!text) return;
        ws.send(JSON.stringify({ type: "message", message: text }));
        log("📤 " + text);
        input.value = "";
      }

      function abort() {
        ws.send(JSON.stringify({ type: "abort" }));
        log("🚫 Abort sent");
      }

      function log(text) {
        output.textContent += text + "\n";
        output.scrollTop = output.scrollHeight;
      }

      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") send();
      });
    </script>
  </body>
</html>
```

## Troubleshooting

### Connection refused

- Check if pi is running with the remote server extension
- Verify the port: `pi --extension ./remote-server.ts --remote-port 8765`
- Check firewall settings

### Authentication failed

- Ensure you're passing the token correctly
- WebSocket: `ws://host:port/ws?token=YOUR_TOKEN`
- HTTP: `Authorization: Bearer YOUR_TOKEN` header or `?token=YOUR_TOKEN` query param

### WebSocket keeps disconnecting

- Check network stability
- Ensure pi process is still running
- Look for error messages in pi's output

### Tools not working remotely

- All built-in tools should work normally
- The extension doesn't restrict tool access
- Check file permissions on the remote machine

## Advanced Usage

### Multiple Clients

The server supports multiple WebSocket connections. All clients receive the same streaming updates.

### Custom Message Types

Extend the extension to handle custom message types for your use case:

```typescript
// In remote-server.ts, add to handleWebSocketMessage:
case "custom_action": {
  // Handle your custom action
  break;
}
```

### Integration with Other Tools

The HTTP API makes it easy to integrate pi into:

- CI/CD pipelines
- Chat bots (Slack, Discord, Telegram)
- IDE extensions
- Custom dashboards

## License

MIT

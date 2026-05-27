# Pi Remote - Project Context

**Created:** 2026-05-20  
**Location:** `/home/wighawag/dev/github/wighawag/pi-remote`

## Project Overview

Pi Remote is a TypeScript extension for the [pi coding agent](https://pi.dev) that provides HTTP/WebSocket server capabilities for remote control. It allows controlling pi from anywhere while maintaining full access to all local folders and tools.

## What Exists

### Core Files

- **`src/index.ts`** - Main extension server
  - HTTP server with REST API endpoints
  - WebSocket server for real-time streaming
  - Token-based authentication
  - Event broadcasting (agent lifecycle, tool execution, messages)
- **`src/client.ts`** - Reference WebSocket client
  - Command-line client for testing
  - Demonstrates WebSocket protocol usage
- **`docs/USAGE.md`** - Complete API documentation
  - WebSocket API reference
  - HTTP API reference
  - Example clients (JavaScript, Python, cURL)
  - Mobile usage options
  - Troubleshooting guide

### Web Applications

- **`web/`** - SvelteKit dashboard app (mobile-friendly)
  - Real-time WebSocket connection to pi-remote server
  - Chat interface, session browser, voice dictation
  - Served by the server at `/` when connecting to a server
  - Built to `web/build/`
- **`site/`** - Standalone marketing/info website
  - Landing page, features, install guide, architecture diagram
  - Built as a static site for GitHub Pages deployment
  - Independent from web/ — no shared code or dependencies
  - Built to `site/build/`
  - Deployed via `.github/workflows/deploy-gh-pages.yml`

### Configuration

- **`package.json`** - Dependencies and pi package manifest
  - Runtime: `ws` (WebSocket library)
  - Dev: TypeScript, tsx, @types/node, @types/ws
  - Pi package config for auto-discovery
- **`tsconfig.json`** - TypeScript configuration
  - ES2022 target, ESNext modules
  - Strict mode enabled
  - Output to `dist/`

### Documentation

- **`README.md`** - Quick start guide
- **`LICENSE`** - MIT License
- **`.gitignore`** - Standard Node.js ignores

## Technical Details

### Architecture

```
┌─────────────────┐         ┌──────────────────┐
│  Remote Client  │◄───────►│  Pi Remote Server│
│  (WebSocket)    │         │  (Extension)     │
│  (Web Dashboard)│         │                  │
└─────────────────┘         └────────┬─────────┘
                                     │
                              ┌──────▼──────┐
                              │  Pi Core    │
                              │  + Tools    │
                              └─────────────┘
```

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  Web Browser     │◄────────│  pi-remote Server│────────►│  pi CLI          │
│  (Dashboard)     │  WS     │  (Extension)     │  Ext    │  (Agent + Tools) │
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

```
┌──────────────────┐
│  Marketing Site  │
│  (GitHub Pages)  │
│  site/           │
└──────────────────┘
```

### Server Endpoints

**WebSocket:** `ws://host:port/ws?token=XXX`

- Real-time bidirectional communication
- Streams agent responses, tool events
- Accepts messages, abort commands

**HTTP REST:**

- `POST /message` - Send message to agent
- `GET /session` - Get session info
- `POST /session/new` - Start new session
- `POST /session/compact` - Trigger compaction
- `GET /health` - Health check (no auth)

### Authentication

- Optional token via `--remote-token` flag
- WebSocket: query param or Authorization header
- HTTP: query param or Authorization header
- Default bind: `127.0.0.1` (localhost only)

### Event Flow

1. Client connects via WebSocket
2. Server broadcasts pi lifecycle events:
   - `agent_start` / `agent_end`
   - `message_update` (streaming text)
   - `message_end`
   - `tool_start` / `tool_end`
3. Client sends messages via WebSocket or HTTP
4. Server forwards to pi via `pi.sendUserMessage()`

## Current Status

✅ **Completed:**

- Core extension with HTTP/WebSocket server
- Reference client implementation
- Complete API documentation
- Package configuration
- Git repository initialized
- Initial commit made

⏳ **Next Steps:**

1. Install dependencies and test locally
2. Push to GitHub
3. ✅ Build web frontend (mobile-friendly)
4. ✅ Build marketing site (GitHub Pages)
5. Add more example clients
6. Consider publishing to npm as pi package

## Usage Commands

```bash
# Development
cd /home/wighawag/dev/github/wighawag/pi-remote
pnpm install
pnpm run build

# Test the extension
pi --extension ./dist/index.js --remote-port 31415 --remote-token test123

# Test the client
pnpm run client -- --url ws://localhost:31415 --token test123

# Push to GitHub
git remote add origin git@github.com:wighawag/pi-remote.git
git push -u origin main
```

## Security Considerations

⚠️ **Important:**

- Always use `--remote-token` for remote access
- Default binding is localhost only (`127.0.0.1`)
- For remote access, use SSH tunneling:
  ```bash
  ssh -L 31415:localhost:31415 user@remote-machine
  ```
- If binding to `0.0.0.0`, ensure strong authentication
- Consider adding rate limiting for production use

## Mobile Usage (Original Motivation)

The extension was created to enable mobile control of pi without relying on SSH clients. Options:

1. **Simple Web Interface** - Build a mobile-friendly web UI (not yet implemented)
2. **WebSocket Apps** - Use existing mobile WebSocket clients
3. **SSH Tunnel + Local Connect** - Tunnel to mobile, connect via localhost

## File Structure

```
pi-remote/
├── src/
│   ├── index.ts          # Main extension (server)
│   └── client.ts         # Reference client
├── docs/
│   └── USAGE.md          # Complete API docs
├── web/                  # SvelteKit dashboard app (mobile-friendly)
├── site/                 # Standalone marketing/info website (GitHub Pages)
├── .github/
│   └── workflows/
│       └── deploy-gh-pages.yml  # CI/CD for marketing site
├── package.json          # Dependencies + pi config
├── tsconfig.json         # TypeScript config
├── README.md             # Quick start
├── CONTEXT.md            # This file
├── LICENSE               # MIT
└── .gitignore
```

## Key Design Decisions

1. **WebSocket-first** - Real-time streaming is essential for agent interaction
2. **HTTP fallback** - Simple REST API for programmatic access
3. **Optional auth** - Token-based, easy to disable for local dev
4. **Event broadcasting** - All clients receive same events (multi-client support)
5. **Message queuing** - Messages queued if no client connected (up to 100)
6. **Separate web UI** - Dashboard (`web/`) and marketing site (`site/`) are independent SvelteKit apps
7. **GitHub Pages** - Marketing site deployed via GitHub Actions to `github.com/wighawag/pi-remote`

## Agent Guidelines

⚠️ **Important for AI Agents:**
Please review **`AGENTS.md`** in the root of the project before completing any work. It contains essential guidelines, including the requirement to **always create a changeset** with a good description when done.

## Known Limitations

- No rate limiting (add for production use)
- No connection persistence/reconnection logic (client responsibility)
- Single active WebSocket for broadcasting (all clients get same stream)
- No extension UI dialog forwarding (confirmations happen on server side)

## Future Enhancements

Potential additions:

- [ ] Multiple WebSocket rooms/sessions
- [ ] Rate limiting middleware
- [ ] WebSocket reconnection logic
- [ ] Extension UI dialog forwarding to remote clients
- [ ] Custom tool registration via API
- [ ] File transfer capabilities

## Related Pi Documentation

- [Pi Extensions](https://pi.dev/docs/extensions.md) - Extension API reference
- [Pi RPC Mode](https://pi.dev/docs/rpc.md) - Alternative integration method
- [Pi SDK](https://pi.dev/docs/sdk.md) - Programmatic usage

## Contact & Contributing

- Repository: `github.com/wighawag/pi-remote`
- License: MIT
- Contributions welcome!

---

**Note:** This document is meant to provide full context when moving to a new conversation/session. All essential project information should be here.

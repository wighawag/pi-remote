# Pi Remote

Remote control extension for [pi coding agent](https://pi.dev) with HTTP/WebSocket API.

Control pi from anywhere while maintaining full access to all local folders and tools.

## Features

- **WebSocket real-time communication** - Stream agent responses as they happen
- **HTTP REST API** - Simple endpoints for programmatic control
- **Full tool access** - All pi tools work remotely (read, write, edit, bash, grep, find, ls)
- **Session management** - Create, resume, and manage sessions remotely
- **Authentication** - Optional token-based security
- **Extension UI support** - Handle confirmations and selections remotely

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Start pi with remote server
npm run dev -- --remote-port 8765 --remote-token YOUR_TOKEN

# Or use directly with pi
pi --extension ./dist/index.js --remote-port 8765 --remote-token YOUR_TOKEN
```

## Usage

See [docs/USAGE.md](docs/USAGE.md) for complete API reference and examples.

## Project Structure

```
pi-remote/
├── src/
│   ├── index.ts      # Main extension
│   └── client.ts     # Reference client
├── docs/
│   └── USAGE.md      # Full documentation
├── examples/
│   └── web/          # Web frontend (TODO)
├── package.json
├── tsconfig.json
└── README.md
```

## Security

⚠️ **Important:**
- Always use `--remote-token` when exposing pi remotely
- By default, binds to `127.0.0.1` (localhost only)
- Use `--remote-host 0.0.0.0` only with strong authentication
- Consider using SSH tunneling for remote access

## License

MIT

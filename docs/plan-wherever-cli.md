# Wherever CLI — Attachment Client Design & Plan

This document outlines the architectural plan for introducing an independent, lightweight command-line interface package (`cli/`) to the Wherever monorepo. 

By leveraging our newly extracted `@wherever-dev/client` shared engine, this CLI will operate purely as an interactive terminal viewer—allowing developers to list, create, attach to, and steer server-side agent sessions directly from any terminal, with **100% headless resilience** (detaching does not interrupt the running server-side agent).

---

## 1. Architectural Overview: Passive Terminal Attachment

Because the `pi` CLI always runs its own agent loop locally, we cannot use it purely as a viewer. Instead, we introduce a dedicated, lightweight `wherever` CLI.

```
┌────────────────────────────────────────────────────────┐
│                      Terminal                          │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  wherever-cli (Node Process)                     │  │
│  │  - Uses @wherever-dev/client                     │  │
│  │  - Readline input loop                           │  │
│  │  - Interactive ANSI streaming renderer           │  │
│  └────────────────────────▲─────────────────────────┘  │
└───────────────────────────┼────────────────────────────┘
                            │ WS (Attach / Detach)
                            ▼
        ┌─────────────────────────────────────────────┐
        │ Local Standalone Server (`wherever-dev`)    │
        │ - Runs ServerTrackedSession in background   │
        │ - Executes agent, tools, and bash           │
        └─────────────────────────────────────────────┘
```

### Key Behavioral Decisions:
1. **Headless Execution:** The standalone server is the sole executor of the agent loop (`ServerTrackedSession`). 
2. **Safe Detachment:** Pressing `Ctrl+C` or closing the terminal window merely kills the `wherever-cli` viewer process. The server-side agent continues running, editing files, and invoking tools in the background.
3. **Re-Attachment:** You can run `wherever attach` again at any time (even from a different machine or tab) to resume viewing and typing input to the active session.

---

## 2. Command-Line Interface Specification

The CLI will be packaged under `./cli/` as `@wherever-dev/cli` and expose the `wherever` executable.

### Syntax & Commands:
*   `wherever list`
    *   Lists all active and saved sessions on the standalone server, showing their session ID, folder CWD, model, active state, and file path.
*   `wherever create [cwd]`
    *   Creates a new server-side session in the specified directory (defaults to current working directory).
    *   Flags: `--model <model>`, `--git-init`.
*   `wherever attach <sessionId>`
    *   Attaches to an active session, displaying its complete message history and entering a real-time interactive stream and chat input mode.
*   `wherever stop <sessionId>`
    *   Destroys an active session on the server.
*   `wherever --help`
    *   Displays standard help options.

---

## 3. Directory Structure & Workspace Integration

We will register the new `"cli"` package inside `pnpm-workspace.yaml`:

```yaml
packages:
  - "extension"
  - "web"
  - "site"
  - "server"
  - "client"
  - "vscode"
  - "cli"
```

### File Tree Layout (`./cli/`)
```
cli/
├── package.json              # Bin configuration, script bindings, name: "@wherever-dev/cli"
├── tsconfig.json             # Pure-TS CLI compiler configuration
├── src/
│   ├── index.ts              # Command routing (list, create, attach, stop)
│   ├── client-config.ts      # Parses and stores CLI configuration (host, port, token)
│   ├── renderer.ts           # Formats message updates and timelines with ANSI escape codes
│   └── attach-loop.ts        # Non-blocking Readline terminal input and attachment loop
```

---

## 4. Implementation Details

### A. package.json (`cli/package.json`)
```json
{
  "name": "@wherever-dev/cli",
  "version": "0.1.0",
  "description": "Headless attachment CLI client for Wherever standalone server",
  "type": "module",
  "bin": {
    "wherever": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@wherever-dev/client": "workspace:*",
    "picocolors": "^1.1.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

### B. Interactive Attach Loop (`cli/src/attach-loop.ts`)
To allow the user to type prompts while the server is concurrently streaming outputs, the attachment loop utilizes Node's non-blocking `readline` interface:

```typescript
import readline from 'node:readline';
import pc from 'picocolors';
import { WhereverClient } from '@wherever-dev/client';
import { renderMessage } from './renderer.js';

export function runAttachLoop(client: WhereverClient, sessionFile: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: pc.bold(pc.cyan('wherever > '))
  });

  // 1. Subscribe to real-time events via @wherever-dev/client
  client.stateStore.subscribe((s) => {
    // Check for incoming updates or streaming flags and redraw if necessary...
  });

  client.onMessage((msg) => {
    // Custom real-time streaming parser using renderer.ts
    // Clean current line, print the delta, and restore the readline prompt!
    if (msg.type === 'message_update' || msg.type === 'thinking_update') {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(msg.delta);
    } else if (msg.type === 'message_end') {
      process.stdout.write('\n');
      rl.prompt();
    }
  });

  // 2. Start the user input loop
  rl.prompt();

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }

    if (text === '/exit' || text === '/detach') {
      console.log(pc.yellow('\nDetaching from session. The agent will continue running on the server.'));
      rl.close();
      client.disconnect(true);
      process.exit(0);
    }

    if (text === '/abort') {
      console.log(pc.red('\nAborting active agent run...'));
      client.abort();
      rl.prompt();
      return;
    }

    // Forward the message to the server
    client.sendMessage(text);
  });

  rl.on('SIGINT', () => {
    // Intercept Ctrl+C to detach by default, rather than aborting the server task
    console.log(pc.yellow('\nDetached (Ctrl+C). Run "wherever attach" to re-join later.'));
    rl.close();
    client.disconnect(true);
    process.exit(0);
  });
}
```

### C. Terminal Renderer (`cli/src/renderer.ts`)
Uses ANSI escape codes and `picocolors` to print messages cleanly in a vertical layout:
*   **Thinking block (`thinking`):** Styled in `pc.gray` with an indented prefix `[Thinking...]`.
*   **Assistant response (`assistant`):** Styled in white/green with a subtle markdown parser or clean word wrapping.
*   **Tool Execution Timeline (`tool`):** Rendered as clickable or distinct block styles:
    ```
    ⚙️  [bash] $ npm run build
    ```

---

## 5. Step-by-Step Implementation Checklist

- [ ] **Step 1: Workspace Wiring**
  - Create `./cli/` folder, `cli/package.json`, and `cli/tsconfig.json`.
  - Add `"cli"` to `pnpm-workspace.yaml`.
- [ ] **Step 2: CLI Client Configuration**
  - Implement parsing of global settings (defaults, reading `~/.wherever/config.json`, or environment variables).
- [ ] **Step 3: Render and Timelines**
  - Write `cli/src/renderer.ts` to output beautiful streams for thoughts, assistant text, and tool execution start/updates/ends using `picocolors`.
- [ ] **Step 4: Interactive Handshake and Loop**
  - Implement `cli/src/attach-loop.ts` to coordinate readline loops, SIGINT capture for safe detachment, and `/abort` commands.
- [ ] **Step 5: Router Command Entrypoint**
  - Write `cli/src/index.ts` to process CLI commands (`list`, `create`, `attach`, `stop`), perform WebSocket connection setups using `WhereverClient`, and route command outcomes.
- [ ] **Step 6: Build and Global Testing**
  - Run `pnpm install && pnpm --filter @wherever-dev/cli run build`.
  - Link and invoke `wherever list` and `wherever attach` to verify the attachment experience.

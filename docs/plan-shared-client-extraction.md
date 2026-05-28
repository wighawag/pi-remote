# Wherever Client Extraction — Architectural Refactor Plan

This document outlines the detailed, step-by-step refactoring plan to extract core client WebSocket and state management logic into a dedicated monorepo package `./client/` (`@wherever-dev/client`).

Our exact goal is to **pave the ground work for future IDE integrations** while ensuring **100% feature parity, backward compatibility, and zero behavior changes** in our active CLI extension (`./extension`) and web dashboard (`./web`).

---

## 1. Monorepo Dependency Graph (Target State)

By centralizing connection management and protocol specifications, we achieve a highly organized monorepo structure where no network or protocol logic is duplicated:

```
                      ┌──────────────────────┐
                      │   @wherever-dev/web  │ (Dashboard View)
                      │    Svelte Components │
                      └──────────▲───────────┘
                                 │ imports
┌────────────────────────────────┴───────────────────────┐
│              @wherever-dev/client                      │ (Pure TS Engine)
│              - WebSocket Client Class (WhereverClient) │
│              - State Stores (writable, readable)       │
│              - Reconnection Exponential Backoff       │
│              - Shared Protocol Type Definitions        │
└────────────────────────────────▲───────────────────────┘
                                 │ imports
                      ┌──────────┴───────────┐
                      │   @wherever-dev/pi   │ (CLI Extension)
                      │    Pi Agent Bridge   │
                      └──────────────────────┘
```

---

## 2. Shared Client Implementation Details

To ensure the next agent can implement this refactor instantly without roadblocks, here are the exact TypeScript configurations and code implementations required.

### A. TS Configuration (`client/tsconfig.json`)
The client package must target modern ES modules and output clean type definitions:
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "target": "ES2022",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

### B. package.json (`client/package.json`)
The client package must target modern ES modules, output clean type definitions, and utilize the dependency-free Svelte-store engine `sveltore`:
```json
{
  "name": "@wherever-dev/client",
  "version": "0.2.0",
  "description": "Framework-agnostic isomorphic TypeScript client for Wherever standalone server",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "sveltore": "^0.4.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

### C. Isomorphic Svelte-Store Reactivity (`client/src/store.ts`)
To maintain 100% compatibility with Svelte's `$store` reactivity without importing the full Svelte framework, we utilize the framework-agnostic `sveltore` package. Inside our client modules, we simply import standard reactive stores:

```typescript
import { writable, derived, type Readable, type Writable } from "sveltore";

// Standard sveltore stores are 100% API-compatible with Svelte stores,
// allowing them to be subscribed to natively inside standard Svelte 5 views,
// or as standard TypeScript event listeners inside pure Node/CLI environments.
```

### D. Isomorphic WebSocket Constructor (`client/src/client.ts`)
To make `WhereverClient` fully isomorphic (running in the browser via native WebSockets, and running in Node.js via the `ws` library), design the constructor to accept an optional WebSocket constructor:

```typescript
export interface WhereverClientConfig {
  host: string;
  port: number;
  token?: string;
  secure?: boolean;
  // Node environments will pass the imported 'ws' package constructor
  // Browser environments will omit this, defaulting to globalThis.WebSocket
  WebSocketCtor?: any; 
}

export class WhereverClient {
  private ws: any = null;
  private config: WhereverClientConfig;

  constructor(config: WhereverClientConfig) {
    this.config = {
      secure: true,
      ...config
    };
  }

  private connect() {
    const protocol = this.config.secure ? "wss" : "ws";
    const tokenQuery = this.config.token ? `?token=${encodeURIComponent(this.config.token)}` : "";
    const wsUrl = `${protocol}://${this.config.host}:${this.config.port}/ws${tokenQuery}`;

    const WebSocketImpl = this.config.WebSocketCtor || (typeof globalThis !== 'undefined' ? (globalThis as any).WebSocket : null);
    
    if (!WebSocketImpl) {
      throw new Error("No WebSocket implementation found. Please pass custom WebSocketCtor.");
    }

    this.ws = new WebSocketImpl(wsUrl);
    // Bind WebSocket event listeners (open, close, message, error) here...
  }
}
```

---

## 3. Step-by-Step Extraction & Refactoring Guide

Follow these exact steps to perform the refactor:

### Step 1: Create `@wherever-dev/client`
1. Create `./client/` directory.
2. Write `client/package.json` and `client/tsconfig.json` as specified.
3. Extract types from `web/src/lib/wherever.ts` into `client/src/types.ts` (`ChatMessage`, `WhereverState`, connection types).
4. Extract the WebSocket connection, heartbeat, and exponential backoff retry loop from `web/src/lib/wherever.ts` into `client/src/client.ts` using the isomorphic `WhereverClient` specification.
5. Export everything from `client/src/index.ts`.
6. Build the package: `cd client && pnpm run build`.

### Step 2: Register in Workspace
1. Edit `pnpm-workspace.yaml` to register the new `"client"` directory:
   ```yaml
   packages:
     - "extension"
     - "web"
     - "site"
     - "server"
     - "client"
   ```

### Step 3: Refactor the Web Dashboard (`./web`)
1. Add `@wherever-dev/client` to dependencies in `web/package.json`:
   ```json
   "@wherever-dev/client": "workspace:*"
   ```
2. Refactor `web/src/lib/wherever.ts` to delete duplicated socket and retry timers, making it simply instantiate `WhereverClient` and re-expose its stores:
   ```typescript
   import { WhereverClient } from "@wherever-dev/client";
   // Instantiate, passing default browser global WebSocket automatically
   export const client = new WhereverClient({ host: "localhost", port: 31415 }); 
   export const state = client.stateStore; // bindings stay 100% same
   ```
3. Run `pnpm --filter wherever-web dev` and confirm that the web build is successful and runs identically.

### Step 4: Refactor the CLI Extension (`./extension`)
1. Add `@wherever-dev/client` to dependencies in `extension/package.json`:
   ```json
   "@wherever-dev/client": "workspace:*"
   ```
2. Refactor `extension/src/index.ts` to replace its internal custom WebSocket connection, reconnect, and auth parsing routines with a configured `WhereverClient` instance:
   ```typescript
   import WebSocket from "ws";
   import { WhereverClient } from "@wherever-dev/client";

   const client = new WhereverClient({
     host: getFlagHost(),
     port: getFlagPort(),
     token: getFlagToken(),
     WebSocketCtor: WebSocket // Node-specific WS package injection
   });
   ```
3. Rebuild the extension: `cd extension && pnpm run build`.

---

## 4. Verification & Testing Checklist

To guarantee zero behavior changes and verify 100% backward compatibility:

- [ ] **Compilation Check:** Run `pnpm build` at the monorepo root. Verify that `@wherever-dev/client` compiles successfully to `dist/`, and both `web/` and `extension/` compile without any TypeScript type errors.
- [ ] **Connection Verification:**
  - Launch the server: `pnpm server:dev`
  - Launch the CLI extension: `pi --extension ./extension/dist/index.js --remote-token test123`
  - Open the Web Dashboard.
  - Verify that the CLI extension connects to the server and registers itself successfully.
  - Verify that the web client connects successfully and lists the active CLI session.
- [ ] **Real-time Chat Verification:**
  - Send a prompt (e.g., `/explain-code`) from the Web Dashboard.
  - Verify that the CLI extension receives the command, executes the prompt, and streams updates back to the Web Dashboard.
  - Verify that markdown formatting, tool timelines, and text streams render identically to the current production state.
- [ ] **Backoff Reconnect Verification:**
  - Stop the Standalone Server while the CLI extension and Web Dashboard are active.
  - Verify that both clients transition to a "Disconnected" state, and successfully trigger exponential retry logs.
  - Restart the Standalone Server.
  - Verify that both clients automatically reconnect and resume connection status with zero manual interaction or stuck states.

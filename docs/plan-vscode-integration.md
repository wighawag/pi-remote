# Wherever VS Code Companion — Integration Design & Plan

This document outlines the architectural plan for adding a VS Code extension package (`vscode-extension/`) and a shared logic package (`client/`) to the Wherever monorepo. It details how the Sidebar Chat GUI operates, how it integrates with the local standalone server, and how it uses a dedicated, narrow-first UI designed specifically for the IDE workspace.

---

## 1. Architectural Overview: Server-Driven Sidebar Webview

In this model, the VS Code Extension acts as a lightweight, IDE-native controller and client for the Wherever standalone server. **A visible CLI terminal is completely optional.**

```
┌────────────────────────────────────────────────────────────────┐
│                        VS Code                                 │
│                                                                │
│  ┌──────────────────────┐  (postMessage)   ┌────────────────┐  │
│  │  Sidebar Chat Panel  │◄────────────────►│ Extension Host │  │
│  │  - Narrow-optimized  │                  │ - Command      │  │
│  │  - Native CSS Theme  │                  │   registry     │  │
│  └──────────▲───────────┘                  └────────┬───────┘  │
└─────────────┼───────────────────────────────────────┼──────────┘
              │ WS (real-time stream)                 │ File System
              ▼                                       ▼
        ┌─────────────────────────────────────────────────────┐
        │ Local Standalone Server (`wherever-dev`)            │
        │ - Runs in background (Node process)                 │
        │ - Manages a native `ServerTrackedSession`           │
        │ - Spawns Pi agent loop directly on workspace        │
        └─────────────────────────────────────────────┘
```

### Core Architecture Specifications:
- **No Folder Selection:** Since the user has already opened a folder/workspace in VS Code, the extension automatically binds to that active workspace path. No hard drive browsing is required.
- **VS Code Theme Alignment:** The Sidebar Chat UI uses VS Code's native CSS variables (e.g., `--vscode-editor-background`, `--vscode-foreground`) to automatically adapt to any user theme (Dark, Light, Monokai, etc.) without custom theme files.
- **Narrow-First Layout:** The user interface is custom-tailored for the narrow sidebar panel (typically 300px wide), focusing strictly on a clean conversation view and tool cards.
- **WebSocket Loopback & CORS Security:** Since VS Code Webviews run inside an iframe with a secure origin (e.g., `vscode-webview://...`), the `wherever-dev` standalone server (`server/src/index.ts`) will skip WebSocket origin checking for `vscode-webview://` to ensure smooth local loopback connectivity.
- **Automatic Token Handshake:** The VS Code Extension Host acts as the Single Source of Truth for authentication. It reads/generates the secure token, spawns the background `wherever-dev` server with it, and injects that same token into the Webview HTML template via `window.WHEREVER_VSCODE_CONFIG`—guaranteeing a flawless handshake on every startup.

---

## 2. Shared Logic Core (`@wherever-dev/client`) & Custom Sidebar Skin

To deliver a premium native experience with absolute code efficiency, we decouple our logic into a dedicated, reusable client-side package:

```
                  ┌──────────────────────┐
                  │   @wherever-dev/web  │
                  │   (Web Dashboard)    │
                  └──────────▲───────────┘
                             │ imports
┌────────────────────────────┴───────────────────────────┐
│              @wherever-dev/client (Shared Logic)       │
│              - Connection Managers & Retry Backoff     │
│              - WebSocket Event Dispatchers             │
│              - ChatMessage & Tool Execution Parsers    │
│              - Reusable Client Stores (State Engine)   │
└────────────────────────────▲──────────────────▲────────┘
                             │ imports          │ imports
                  ┌──────────▼───────────┐  ┌───┴──────────────────┐
                  │ @wherever-dev/vscode │  │  @wherever-dev/pi    │
                  │  (VS Code Sidebar)   │  │   (CLI Extension)    │
                  └──────────────────────┘  └──────────────────────┘
```

### Shared Logic & Coding Guidelines (`@wherever-dev/client`):
We will extract the logic currently residing in `web/src/lib/wherever.ts` into a dedicated monorepo library under `./client/`. 

- **100% Pure TypeScript Library:** The `./client/` package contains absolutely **no Svelte templates or `.svelte` files**. It is a pure, compile-fast TypeScript package.
- **Isomorphic & Dependency-Free:** The library uses browser-native `WebSocket` and `EventTarget` APIs. When used in Node environments (the CLI extension or server), we pass a compatible Node `ws` adapter, ensuring Svelte/Webview code remains extremely lightweight and standard-compliant.
- **No Svelte Framework Dependency:** We omit the `svelte` package dependency inside `@wherever-dev/client`. To implement standard Svelte store reactivity (`writable`, `readable`, `derived`), we use a lightweight, zero-dependency store library like `sveltore` (or implement a minimal store pattern). Since Svelte store subscribability is a simple agnostic contract (`subscribe(run) => unsubscribe`), these stores remain 100% interoperable with standard Svelte 5 and SvelteKit frontends.
- **Strict Logic Separation:** All WebSocket connections, state tracking, and parsed logic reside inside pure `.ts` files, completely avoiding Svelte 5 runes or `.svelte.ts` files. Svelte components (`.svelte` files) are strictly confined to the consumer view layers in `./web` and `./vscode-extension/src/webview/`.
- **CLI Extension Unification:** The CLI extension (`@wherever-dev/pi`) will also import `@wherever-dev/client` for its WebSocket connection and retry handlers, removing duplicate backoff code and maintaining single-point API type-safety.

---

## 3. Deep IDE Actions (Webview ↔ Extension Host Communication)

The narrow-optimized sidebar chat panel inside VS Code will communicate with the Extension Host process using the standard VS Code `postMessage` API. This allows triggering native editor actions directly from Svelte click handlers:

1. **`openFile`**: Clicking a file name in a tool card tells the extension host to open that file in the editor:
   ```typescript
   vscode.workspace.openTextDocument(filePath).then(doc => {
       vscode.window.showTextDocument(doc);
   });
   ```
2. **`openDiff`**: When Pi edits a file, clicking "Review Changes" triggers VS Code's native side-by-side diff editor:
   ```typescript
   vscode.commands.executeCommand("vscode.diff", originalUri, modifiedUri, "Pi Changes");
   ```

---

## 4. Package Directory & Code Layout

Our monorepo will have two new directories:

### A. The Client-Shared Library: `./client/`
```
client/
├── package.json              # Package name: "@wherever-dev/client"
├── tsconfig.json             # Shared TS settings
├── src/
│   ├── index.ts              # Entrypoint, exports core client classes/stores
│   ├── connection.ts         # WebSocket management & exponential backoff logic
│   └── types.ts              # Unified ChatMessage, ToolExecution, and State models
```

### B. The VS Code Extension: `./vscode-extension/`
```
vscode-extension/
├── package.json              # Extension metadata, sidebar contributions, settings
├── tsconfig.json             # TS compiler configuration
├── esbuild.js                # Build script for bundling extension and webview code
├── src/
│   ├── extension.ts          # Extension activator, handles commands and server lifecycle
│   ├── server-manager.ts     # Monitors, spawns, and kills the background `wherever-dev` server
│   ├── webview-provider.ts   # Resolves the sidebar Webview, binds messaging
│   └── webview/              # The Sidebar UI code
│       ├── main.ts           # Webview entrypoint (Svelte mounting)
│       ├── Sidebar.svelte    # Main Chat View (optimized for narrow space)
│       └── global.d.ts       # Types for VS Code Webview API (acquireVsCodeApi)
└── media/
    └── logo.svg              # Extension sidebar and activity bar icon
```

### VS Code Extension Options (settings.json):
Users will configure:
- `wherever.host` (default `127.0.0.1`)
- `wherever.port` (default `31415`)
- `wherever.token` (default `test123`)
- `wherever.autoStartServer` (default `true`)
- `wherever.piPath` (default `pi`)

### Packaging & Delivery Specifications:
To guarantee seamless packaging and user installation without requiring access to workspace development source files:
- **Static Assets Compilation:** At extension compile-time, the Svelte sidebar view will be bundled into `vscode-extension/dist/webview.js` and `dist/webview.css` using `esbuild` loaded with `esbuild-svelte` (with compiler configurations tuned for pure client-side rendering).
- **VSIX Inclusion:** The `files` array inside `vscode-extension/package.json` will explicitly include `dist/` and `media/` to guarantee all compiled UI views and SVGs are bundled inside the compiled `.vsix` archive.

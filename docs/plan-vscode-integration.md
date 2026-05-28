# Wherever VS Code Companion — Integration Design & Plan

This document outlines the detailed architectural, implementation, and packaging plan for adding the VS Code extension package (`vscode/`) to the Wherever monorepo. 

Our goal is to build a lightweight, professional, IDE-native Sidebar Chat GUI that integrates seamlessly with the local standalone server, utilizes the newly extracted `@wherever-dev/client` shared engine, and communicates directly with the VS Code extension host to trigger deep editor actions.

---

## 1. Architectural Overview

The VS Code Extension operates as a lightweight, IDE-native controller and client for the `wherever-dev` standalone server. It spawns the background server automatically, establishes local loopback, and presents a responsive, Svelte 5-based chat UI inside the sidebar.

```
┌────────────────────────────────────────────────────────────────┐
│                        VS Code                                 │
│                                                                │
│  ┌──────────────────────┐  (postMessage)   ┌────────────────┐  │
│  │  Sidebar Chat Panel  │◄────────────────►│ Extension Host │  │
│  │  - Svelte 5 Webview  │                  │ - Command      │  │
│  │  - Native CSS Theme  │                  │   registry     │  │
│  └──────────▲───────────┘                  └────────┬───────┘  │
└─────────────┼───────────────────────────────────────┼──────────┘
              │ WS (using @wherever-dev/client)       │ File System & Git
              ▼                                       ▼
        ┌─────────────────────────────────────────────────────┐
        │ Local Standalone Server (`wherever-dev`)            │
        │ - Runs in background (Node process)                 │
        │ - Spawns Pi agent loop directly on workspace        │
        └─────────────────────────────────────────────────────┘
```

### Core Architecture Decisions:
1. **Workspace Binding (No Folder Selection):** The extension binds automatically to the active VS Code workspace directory (`vscode.workspace.workspaceFolders[0].uri.fsPath`). No manual hard drive browsing is required.
2. **VS Code Theme Adaptation:** The Webview UI uses VS Code's native CSS variables (e.g., `--vscode-sideBar-background`, `--vscode-editor-foreground`, `--vscode-button-background`) to automatically adapt to any theme (Dark, Light, High Contrast) out-of-the-box.
3. **Automatic Token Handshake:** The extension host acts as the Single Source of Truth for authentication. It reads/generates a secure token (from user settings or dynamically generated), boots the background `wherever-dev` server with it, and injects it into the Webview HTML template via a global configuration object (`window.WHEREVER_VSCODE_CONFIG`), guaranteeing a flawless, zero-configuration handshake.
4. **Standalone Server Lifecycle:**
   - The extension automatically spawns the background server as a child process if the configuration `wherever.autoStartServer` is `true`.
   - The server binary path is dynamically resolved using `require.resolve('@wherever-dev/server/dist/index.js')`, ensuring standard, clean npm module resolution.

---

## 2. Directory Structure & Workspace Integration

We will register the new `"vscode"` package inside `pnpm-workspace.yaml`:

```yaml
packages:
  - "extension"
  - "web"
  - "site"
  - "server"
  - "client"
  - "vscode"
```

### File Tree Layout (`./vscode/`)
```
vscode/
├── package.json              # Extension manifest & sidebar contributions
├── tsconfig.json             # VS Code target settings
├── esbuild.js                # Bundles Extension Host (node) & Svelte 5 Webview (browser)
├── src/
│   ├── extension.ts          # Activator, commands, and overall extension orchestration
│   ├── server-manager.ts     # Child process spawning/killing of @wherever-dev/server
│   ├── git-provider.ts       # Handles git show HEAD to provide original file text for diffs
│   ├── webview-provider.ts   # Resolves Sidebar Webview, injects token config, handles postMessage
│   └── webview/
│       ├── main.ts           # Webview entrypoint (Svelte 5 mounting)
│       ├── Sidebar.svelte    # Narrow-optimized Conversation and Tool Timeline view
│       ├── components/       # Custom lightweight UI components optimized for 300px panel
│       └── global.d.ts       # Type definitions for acquireVsCodeApi() and config injection
└── media/
    └── logo.svg              # Activity Bar Icon
```

---

## 3. Package Configurations

### A. Extension Manifest (`vscode/package.json`)
The manifest defines configuration settings, custom sidebar icons, and command registrations:

```json
{
  "name": "wherever-vscode",
  "displayName": "Wherever Companion",
  "description": "IDE Sidebar Chat Companion for Wherever standalone server",
  "version": "0.1.0",
  "publisher": "wherever-dev",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": [
    "Machine Learning",
    "Programming Languages"
  ],
  "main": "./dist/extension.js",
  "activationEvents": [],
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "wherever-sidebar-container",
          "title": "Wherever",
          "icon": "media/logo.svg"
        }
      ]
    },
    "views": {
      "wherever-sidebar-container": [
        {
          "type": "webview",
          "id": "wherever.chatView",
          "name": "Wherever Chat",
          "visibility": "visible"
        }
      ]
    },
    "commands": [
      {
        "command": "wherever.startServer",
        "title": "Wherever: Start Standalone Server"
      },
      {
        "command": "wherever.stopServer",
        "title": "Wherever: Stop Standalone Server"
      },
      {
        "command": "wherever.reconnect",
        "title": "Wherever: Reconnect Sidebar View"
      }
    ],
    "configuration": {
      "title": "Wherever Settings",
      "properties": {
        "wherever.host": {
          "type": "string",
          "default": "127.0.0.1",
          "description": "Host of the remote/local standalone server"
        },
        "wherever.port": {
          "type": "integer",
          "default": 31415,
          "description": "Port of the remote/local standalone server"
        },
        "wherever.token": {
          "type": "string",
          "default": "test123",
          "description": "Authentication token for the standalone server"
        },
        "wherever.autoStartServer": {
          "type": "boolean",
          "default": true,
          "description": "Automatically spawn/manage the background wherever-dev server"
        }
      }
    }
  },
  "dependencies": {
    "@wherever-dev/client": "workspace:*",
    "@wherever-dev/server": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.20.0",
    "esbuild-svelte": "^0.8.0",
    "svelte": "^5.0.0",
    "typescript": "^5.7.0"
  },
  "scripts": {
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "package": "vsce package"
  }
}
```

### B. TS Configuration (`vscode/tsconfig.json`)
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "target": "ES2022",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

---

## 4. Webview & Extension Host Communication (Deep IDE Actions)

The Webview UI communicates with the Extension Host via `vscode.postMessage` to perform deep IDE tasks:

### Message Schema (Webview → Extension Host)
- **Open File:** `{ type: 'openFile', filePath: string }`
- **Open Diff:** `{ type: 'openDiff', filePath: string }`

### Extension Host Message Handler
```typescript
webviewView.webview.onDidReceiveMessage(async (message) => {
  switch (message.type) {
    case 'openFile': {
      const fullPath = path.resolve(workspaceRoot, message.filePath);
      const uri = vscode.Uri.file(fullPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      break;
    }
    case 'openDiff': {
      const fullPath = path.resolve(workspaceRoot, message.filePath);
      const relativePath = path.relative(workspaceRoot, fullPath);

      const originalUri = vscode.Uri.parse(`wherever-git-show:${relativePath}`);
      const modifiedUri = vscode.Uri.file(fullPath);

      await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        modifiedUri,
        `${path.basename(fullPath)} (HEAD ↔ Edited)`
      );
      break;
    }
  }
});
```

### Git Show HEAD Text Document Content Provider
To display the diff side-by-side without polluting the local filesystem with temporary files, register a custom `TextDocumentContentProvider`:

```typescript
import { exec } from 'child_process';

export class GitShowDocumentProvider implements vscode.TextDocumentContentProvider {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const relativePath = uri.path; // URI is structured as wherever-git-show:path/to/file
    return new Promise((resolve, reject) => {
      exec(`git show HEAD:"${relativePath}"`, { cwd: this.workspaceRoot }, (err, stdout) => {
        if (err) {
          // Fall back to empty string if file is untracked/new
          resolve('');
        } else {
          resolve(stdout);
        }
      });
    });
  }
}

// Registered in extension.ts:
// vscode.workspace.registerTextDocumentContentProvider('wherever-git-show', new GitShowDocumentProvider(workspaceRoot));
```

---

## 5. UI Layout Design (Narrow-Optimized Sidebar)

Since the sidebar chat is typically restricted to a narrow column (~300px), standard broad desktop components (like our web dashboard) will wrap poorly. The Svelte 5 `Sidebar.svelte` panel will follow these design specifications:

- **Strict Vertical Stacking:** Chat input stays pinned at the absolute bottom; message history scrolls in the center.
- **Narrow Timeline:** Tool execution blocks (`$ bash ...`) are rendered inside lightweight, clickable, expandable timeline nodes with minimal padding and subtle borders.
- **CSS Variable Color Palette:**
  - `background-color: var(--vscode-sideBar-background);`
  - `color: var(--vscode-sideBar-foreground);`
  - Fonts match VS Code's editor typeface automatically: `font-family: var(--vscode-font-family);`
- **Action Buttons:** Hovering over a file name inside a chat message displays inline action icons:
  - 📄 **Open Document** (triggers `openFile` action)
  - 🔍 **Review Changes** (triggers `openDiff` action, active if the file was recently mutated)

---

## 6. Svelte Webview Bootstrapping

In `webview-provider.ts`, compile the template and inject configuration settings natively:

```typescript
const config = vscode.workspace.getConfiguration('wherever');
const host = config.get<string>('host') || '127.0.0.1';
const port = config.get<number>('port') || 31415;
const token = config.get<string>('token') || '';

const webviewConfig = {
  host,
  port,
  token,
  secure: false
};

const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <style>
    body {
      padding: 10px;
      background-color: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    window.WHEREVER_VSCODE_CONFIG = ${JSON.stringify(webviewConfig)};
  </script>
  <script src="${jsUri}"></script>
</body>
</html>
`;
```

In `src/webview/main.ts`, the Svelte application retrieves this config and instantiates `@wherever-dev/client` seamlessly:

```typescript
import { mount } from "svelte";
import Sidebar from "./Sidebar.svelte";
import { WhereverClient } from "@wherever-dev/client";

// Retrieve config injected from WebviewProvider
const config = (window as any).WHEREVER_VSCODE_CONFIG;

const client = new WhereverClient({
  host: config.host,
  port: config.port,
  token: config.token,
  secure: config.secure
});

// Mount Svelte sidebar component
const app = mount(Sidebar, {
  target: document.getElementById("app")!,
  props: {
    client
  }
});

export default app;
```

---

## 7. Build and Bundling (`esbuild.js`)

We will use a unified `esbuild.js` build script to compile both the Node-based Extension Host and the browser-based Svelte 5 Webview in one pipeline:

```javascript
import esbuild from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";

const isWatch = process.argv.includes("--watch");

// 1. Extension Host Build (Node.js target)
const extensionCtx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  minify: !isWatch
});

// 2. Webview Client Build (Browser target)
const webviewCtx = await esbuild.context({
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outfile: "dist/webview.js",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  minify: !isWatch,
  plugins: [
    esbuildSvelte({
      compilerOptions: { css: "external" }
    })
  ]
});

if (isWatch) {
  await extensionCtx.watch();
  await webviewCtx.watch();
  console.log("👀 Watching for changes in extension and webview...");
} else {
  await extensionCtx.rebuild();
  await webviewCtx.rebuild();
  console.log("⚡ Extension and webview bundled successfully!");
  process.exit(0);
}
```

---

## 8. Implementation Checklist for Next Agent

A fresh agent context can execute this plan systematically using the following sequence:

- [ ] **Step 1: Workspace Setup**
  - Create directory `./vscode/`
  - Create `vscode/package.json` and `vscode/tsconfig.json`
  - Register `"vscode"` in `pnpm-workspace.yaml`
  - Create `vscode/esbuild.js`
- [ ] **Step 2: Server Manager & Git Provider**
  - Implement `vscode/src/server-manager.ts` to spawn/manage `@wherever-dev/server` as a child process using npm's dynamic file resolution (`require.resolve`).
  - Implement `vscode/src/git-provider.ts` containing the `GitShowDocumentProvider` class to support clean file diffs.
- [ ] **Step 3: Extension Host Orchestration**
  - Write `vscode/src/extension.ts` to coordinate settings loading, boot/kill server cycles, register git show provider, and initialize WebviewProvider.
- [ ] **Step 4: Webview Host Bridging**
  - Write `vscode/src/webview-provider.ts` to bind `wherever.chatView`, output the HTML wrapper, inject configuration parameters, and listen for incoming editor message actions.
- [ ] **Step 5: Webview Svelte UI Design**
  - Create `vscode/src/webview/main.ts` to parse `window.WHEREVER_VSCODE_CONFIG` and mount the application.
  - Implement Svelte components under `vscode/src/webview/` utilizing `@wherever-dev/client` to bind state stores natively. Use vertical stacking and VS Code's standard CSS palette to align the theme and optimize for narrow layouts.
- [ ] **Step 6: Bundling & Packaging**
  - Run `pnpm install` and compile via `pnpm --filter wherever-vscode run build`.
  - Compile packaging archive `.vsix` to verify complete bundling of media, layouts, and scripts.

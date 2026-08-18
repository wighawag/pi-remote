import { mount } from "svelte";
import Sidebar from "./Sidebar.svelte";
import { WhereverClient } from "@wherever-dev/client";

// Retrieve config injected from WebviewProvider
const config = (window as any).WHEREVER_VSCODE_CONFIG || {
  host: "localhost",
  port: 31416,
  token: "",
  secure: false,
  workspaceRoot: ""
};

// Stable identity for THIS webview across reconnects, so a silently dropped
// socket (host sleep, network switch) is recognised as this viewer coming back
// rather than counted as a second one -- which would turn a new session in an
// occupied folder into a read-only folder conflict. Scoped per webview via
// sessionStorage (the webview's own storage), mirroring the web app's per-tab
// key, and replaced if the server ever reports it as superseded.
const CLIENT_KEY_STORAGE = "wherever-client-key";

function readClientKey(): string | undefined {
  try {
    const existing = sessionStorage.getItem(CLIENT_KEY_STORAGE);
    if (existing) return existing;
    const key = `vscode-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    sessionStorage.setItem(CLIENT_KEY_STORAGE, key);
    return key;
  } catch {
    // Storage unavailable: the client's per-instance key still covers reconnects
    // for the life of this webview.
    return undefined;
  }
}

const client = new WhereverClient({
  host: config.host,
  port: config.port,
  token: config.token,
  secure: config.secure,
  clientKey: readClientKey(),
  onClientKeyChange: (key) => {
    try {
      sessionStorage.setItem(CLIENT_KEY_STORAGE, key);
    } catch {
      // Non-fatal: the in-memory key already resolved the collision.
    }
  }
});

// Mount Svelte sidebar component
const app = mount(Sidebar, {
  target: document.getElementById("app")!,
  props: {
    client,
    workspaceRoot: config.workspaceRoot
  }
});

export default app;
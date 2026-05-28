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
    client,
    workspaceRoot: config.workspaceRoot
  }
});

export default app;
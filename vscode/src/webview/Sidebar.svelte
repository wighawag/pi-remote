<script lang="ts">
  import { onMount, onDestroy, afterUpdate } from "svelte";
  import { type WhereverClient } from "@wherever-dev/client";

  // Accept properties
  export let client: WhereverClient;
  export let workspaceRoot: string;

  // Subscribe to stateStore
  const stateStore = client.stateStore;

  let messageContainer: HTMLElement;
  let textInput = "";
  let selectedModel = "default";
  let customModel = "";
  let gitInit = false;
  let showCustomModelInput = false;

  // Manage collapsed state for tool messages by id
  let expandedTools: Record<string, boolean> = {};

  // List of popular models
  const popularModels = [
    { value: "default", label: "Server Default" },
    { value: "anthropic/claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
    { value: "custom", label: "Custom Model..." }
  ];

  let vscode: any;
  try {
    vscode = acquireVsCodeApi();
  } catch (err) {
    // Fallback for browser-based testing
    vscode = {
      postMessage: (msg: any) => console.log("postMessage:", msg)
    };
  }

  onMount(() => {
    client.connect();

    const messageListener = (event: MessageEvent) => {
      const message = event.data;
      if (message && message.type === "reconnect") {
        client.connect();
      }
    };

    window.addEventListener("message", messageListener);

    return () => {
      window.removeEventListener("message", messageListener);
      client.disconnect();
    };
  });

  afterUpdate(() => {
    scrollToBottom();
  });

  function scrollToBottom() {
    if (messageContainer) {
      messageContainer.scrollTop = messageContainer.scrollHeight;
    }
  }

  function handleModelChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    if (target.value === "custom") {
      showCustomModelInput = true;
    } else {
      showCustomModelInput = false;
      selectedModel = target.value;
    }
  }

  function handleStartSession() {
    const model = showCustomModelInput ? customModel : selectedModel;
    client.createSession(workspaceRoot, model === "default" ? undefined : model, gitInit);
  }

  function handleSend() {
    if (!textInput.trim() || !$stateStore.sessionId) return;
    client.sendMessage(textInput);
    textInput = "";
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function openFile(filePath: string) {
    vscode.postMessage({ type: "openFile", filePath });
  }

  function openDiff(filePath: string) {
    vscode.postMessage({ type: "openDiff", filePath });
  }

  function toggleTool(id: string) {
    expandedTools[id] = !expandedTools[id];
  }

  function handleMessageClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target) return;

    if (target.classList.contains("file-link") || target.classList.contains("open-btn")) {
      const filePath = target.getAttribute("data-path");
      if (filePath) {
        openFile(filePath);
      }
    } else if (target.classList.contains("diff-btn")) {
      const filePath = target.getAttribute("data-path");
      if (filePath) {
        openDiff(filePath);
      }
    }
  }

  function formatMarkdown(content: string) {
    if (!content) return "";
    
    // Escape HTML to prevent XSS (but preserve our injected custom tags)
    let escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Inline code: `code`
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold: **text**
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    // Italic: *text*
    escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // File path mapping (e.g. src/extension.ts or docs/PLAN.md)
    const fileRegex = /(?:\b)((?:[a-zA-Z0-9_\-]+\/)+[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]{2,5}|[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]{2,5})\b/g;
    escaped = escaped.replace(fileRegex, (match) => {
      if (["class", "style", "html", "js", "css", "true", "false", "default", "const", "import"].includes(match)) {
        return match;
      }
      return `<span class="file-container">
        <span class="file-link" data-path="${match}">${match}</span>
        <span class="file-actions">
          <button class="file-btn open-btn" title="Open Document" data-path="${match}">📄</button>
          <button class="file-btn diff-btn" title="Review Changes" data-path="${match}">🔍</button>
        </span>
      </span>`;
    });

    // New lines
    escaped = escaped.replace(/\n/g, "<br/>");

    return escaped;
  }
</script>

<div class="sidebar-container">
  <!-- Connection / Session Header -->
  <header class="header">
    <div class="status-bar">
      {#if $stateStore.connected}
        <span class="badge connected">● Connected</span>
      {:else if $stateStore.connecting}
        <span class="badge connecting">● Connecting...</span>
      {:else}
        <span class="badge disconnected">● Disconnected</span>
        <button class="btn-small" on:click={() => client.connect()}>Connect</button>
      {/if}
    </div>

    {#if $stateStore.sessionId}
      <div class="session-info">
        <div class="session-meta">
          <span class="label">Session:</span>
          <span class="value" title={$stateStore.sessionId}>{$stateStore.sessionId.slice(0, 8)}...</span>
        </div>
        {#if $stateStore.activeModel}
          <div class="session-meta">
            <span class="label">Model:</span>
            <span class="value">{$stateStore.activeModel}</span>
          </div>
        {/if}
        <button class="btn-small leave-btn" on:click={() => client.leaveSession()}>Leave</button>
      </div>
    {/if}
  </header>

  <!-- Main Content Area -->
  <div class="content">
    {#if $stateStore.sessionError}
      <div class="banner error-banner">
        <div class="banner-text">{$stateStore.sessionError}</div>
        <button class="btn-close" on:click={() => client.dismissSessionError()}>✕</button>
      </div>
    {/if}

    {#if $stateStore.folderConflict?.active}
      <div class="banner conflict-banner">
        <div class="banner-text">
          ⚠️ Another client is active in this folder.
          {#if $stateStore.folderConflict.continued}
            You are both working in it — changes may conflict.
          {:else}
            You are observing (read-only) to avoid clashing.
          {/if}
        </div>
        {#if !$stateStore.folderConflict.continued}
          <button class="btn-secondary" on:click={() => client.continueFolderConflict()}>Continue anyway</button>
        {/if}
      </div>
    {/if}

    {#if !$stateStore.sessionId}
      <!-- Setup and Start Session -->
      <div class="setup-container">
        <h2>Start Wherever Session</h2>
        <p class="description">Activate the AI coding agent directly on this workspace directory.</p>

        <div class="form-group">
          <label for="model-select">AI Model</label>
          <select id="model-select" class="input" on:change={handleModelChange}>
            {#each popularModels as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>

        {#if showCustomModelInput}
          <div class="form-group">
            <label for="custom-model">Custom Model Name</label>
            <input
              id="custom-model"
              type="text"
              class="input"
              placeholder="e.g. anthropic/claude-3-5-sonnet"
              bind:value={customModel}
            />
          </div>
        {/if}

        <div class="form-group checkbox-group">
          <input id="git-init" type="checkbox" bind:checked={gitInit} />
          <label for="git-init">Initialize git repository if missing</label>
        </div>

        <button
          class="btn-primary btn-large"
          disabled={$stateStore.creatingSession || !$stateStore.connected}
          on:click={handleStartSession}
        >
          {#if $stateStore.creatingSession}
            Creating Session...
          {:else}
            Start Agent Session
          {/if}
        </button>
      </div>
    {:else}
      <!-- Active Conversation List -->
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="messages-list" bind:this={messageContainer} on:click={handleMessageClick}>
        {#if $stateStore.messages.length === 0}
          <div class="welcome-banner">
            <h3>Wherever Companion</h3>
            <p>Ask a question, request codebase edits, or start a terminal command.</p>
          </div>
        {/if}

        {#each $stateStore.messages as msg (msg.id)}
          {#if msg.role === 'user'}
            <div class="msg user-msg">
              <div class="msg-bubble">
                {@html formatMarkdown(msg.content)}
              </div>
            </div>
          {:else if msg.role === 'assistant'}
            <div class="msg assistant-msg">
              <div class="avatar">🤖</div>
              <div class="msg-bubble">
                {@html formatMarkdown(msg.content)}
              </div>
            </div>
          {:else if msg.role === 'thinking' && !$stateStore.hideThinking}
            <div class="msg thinking-msg">
              <div class="avatar">🧠</div>
              <div class="msg-bubble thinking-bubble">
                <span class="pulse-dot"></span>
                <span>Thinking...</span>
                {#if msg.isStreaming}
                  <div class="stream-text">{@html formatMarkdown(msg.content)}</div>
                {/if}
              </div>
            </div>
          {:else if msg.role === 'tool' && !$stateStore.hideTools}
            <div class="tool-msg {msg.isError ? 'tool-error' : ''}">
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div class="tool-header" on:click={() => toggleTool(msg.id)}>
                <span class="tool-icon">🛠️</span>
                <span class="tool-name">{msg.toolName}</span>
                <span class="tool-expand-icon">{expandedTools[msg.id] ? '▼' : '▶'}</span>
              </div>
              {#if expandedTools[msg.id]}
                <div class="tool-body">
                  {#if msg.toolArgs}
                    <div class="tool-args"><strong>Args:</strong> {msg.toolArgs}</div>
                  {/if}
                  {#if msg.toolOutput}
                    <pre class="tool-output"><code>{msg.toolOutput}</code></pre>
                  {:else if msg.isStreaming}
                    <div class="tool-streaming">Executing...</div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Bottom Chat Input Area -->
  {#if $stateStore.sessionId}
    <footer class="input-area">
      <div class="input-row">
        <textarea
          class="chat-input"
          placeholder="Ask Wherever..."
          bind:value={textInput}
          on:keydown={handleKeyDown}
          disabled={$stateStore.readOnly}
        ></textarea>
        
        {#if $stateStore.isStreaming}
          <button class="btn-danger send-btn" on:click={() => client.abort()}>Stop</button>
        {:else}
          <button class="btn-primary send-btn" disabled={!textInput.trim() || $stateStore.readOnly} on:click={handleSend}>Send</button>
        {/if}
      </div>
      {#if $stateStore.readOnly}
        <div class="input-footer read-only-info">Read-only mode</div>
      {/if}
    </footer>
  {/if}
</div>

<style>
  :global(:root) {
    --primary-color: var(--vscode-button-background, #3b82f6);
    --primary-color-hover: var(--vscode-button-hoverBackground, #2563eb);
    --border-color: var(--vscode-sideBar-border, #e2e8f0);
    --bg-dark: var(--vscode-sideBar-background, #1e293b);
    --fg-light: var(--vscode-sideBar-foreground, #f8fafc);
  }

  .sidebar-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--vscode-font-family, system-ui);
    font-size: var(--vscode-font-size, 13px);
    background-color: var(--vscode-sideBar-background);
    color: var(--vscode-sideBar-foreground);
  }

  .header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.2));
    background-color: var(--vscode-sideBarSectionHeader-background, rgba(0,0,0,0.1));
  }

  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .badge {
    font-size: 11px;
    font-weight: 600;
  }
  .connected { color: #10b981; }
  .connecting { color: #f59e0b; }
  .disconnected { color: #ef4444; }

  .session-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    gap: 8px;
    border-top: 1px solid rgba(128,128,128,0.1);
    padding-top: 6px;
    margin-top: 4px;
  }

  .session-meta {
    display: flex;
    gap: 4px;
  }
  .session-meta .label {
    opacity: 0.6;
  }
  .session-meta .value {
    font-weight: 600;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .banner {
    padding: 8px 12px;
    border-radius: 4px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    font-size: 12px;
  }
  .error-banner {
    background-color: var(--vscode-inputValidation-errorBackground, rgba(239, 68, 68, 0.2));
    border: 1px solid var(--vscode-inputValidation-errorBorder, #ef4444);
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-sideBar-foreground));
  }
  .banner-text {
    flex: 1;
    word-break: break-all;
  }
  .btn-close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: inherit;
    padding: 0;
    margin-left: 8px;
  }

  .conflict-banner {
    align-items: center;
    gap: 8px;
    background-color: var(--vscode-inputValidation-warningBackground, rgba(234, 179, 8, 0.15));
    border: 1px solid var(--vscode-inputValidation-warningBorder, #eab308);
    color: var(--vscode-inputValidation-warningForeground, var(--vscode-sideBar-foreground));
  }

  .setup-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 10px;
  }
  .setup-container h2 {
    font-size: 15px;
    margin: 0;
  }
  .setup-container .description {
    opacity: 0.7;
    margin: 0 0 10px 0;
    line-height: 1.4;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .form-group label {
    font-size: 11px;
    opacity: 0.8;
    font-weight: 600;
  }

  .checkbox-group {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    cursor: pointer;
  }
  .checkbox-group label {
    font-weight: normal;
    cursor: pointer;
  }

  .input {
    background-color: var(--vscode-input-background, rgba(0,0,0,0.1));
    color: var(--vscode-input-foreground, inherit);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
    border-radius: 3px;
    padding: 6px;
    font-family: inherit;
  }

  .btn-primary, .btn-secondary, .btn-danger {
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-weight: 600;
    font-family: inherit;
    text-align: center;
  }

  .btn-primary {
    background-color: var(--vscode-button-background, #3b82f6);
    color: var(--vscode-button-foreground, #ffffff);
  }
  .btn-primary:hover:not(:disabled) {
    background-color: var(--vscode-button-hoverBackground, #2563eb);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background-color: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
    color: var(--vscode-button-secondaryForeground, inherit);
  }
  .btn-secondary:hover {
    background-color: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3));
  }

  .btn-danger {
    background-color: #ef4444;
    color: white;
  }
  .btn-danger:hover {
    background-color: #dc2626;
  }

  .btn-large {
    padding: 10px;
    width: 100%;
    margin-top: 8px;
  }

  .btn-small {
    background-color: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
    color: var(--vscode-button-secondaryForeground, inherit);
    border: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.1));
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 10px;
    cursor: pointer;
  }
  .btn-small:hover {
    background-color: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25));
  }

  .messages-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
  }

  .welcome-banner {
    text-align: center;
    opacity: 0.6;
    margin-top: 40px;
  }
  .welcome-banner h3 {
    margin: 0 0 8px 0;
  }
  .welcome-banner p {
    font-size: 12px;
    margin: 0;
    line-height: 1.4;
  }

  .msg {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }

  .user-msg {
    justify-content: flex-end;
  }
  .user-msg .msg-bubble {
    background-color: var(--vscode-chat-requestBackground, rgba(128,128,128,0.15));
    border: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.1));
    border-radius: 8px 8px 0 8px;
  }

  .msg-bubble {
    padding: 8px 10px;
    border-radius: 8px;
    max-width: 85%;
    line-height: 1.4;
    word-break: break-word;
  }

  .assistant-msg .msg-bubble {
    background-color: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.15));
    border-radius: 0 8px 8px 8px;
  }

  .avatar {
    font-size: 16px;
    min-width: 24px;
    height: 24px;
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.1));
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .thinking-msg {
    opacity: 0.75;
  }
  .thinking-bubble {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-style: italic;
    font-size: 12px;
  }
  .stream-text {
    width: 100%;
    margin-top: 4px;
    font-style: normal;
  }

  .pulse-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: currentColor;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(0.8); opacity: 0.5; }
    50% { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(0.8); opacity: 0.5; }
  }

  .tool-msg {
    border: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.15));
    background-color: var(--vscode-sideBarSectionHeader-background, rgba(0,0,0,0.05));
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    overflow: hidden;
  }
  .tool-error {
    border-color: #ef4444;
    background-color: rgba(239, 68, 68, 0.05);
  }
  .tool-header {
    padding: 6px 8px;
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
    gap: 6px;
  }
  .tool-name {
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tool-expand-icon {
    font-size: 9px;
    opacity: 0.6;
  }
  .tool-body {
    padding: 8px;
    border-top: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.1));
    background-color: var(--vscode-editor-background, rgba(0,0,0,0.15));
  }
  .tool-args {
    margin-bottom: 6px;
    opacity: 0.8;
  }
  .tool-output {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 150px;
    overflow-y: auto;
  }
  .tool-streaming {
    font-style: italic;
    opacity: 0.6;
  }

  /* Interactive File action CSS injected from javascript formatMarkdown */
  :global(.file-container) {
    display: inline-flex;
    align-items: center;
    background-color: var(--vscode-sideBarSectionHeader-background, rgba(0,0,0,0.1));
    border: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.15));
    border-radius: 4px;
    padding: 1px 4px;
    margin: 0 2px;
  }
  :global(.file-link) {
    color: var(--vscode-textLink-foreground, #3b82f6);
    cursor: pointer;
    text-decoration: underline;
  }
  :global(.file-link:hover) {
    color: var(--vscode-textLink-activeForeground, #2563eb);
  }
  :global(.file-actions) {
    display: none;
    margin-left: 6px;
    align-items: center;
    gap: 4px;
  }
  :global(.file-container:hover .file-actions) {
    display: inline-flex;
  }
  :global(.file-btn) {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  :global(.file-btn:hover) {
    transform: scale(1.25);
  }
  :global(.inline-code) {
    background-color: rgba(128,128,128,0.15);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .input-area {
    padding: 10px;
    border-top: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.2));
    background-color: var(--vscode-sideBar-background);
  }
  .input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .chat-input {
    flex: 1;
    background-color: var(--vscode-input-background, rgba(0,0,0,0.1));
    color: var(--vscode-input-foreground, inherit);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
    border-radius: 3px;
    padding: 6px;
    resize: none;
    height: 38px;
    max-height: 100px;
    font-family: inherit;
    font-size: inherit;
  }
  .chat-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .send-btn {
    padding: 8px 12px;
    height: 38px;
  }

  .input-footer {
    font-size: 10px;
    text-align: center;
    margin-top: 4px;
  }
  .read-only-info {
    color: #ef4444;
  }
</style>
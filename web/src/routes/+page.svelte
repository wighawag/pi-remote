<script lang="ts">
  import Head from '$lib/Head.svelte';
  import ConnectionSettings from '$lib/components/ConnectionSettings.svelte';
  import ChatMessageList from '$lib/components/ChatMessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import SessionBrowser from '$lib/components/SessionBrowser.svelte';
  import SessionConflictDialog from '$lib/components/SessionConflictDialog.svelte';
  import { piState, isConnected, isInterrupted, sessionError, isReadOnly, activeSessionInfo, connect, disconnect, leaveSession, dismissSessionError, changeModel } from '$lib/pi-remote';
  import { fetchSessions, availableModels } from '$lib/session-store';
  import { onMount } from 'svelte';

  let sidebarOpen = $state(false);
  let autoConnect = $state(true);
  let interruptedTimeout: ReturnType<typeof setTimeout> | null = null;
  let chatList: { forceScrollToBottom: () => void };

  onMount(() => {
    if (autoConnect) {
      setTimeout(() => connect(), 200);
    }
  });

  function handleConnected() {
    connect();
  }

  function handleDisconnect() {
    leaveSession();
    disconnect();
  }

  function handleReconnect() {
    disconnect();
    setTimeout(() => connect(), 100);
  }

  function handleRefresh() {
    fetchSessions();
  }

  let connected = $derived($isConnected);
  let interrupted = $derived($isInterrupted);
  let sError = $derived($sessionError);
  let readOnly = $derived($isReadOnly);
  let sessionInfo = $derived($activeSessionInfo);
  let appState = $derived($piState);
  let models = $derived($availableModels.models);
</script>

<Head title="Pi Remote" description="Chat with your Pi coding agent remotely" />

<div class="h-screen flex bg-gray-900 text-white overflow-hidden">
  <!-- Sidebar -->
  <div
    class="{sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:relative z-20 w-72 h-full bg-gray-850 border-r border-gray-700 flex flex-col transition-transform duration-200"
  >
    <div class="p-4 border-b border-gray-700">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-bold">Pi Remote</h1>
        <button
          onclick={() => sidebarOpen = false}
          class="md:hidden text-gray-400 hover:text-white"
        >
          X
        </button>
      </div>
    </div>

    <ConnectionSettings
      host={appState.connected ? 'localhost' : 'localhost'}
      port={8765}
      token=""
      onConnected={handleConnected}
    />

    <!-- Connection status -->
    <div class="p-4 border-b border-gray-700">
      <div class="flex items-center gap-2">
        <div class="w-2.5 h-2.5 rounded-full {connected ? 'bg-green-500' : 'bg-red-500'}"></div>
        <span class="text-sm {connected ? 'text-green-400' : 'text-red-400'}">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      {#if sessionInfo.sessionFile}
        <div class="mt-2 space-y-1">
          {#if sessionInfo.cwd}
            <div class="text-xs text-gray-400 truncate" title={sessionInfo.cwd}>
              📁 {sessionInfo.cwd.split('/').pop() || sessionInfo.cwd}
            </div>
          {/if}
          {#if sessionInfo.model}
            <div class="text-xs text-gray-400 truncate" title={sessionInfo.model}>
              🤖 {sessionInfo.model}
            </div>
          {/if}
        </div>
      {/if}
      {#if appState.error && !connected}
        <div class="text-xs text-red-400 mt-2">
          {appState.error}
        </div>
      {/if}
    </div>

    <!-- Session Browser -->
    <div class="flex-1 overflow-hidden">
      <SessionBrowser />
    </div>

    <!-- Quick actions -->
    <div class="p-4 space-y-2 border-t border-gray-700">
      <button
        onclick={handleRefresh}
        class="w-full text-left text-sm text-gray-400 hover:text-white py-1.5 px-2 rounded hover:bg-gray-700 transition-colors"
      >
        Refresh Sessions
      </button>
      <button
        onclick={handleReconnect}
        class="w-full text-left text-sm text-gray-400 hover:text-white py-1.5 px-2 rounded hover:bg-gray-700 transition-colors"
      >
        Reconnect
      </button>
      <button
        onclick={handleDisconnect}
        class="w-full text-left text-sm text-gray-400 hover:text-white py-1.5 px-2 rounded hover:bg-gray-700 transition-colors"
      >
        Disconnect
      </button>
    </div>
  </div>

  <!-- Main content -->
  <div class="flex-1 flex flex-col min-w-0">
    <!-- Top bar -->
    <div class="flex items-center gap-3 p-3 border-b border-gray-700 bg-gray-850">
      <button
        onclick={() => sidebarOpen = !sidebarOpen}
        class="md:hidden text-gray-400 hover:text-white p-1"
      >
        =
      </button>

      <!-- Status indicator -->
      <div class="flex items-center gap-2 min-w-0">
        {#if appState.isStreaming}
          <span class="flex items-center gap-1.5 text-sm">
            <span class="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
            <span class="text-gray-300">Agent working...</span>
          </span>
        {:else if connected && sessionInfo.sessionFile}
          <span class="text-sm text-green-400">Ready</span>
        {:else if connected}
          <span class="text-sm text-gray-400">Select a session from sidebar</span>
        {:else}
          <span class="text-sm text-gray-400">Not connected</span>
        {/if}
      </div>

      <!-- Folder and model info -->
      {#if sessionInfo.sessionFile}
        <div class="flex-1 flex items-center gap-3 min-w-0">
          <!-- Folder -->
          {#if sessionInfo.cwd}
            <div class="flex items-center gap-1.5 text-xs text-gray-400 min-w-0">
              <span class="flex-shrink-0">📁</span>
              <span class="truncate" title={sessionInfo.cwd}>{sessionInfo.cwd.split('/').pop() || sessionInfo.cwd}</span>
            </div>
          {/if}

          <!-- Model selector -->
          {#if sessionInfo.model}
            <div class="flex items-center gap-1.5 text-xs min-w-0">
              <span class="flex-shrink-0">🤖</span>
              {#if models.length > 0 && !readOnly}
                <select
                  value={sessionInfo.model}
                  oninput={(e) => changeModel(e.currentTarget.value)}
                  class="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-gray-300 focus:outline-none focus:border-blue-500 truncate max-w-48"
                >
                  {#each models as model}
                    <option value={`${model.provider}:${model.modelId}`}>
                      {model.label}
                    </option>
                  {/each}
                </select>
              {:else}
                <span class="text-gray-400 truncate" title={sessionInfo.model}>{sessionInfo.model}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if readOnly}
        <span class="text-xs bg-yellow-600/30 text-yellow-400 px-2 py-1 rounded flex-shrink-0">Read-only</span>
      {/if}
    </div>

    <!-- Interruption notification -->
    {#if interrupted}
      <div class="bg-red-600/20 border border-red-500/50 text-red-400 text-sm px-4 py-2 text-center">
        Your session was interrupted — another client took over.
      </div>
    {/if}

    <!-- Session error notification -->
    {#if sError}
      <div class="bg-red-600/20 border border-red-500/50 text-red-400 text-sm px-4 py-2 flex items-center justify-between">
        <span>{sError}</span>
        <button onclick={() => dismissSessionError()} class="ml-2 text-red-300 hover:text-red-200">X</button>
      </div>
    {/if}

    <!-- Read-only banner -->
    {#if readOnly && !interrupted}
      <div class="bg-yellow-600/20 border border-yellow-500/50 text-yellow-400 text-sm px-4 py-2 text-center">
        Read-only: another session is active in this folder
      </div>
    {/if}

    <!-- Chat area -->
    <ChatMessageList bind:this={chatList} onMessageSent={() => {}} />

    <!-- Input -->
    <ChatInput disabled={!connected || appState.isStreaming || readOnly || !sessionInfo.sessionFile} onSend={() => chatList?.forceScrollToBottom()} />
  </div>

  <!-- Session Conflict Dialog -->
  <SessionConflictDialog />

  <!-- Overlay for mobile sidebar -->
  {#if sidebarOpen}
    <button
      type="button"
      class="fixed inset-0 bg-black/50 z-10 md:hidden"
      onclick={() => sidebarOpen = false}
      aria-label="Close sidebar"
    ></button>
  {/if}
</div>

<style>
  .bg-gray-850 {
    background-color: rgb(30, 30, 35);
  }
</style>

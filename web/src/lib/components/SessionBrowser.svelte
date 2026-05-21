<script lang="ts">
  import { sessionFolders, availableModels, fetchSessions, fetchModels, type ModelInfo } from '$lib/session-store';
  import { joinSession, createSession, leaveSession, activeSessionInfo, isConnected } from '$lib/pi-remote';
  import { onMount } from 'svelte';

  let folders = $derived($sessionFolders.folders);
  let loading = $derived($sessionFolders.loading);
  let currentSession = $derived($activeSessionInfo.sessionFile);
  let connected = $derived($isConnected);
  let models = $derived($availableModels.models);

  const collapsed = $state(new Set<string>());

  function toggleFolder(path: string) {
    if (collapsed.has(path)) {
      collapsed.delete(path);
    } else {
      collapsed.add(path);
    }
  }

  function handleSessionClick(sessionPath: string) {
    if (currentSession === sessionPath) return;
    leaveSession();
    setTimeout(() => {
      joinSession(sessionPath);
    }, 50);
  }

  function handleNewSession(folderPath: string) {
    const picker = $state({ open: false, folderPath, selected: '' });

    const defaultModel = models.find((m: ModelInfo) => m.isDefault);
    picker.selected = defaultModel ? `${defaultModel.provider}:${defaultModel.modelId}` : '';

    function create() {
      leaveSession();
      setTimeout(() => {
        createSession(folderPath, picker.selected || undefined);
      }, 50);
    }

    return { picker, create };
  }

  function formatRelative(timeStr: string): string {
    const diff = Date.now() - new Date(timeStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function truncate(text: string, max: number = 40): string {
    return text.length > max ? text.slice(0, max) + '...' : text;
  }

  onMount(() => {
    if (connected) {
      fetchSessions();
      fetchModels();
    }
  });
</script>

<div class="flex-1 overflow-y-auto">
  {#if loading}
    <div class="p-4 text-center text-gray-500">
      <div class="animate-spin inline-block w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full"></div>
      <span class="ml-2 text-sm">Loading sessions...</span>
    </div>
  {:else if folders.length === 0}
    <div class="p-4 text-center text-gray-500 text-sm">
      No sessions found
    </div>
  {:else}
    {#each folders as folder}
      <div class="border-b border-gray-700/50">
        <button
          onclick={() => toggleFolder(folder.path)}
          class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-700/50 transition-colors"
        >
          <span class="text-xs text-gray-500 transition-transform {collapsed.has(folder.path) ? '' : 'rotate-90'}">
            ▶
          </span>
          <span class="text-sm font-medium text-gray-300 flex-1 truncate">{folder.name}</span>
          <span class="text-xs text-gray-500">{folder.sessions.length}</span>
        </button>

        {#if !collapsed.has(folder.path)}
          <div class="px-3 pb-2">
            <div class="relative">
              <button
                onclick={() => {
                  if (connected) {
                    const { picker, create } = handleNewSession(folder.path);
                    picker.open = true;
                    const result = confirm(`Create new session in ${folder.name}?`);
                    if (result) {
                      create();
                    }
                  }
                }}
                class="w-full text-xs text-blue-400 hover:text-blue-300 py-1 px-2 rounded hover:bg-gray-700/50 transition-colors text-left"
              >
                + New Session Here
              </button>
            </div>

            {#each folder.sessions as session}
              <button
                onclick={() => handleSessionClick(session.path)}
                class="w-full flex items-center gap-2 py-1.5 px-2 rounded text-left hover:bg-gray-700/50 transition-colors {currentSession === session.path ? 'bg-gray-700' : ''}"
              >
                {#if session.isActive}
                  <span class="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span>
                {:else}
                  <span class="w-2 h-2 rounded-full bg-gray-600 flex-shrink-0"></span>
                {/if}
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-gray-300 truncate">
                    {session.name || truncate(session.firstMessage) || 'Empty session'}
                  </div>
                  <div class="text-xs text-gray-500">
                    {formatRelative(session.modified)} · {session.messageCount} msgs
                  </div>
                </div>
                {#if session.clientCount > 0}
                  <span class="text-xs bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded">{session.clientCount}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

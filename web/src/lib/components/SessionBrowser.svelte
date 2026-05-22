<script lang="ts">
  import { sessionFolders, availableModels, fetchSessions, fetchModels, setCurrentSession, type ModelInfo } from '$lib/session-store';
  import { joinSession, createSession, leaveSession, activeSessionInfo, isConnected, sessionError, dismissSessionError } from '$lib/pi-remote';

  let folders = $derived($sessionFolders.folders);
  let loading = $derived($sessionFolders.loading);
  let currentSession = $derived($activeSessionInfo.sessionFile);
  let connected = $derived($isConnected);
  let models = $derived($availableModels.models);

  let collapsed = $state<Record<string, boolean>>({});

  // Auto-fetch sessions on connect and periodically
  $effect(() => {
    if (connected) {
      fetchSessions();
      fetchModels();
    }
  });

  function toggleFolder(path: string) {
    if (collapsed[path]) {
      delete collapsed[path];
    } else {
      collapsed[path] = true;
    }
  }

  function handleSessionClick(sessionPath: string) {
    if (currentSession === sessionPath) return;
    dismissSessionError();
    if (currentSession) {
      leaveSession();
      setTimeout(() => {
        joinSession(sessionPath);
      }, 100);
    } else {
      joinSession(sessionPath);
    }
  }

  // New session picker state
  let newSessionPicker = $state<{ open: boolean; folderPath: string; selected: string }>({
    open: false,
    folderPath: '',
    selected: '',
  });

  function openNewSessionPicker(folderPath: string) {
    const defaultModel = models.find((m: ModelInfo) => m.isDefault);
    newSessionPicker = {
      open: true,
      folderPath,
      selected: defaultModel ? `${defaultModel.provider}:${defaultModel.modelId}` : '',
    };
  }

  function closeNewSessionPicker() {
    newSessionPicker.open = false;
  }

  function handleCreateSession() {
    if (!newSessionPicker.open) return;
    dismissSessionError();
    const folderPath = newSessionPicker.folderPath;
    const model = newSessionPicker.selected || undefined;
    closeNewSessionPicker();
    if (currentSession) {
      leaveSession();
      setTimeout(() => {
        createSession(folderPath, model);
      }, 100);
    } else {
      createSession(folderPath, model);
    }
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
</script>

<div class="h-full overflow-y-auto">
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
          <span class="text-xs text-gray-500 transition-transform {collapsed[folder.path] ? '' : 'rotate-90'}">
            ▶
          </span>
          <span class="text-sm font-medium text-gray-300 flex-1 truncate">{folder.name}</span>
          <span class="text-xs text-gray-500">{folder.sessions.length}</span>
        </button>

        {#if !collapsed[folder.path]}
          <div class="px-3 pb-2">
            <button
              onclick={() => openNewSessionPicker(folder.path)}
              class="w-full text-xs text-blue-400 hover:text-blue-300 py-1 px-2 rounded hover:bg-gray-700/50 transition-colors text-left mb-1"
            >
              + New Session Here
            </button>

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

<!-- New Session Picker Dialog -->
{#if newSessionPicker.open}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" role="presentation" onclick={closeNewSessionPicker}>
  <div class="bg-gray-800 border border-gray-700 rounded-lg p-6 w-80" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <h3 class="text-sm font-bold mb-4">New Session</h3>
    <div class="mb-4">
      <span class="block text-xs text-gray-400 mb-1">Folder</span>
      <div class="text-xs bg-gray-700 rounded px-2 py-1.5 truncate">
        {newSessionPicker.folderPath}
      </div>
    </div>
    <div class="mb-4">
      <label class="block text-xs text-gray-400 mb-1" for="model-select">Model</label>
      {#if models.length > 0}
        <select
          id="model-select"
          bind:value={newSessionPicker.selected}
          class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
        >
          {#each models as model}
            <option value={`${model.provider}:${model.modelId}`}>
              {model.label}{model.isDefault ? ' (default)' : ''}
            </option>
          {/each}
        </select>
      {:else}
        <input
          id="model-select"
          type="text"
          bind:value={newSessionPicker.selected}
          placeholder="provider:model"
          class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500"
        />
      {/if}
    </div>
    <div class="flex gap-2 justify-end">
      <button
        onclick={closeNewSessionPicker}
        class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
      >
        Cancel
      </button>
      <button
        onclick={handleCreateSession}
        class="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
      >
        Create
      </button>
    </div>
  </div>
</div>
{/if}

<!-- Session Error -->
{#if $sessionError}
<div class="absolute bottom-0 left-0 right-0 bg-red-600/20 border-t border-red-500/50 text-red-400 text-xs px-3 py-2 flex items-center justify-between">
  <span class="truncate">{sessionError}</span>
  <button onclick={() => dismissSessionError()} class="ml-2 text-red-300 hover:text-red-200 flex-shrink-0">✕</button>
</div>
{/if}

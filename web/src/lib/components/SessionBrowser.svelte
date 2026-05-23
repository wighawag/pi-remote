<script lang="ts">
	import {
		sessionFolders,
		availableModels,
		fetchSessions,
		fetchModels,
		setCurrentSession,
		type ModelInfo,
		type FolderWithSessions,
	} from '$lib/session-store';
	import {
		joinSession,
		createSession,
		leaveSession,
		activeSessionInfo,
		isConnected,
		sessionError,
		dismissSessionError,
	} from '$lib/pi-remote';

	let folders = $derived($sessionFolders.folders);
	let loading = $derived($sessionFolders.loading);
	let currentSession = $derived($activeSessionInfo.sessionFile);
	let connected = $derived($isConnected);
	let models = $derived($availableModels.models);

	let collapsed = $state<Record<string, boolean>>({});
	let searchQuery = $state('');
	let filteredFolders = $state<FolderWithSessions[]>([]);

	// Auto-fetch sessions on connect and periodically
	$effect(() => {
		if (connected) {
			fetchSessions();
			fetchModels();
		}
	});

	function matchesFilter(
		session: (typeof folders)[number]['sessions'][number],
		folderName: string,
		query: string,
	): boolean {
		if (!query) return true;
		const q = query.toLowerCase();
		return (
			(session.name || '').toLowerCase().includes(q) ||
			session.firstMessage.toLowerCase().includes(q) ||
			folderName.toLowerCase().includes(q)
		);
	}

	$effect(() => {
		const q = searchQuery;
		const foldersArr = folders;
		if (!q) {
			filteredFolders = foldersArr;
		} else {
			filteredFolders = foldersArr
				.map((folder) => ({
					...folder,
					sessions: folder.sessions.filter(
						(s: (typeof folder)['sessions'][number]) =>
							matchesFilter(s, folder.name, q),
					),
				}))
				.filter((folder) => folder.sessions.length > 0);
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
	let newSessionPicker = $state<{
		open: boolean;
		folderPath: string;
		selected: string;
	}>({
		open: false,
		folderPath: '',
		selected: '',
	});

	function openNewSessionPicker(folderPath: string) {
		const defaultModel = models.find((m: ModelInfo) => m.isDefault);
		newSessionPicker = {
			open: true,
			folderPath,
			selected: defaultModel
				? `${defaultModel.provider}:${defaultModel.modelId}`
				: '',
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

<div class="flex h-full flex-col">
	<div class="border-b border-gray-700/50 p-2">
		<input
			type="text"
			placeholder="Filter sessions..."
			value={searchQuery}
			oninput={(e) => (searchQuery = e.currentTarget.value)}
			class="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
		/>
	</div>

	<div class="flex-1 overflow-y-auto">
		{#if loading}
			<div class="p-4 text-center text-gray-500">
				<div
					class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent"
				></div>
				<span class="ml-2 text-sm">Loading sessions...</span>
			</div>
		{:else if filteredFolders.length === 0}
			<div class="p-4 text-center text-sm text-gray-500">
				{searchQuery ? 'No sessions match your filter' : 'No sessions found'}
			</div>
		{:else}
			{#each filteredFolders as folder}
				<div class="border-b border-gray-700/50">
					<button
						onclick={() => toggleFolder(folder.path)}
						class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-700/50"
					>
						<span
							class="text-xs text-gray-500 transition-transform {collapsed[
								folder.path
							]
								? ''
								: 'rotate-90'}"
						>
							▶
						</span>
						<span class="flex-1 truncate text-sm font-medium text-gray-300"
							>{folder.name}</span
						>
						<span class="text-xs text-gray-500">{folder.sessions.length}</span>
					</button>

					{#if !collapsed[folder.path]}
						<div class="px-3 pb-2">
							<button
								onclick={() => openNewSessionPicker(folder.path)}
								class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-blue-400 transition-colors hover:bg-gray-700/50 hover:text-blue-300"
							>
								+ New Session Here
							</button>

							{#each folder.sessions as session}
								<button
									onclick={() => handleSessionClick(session.path)}
									class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-gray-700/50 {currentSession ===
									session.path
										? 'bg-gray-700'
										: ''}"
								>
									{#if session.isActive}
										<span
											class="h-2 w-2 flex-shrink-0 rounded-full bg-green-500"
										></span>
									{:else}
										<span class="h-2 w-2 flex-shrink-0 rounded-full bg-gray-600"
										></span>
									{/if}
									<div class="min-w-0 flex-1">
										<div class="truncate text-xs text-gray-300">
											{session.name ||
												truncate(session.firstMessage) ||
												'Empty session'}
										</div>
										<div class="text-xs text-gray-500">
											{formatRelative(session.modified)} · {session.messageCount}
											msgs
										</div>
									</div>
									{#if session.clientCount > 0}
										<span
											class="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-300"
											>{session.clientCount}</span
										>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<!-- New Session Picker Dialog -->
{#if newSessionPicker.open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
		role="presentation"
		onclick={closeNewSessionPicker}
	>
		<div
			class="w-80 rounded-lg border border-gray-700 bg-gray-800 p-6"
			role="dialog"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<h3 class="mb-4 text-sm font-bold">New Session</h3>
			<div class="mb-4">
				<span class="mb-1 block text-xs text-gray-400">Folder</span>
				<div class="truncate rounded bg-gray-700 px-2 py-1.5 text-xs">
					{newSessionPicker.folderPath}
				</div>
			</div>
			<div class="mb-4">
				<label class="mb-1 block text-xs text-gray-400" for="model-select"
					>Model</label
				>
				{#if models.length > 0}
					<select
						id="model-select"
						bind:value={newSessionPicker.selected}
						class="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1.5 text-xs text-white"
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
						class="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1.5 text-xs text-white placeholder-gray-500"
					/>
				{/if}
			</div>
			<div class="flex justify-end gap-2">
				<button
					onclick={closeNewSessionPicker}
					class="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600"
				>
					Cancel
				</button>
				<button
					onclick={handleCreateSession}
					class="rounded bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-700"
				>
					Create
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Session Error -->
{#if $sessionError}
	<div
		class="absolute right-0 bottom-0 left-0 flex items-center justify-between border-t border-red-500/50 bg-red-600/20 px-3 py-2 text-xs text-red-400"
	>
		<span class="truncate">{$sessionError}</span>
		<button
			onclick={() => dismissSessionError()}
			class="ml-2 flex-shrink-0 text-red-300 hover:text-red-200">✕</button
		>
	</div>
{/if}

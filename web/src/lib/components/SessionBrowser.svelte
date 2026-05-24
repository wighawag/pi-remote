<script lang="ts">
	import {
		sessionFolders,
		availableModels,
		fetchSessions,
		fetchModels,
		fetchConfig,
		gitInitDefaultStore,
		checkPath,
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
			fetchConfig();
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

	// Collapsible Sidebar form state
	let createFormOpen = $state(false);
	let sidebarCwd = $state('');
	let sidebarModel = $state('');
	let sidebarGitInit = $state(false);
	let userManualSidebarGitInit = $state<boolean | null>(null);
	let sidebarCreateRemote = $state(true);
	let sidebarRepoVisibility = $state<'private' | 'public'>('private');
	let showSidebarGitConfirmModal = $state(false);

	let defaultGitInit = $derived($gitInitDefaultStore);

	// Sync git init default
	$effect(() => {
		if (userManualSidebarGitInit === null) {
			sidebarGitInit = defaultGitInit;
		}
	});

	let sidebarPathStatus = $state<{
		exists: boolean | null;
		isGit: boolean;
		resolvedPath: string;
		matchingRule: { provider: string; visibility: string } | null;
	}>({
		exists: null,
		isGit: false,
		resolvedPath: '',
		matchingRule: null,
	});

	let sidebarPathCheckTimeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const pathValue = sidebarCwd;
		if (sidebarPathCheckTimeout) clearTimeout(sidebarPathCheckTimeout);

		if (!pathValue.trim()) {
			sidebarPathStatus = { exists: null, isGit: false, resolvedPath: '', matchingRule: null };
			return;
		}

		sidebarPathCheckTimeout = setTimeout(async () => {
			const res = await checkPath(pathValue);
			if (res) {
				sidebarPathStatus = {
					exists: res.exists,
					isGit: res.isGit,
					resolvedPath: res.resolvedPath,
					matchingRule: (res as any).matchingRule || null
				};
				if (!res.exists) {
					sidebarGitInit = userManualSidebarGitInit !== null ? userManualSidebarGitInit : defaultGitInit;
					sidebarCreateRemote = true; // reset to true for non-existing folders
					if ((res as any).matchingRule) {
						sidebarRepoVisibility = (res as any).matchingRule.visibility as 'private' | 'public';
					}
				}
			} else {
				sidebarPathStatus = { exists: null, isGit: false, resolvedPath: '', matchingRule: null };
			}
		}, 300);
	});

	// Select default model if any
	$effect(() => {
		if (models.length > 0 && !sidebarModel) {
			const defaultModel = models.find((m: ModelInfo) => m.isDefault);
			if (defaultModel) {
				sidebarModel = `${defaultModel.provider}:${defaultModel.modelId}`;
			} else {
				sidebarModel = `${models[0].provider}:${models[0].modelId}`;
			}
		}
	});

	function handleSidebarCreateSession() {
		if (!sidebarCwd.trim()) return;
		if (sidebarPathStatus.exists === true) {
			sidebarGitInit = false; // toggled off by default in modal
			sidebarCreateRemote = false; // toggled off by default in modal
			if (sidebarPathStatus.matchingRule) {
				sidebarRepoVisibility = sidebarPathStatus.matchingRule.visibility as 'private' | 'public';
			}
			showSidebarGitConfirmModal = true;
		} else {
			dismissSessionError();
			const cwd = sidebarCwd.trim();
			const model = sidebarModel || undefined;
			const gitInit = sidebarGitInit;
			const createRemote = sidebarPathStatus.matchingRule ? sidebarCreateRemote : undefined;
			const repoVisibility = sidebarPathStatus.matchingRule ? sidebarRepoVisibility : undefined;
			
			// Reset state
			sidebarCwd = '';
			createFormOpen = false;

			if (currentSession) {
				leaveSession();
				setTimeout(() => {
					createSession(cwd, model, gitInit, createRemote, repoVisibility);
				}, 100);
			} else {
				createSession(cwd, model, gitInit, createRemote, repoVisibility);
			}
		}
	}

	function handleSidebarConfirmModalSubmit() {
		showSidebarGitConfirmModal = false;
		dismissSessionError();
		const cwd = sidebarCwd.trim();
		const model = sidebarModel || undefined;
		const gitInit = sidebarGitInit;
		const createRemote = sidebarPathStatus.matchingRule ? sidebarCreateRemote : undefined;
		const repoVisibility = sidebarPathStatus.matchingRule ? sidebarRepoVisibility : undefined;

		// Reset state
		sidebarCwd = '';
		createFormOpen = false;

		if (currentSession) {
			leaveSession();
			setTimeout(() => {
				createSession(cwd, model, gitInit, createRemote, repoVisibility);
			}, 100);
		} else {
			createSession(cwd, model, gitInit, createRemote, repoVisibility);
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
		<!-- Collapsible Create New Session Section -->
		<div class="border-b border-gray-700/50 bg-gray-800/10">
			<button
				onclick={() => (createFormOpen = !createFormOpen)}
				class="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-blue-400 transition-colors hover:bg-gray-700/30"
			>
				<span>{createFormOpen ? '▼ Close Create Session' : '✚ Create New Session'}</span>
			</button>
			
			{#if createFormOpen}
				<form onsubmit={(e) => { e.preventDefault(); handleSidebarCreateSession(); }} class="space-y-2.5 p-3 border-t border-gray-700/30 bg-gray-800/30">
					<div>
						<label class="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1" for="sidebar-folder">Folder Path</label>
						<input
							id="sidebar-folder"
							type="text"
							placeholder="e.g. ~/projects/my-new-app"
							bind:value={sidebarCwd}
							class="w-full rounded border border-gray-600 bg-gray-900/60 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
						/>
						{#if sidebarPathStatus.exists === true}
							<span class="text-[10px] text-yellow-400 mt-1 block font-medium">
								📁 Folder already exists.
								{#if sidebarPathStatus.isGit}
									<span class="text-green-400 ml-1 font-semibold">(Git repo)</span>
								{/if}
							</span>
						{/if}
					</div>
					
					<div>
						<label class="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1" for="sidebar-model">Model</label>
						{#if models.length > 0}
							<select
								id="sidebar-model"
								bind:value={sidebarModel}
								class="w-full rounded border border-gray-600 bg-gray-900/60 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
							>
								{#each models as model}
									<option value={`${model.provider}:${model.modelId}`}>
										{model.label}{model.isDefault ? ' (default)' : ''}
									</option>
								{/each}
							</select>
						{:else}
							<input
								id="sidebar-model"
								type="text"
								bind:value={sidebarModel}
								placeholder="provider:model"
								class="w-full rounded border border-gray-600 bg-gray-900/60 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
							/>
						{/if}
					</div>

					{#if sidebarPathStatus.exists !== true && sidebarPathStatus.matchingRule}
						<div class="space-y-1 py-0.5">
							<div class="flex items-center gap-1.5">
								<input
									id="sidebar-create-remote"
									type="checkbox"
									bind:checked={sidebarCreateRemote}
									class="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
								/>
								<label for="sidebar-create-remote" class="text-xs text-gray-300 select-none cursor-pointer">
									Create remote {sidebarPathStatus.matchingRule.provider} repository
								</label>
							</div>
							
							{#if sidebarCreateRemote}
								<div class="flex items-center gap-3 pl-5 text-[10px] text-gray-400">
									<span>Visibility:</span>
									<label class="flex items-center gap-1 select-none cursor-pointer hover:text-white transition-colors">
										<input type="radio" name="sidebar-visibility" value="private" bind:group={sidebarRepoVisibility} class="text-blue-600 bg-gray-800 border-gray-750 focus:ring-blue-500" />
										Private
									</label>
									<label class="flex items-center gap-1 select-none cursor-pointer hover:text-white transition-colors">
										<input type="radio" name="sidebar-visibility" value="public" bind:group={sidebarRepoVisibility} class="text-blue-600 bg-gray-800 border-gray-750 focus:ring-blue-500" />
										Public
									</label>
								</div>
							{/if}
						</div>
					{/if}

					{#if sidebarPathStatus.exists !== true && (!sidebarPathStatus.matchingRule || !sidebarCreateRemote)}
						<div class="flex items-center gap-1.5 py-0.5">
							<input
								id="sidebar-git-init"
								type="checkbox"
								bind:checked={sidebarGitInit}
								onchange={(e) => { userManualSidebarGitInit = e.currentTarget.checked; }}
								class="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
							/>
							<label for="sidebar-git-init" class="text-xs text-gray-300 select-none cursor-pointer">
								Initialize Git repository
							</label>
						</div>
					{/if}

					<button
						type="submit"
						disabled={!sidebarCwd.trim()}
						class="w-full rounded bg-blue-600 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						Create Session
					</button>
				</form>
			{/if}
		</div>

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

<!-- Sidebar Git Init Confirm Dialog -->
{#if showSidebarGitConfirmModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true">
		<div class="w-80 rounded-lg border border-gray-700 bg-gray-800 p-5 text-gray-300">
			<h3 class="text-sm font-bold text-white mb-2">Folder Already Exists</h3>
			<p class="text-xs text-gray-400 mb-3">
				The folder <span class="text-gray-200 font-mono text-[11px] break-all">{sidebarCwd}</span> already exists. Do you want to initialize a Git repository in it?
			</p>

			<div class="flex flex-col gap-3 mb-4">
				<div class="flex items-center gap-1.5">
					<input
						id="sidebar-modal-git-init"
						type="checkbox"
						bind:checked={sidebarGitInit}
						disabled={sidebarPathStatus.isGit}
						class="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
					/>
					<label for="sidebar-modal-git-init" class="text-xs text-gray-300 select-none cursor-pointer disabled:opacity-50">
						Initialize Git repository
						{#if sidebarPathStatus.isGit}
							<span class="text-[10px] text-gray-500 ml-1">(already a Git repo)</span>
						{:else}
							<span class="text-[10px] text-yellow-500 ml-1 font-medium">(folder not empty)</span>
						{/if}
					</label>
				</div>

				{#if sidebarPathStatus.matchingRule}
					<div class="space-y-1">
						<div class="flex items-center gap-1.5">
							<input
								id="sidebar-modal-create-remote"
								type="checkbox"
								bind:checked={sidebarCreateRemote}
								class="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
							/>
							<label for="sidebar-modal-create-remote" class="text-xs text-gray-300 select-none cursor-pointer">
								Create remote {sidebarPathStatus.matchingRule.provider} repository
							</label>
						</div>
						
						{#if sidebarCreateRemote}
							<div class="flex items-center gap-3 pl-5 text-[10px] text-gray-400">
								<span>Visibility:</span>
								<label class="flex items-center gap-1 select-none cursor-pointer hover:text-white transition-colors">
									<input type="radio" name="sidebar-modal-visibility" value="private" bind:group={sidebarRepoVisibility} class="text-blue-600 bg-gray-800 border-gray-750 focus:ring-blue-500" />
									Private
								</label>
								<label class="flex items-center gap-1 select-none cursor-pointer hover:text-white transition-colors">
									<input type="radio" name="sidebar-modal-visibility" value="public" bind:group={sidebarRepoVisibility} class="text-blue-600 bg-gray-800 border-gray-750 focus:ring-blue-500" />
									Public
								</label>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (showSidebarGitConfirmModal = false)}
					class="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={handleSidebarConfirmModalSubmit}
					class="rounded bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-700"
				>
					Confirm & Create
				</button>
			</div>
		</div>
	</div>
{/if}

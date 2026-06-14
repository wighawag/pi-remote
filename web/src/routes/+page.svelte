<script lang="ts">
	import Head from '$lib/Head.svelte';
	import ConnectionSettings from '$lib/components/ConnectionSettings.svelte';
	import ChatMessageList from '$lib/components/ChatMessageList.svelte';
	import ChatInput from '$lib/components/ChatInput.svelte';
	import SessionBrowser from '$lib/components/SessionBrowser.svelte';
	import SessionConflictDialog from '$lib/components/SessionConflictDialog.svelte';
	import {
		piState,
		isConnected,
		isInterrupted,
		sessionError,
		isReadOnly,
		activeSessionInfo,
		connect,
		disconnect,
		leaveSession,
		dismissSessionError,
		changeModel,
		joinSession,
		isCreatingSession,
		runSearch,
	} from '$lib/wherever';
	import {
		fetchSessions,
		availableModels,
		searchFolderStore,
	} from '$lib/session-store';
	import {onMount} from 'svelte';
	import {url} from '$lib/core/utils/web/path';

	let sidebarOpen = $state(false);
	let showSettings = $state(false);
	let autoConnect = $state(true);
	let interruptedTimeout: ReturnType<typeof setTimeout> | null = null;
	let chatList: {forceScrollToBottom: () => void};

	onMount(() => {
		if (autoConnect) {
			setTimeout(() => connect(), 200);
		}

		const handleHashChange = () => {
			if (connected) {
				const hashId = window.location.hash
					? decodeURIComponent(window.location.hash.slice(1))
					: '';
				if (hashId && hashId !== currentSessionId) {
					if (currentSessionId) {
						leaveSession();
						setTimeout(() => joinSession(hashId), 100);
					} else {
						joinSession(hashId);
					}
				} else if (!hashId && currentSessionId) {
					leaveSession();
				}
			}
		};

		window.addEventListener('hashchange', handleHashChange);

		// --- Background/resume handling (esp. Firefox Android screen-lock) ---
		// While the page is backgrounded we close the WebSocket. An open WS makes
		// the page ineligible for the browser's back/forward cache, which on
		// mobile pushes the browser toward a full, slow reload on resume. Closing
		// it improves bfcache eligibility (instant restore) and, when a real
		// reload does happen, the active session is restored from the URL hash.
		// The disconnect is delayed so quick tab switches don't churn the
		// connection; reconnect is immediate on return.
		let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
		const HIDE_DISCONNECT_DELAY = 8000;

		const handleVisibility = () => {
			if (document.visibilityState === 'hidden') {
				if (hiddenTimer) clearTimeout(hiddenTimer);
				hiddenTimer = setTimeout(() => {
					hiddenTimer = null;
					if (document.visibilityState === 'hidden' && connected) {
						disconnect();
					}
				}, HIDE_DISCONNECT_DELAY);
			} else {
				if (hiddenTimer) {
					clearTimeout(hiddenTimer);
					hiddenTimer = null;
				}
				if (!connected) {
					connect();
				}
			}
		};

		const handlePageShow = (e: PageTransitionEvent) => {
			// On bfcache restore (e.persisted) or any return to a visible page,
			// ensure we are connected. The client rejoins the hash session.
			if (hiddenTimer) {
				clearTimeout(hiddenTimer);
				hiddenTimer = null;
			}
			if (document.visibilityState !== 'hidden' && !connected) {
				connect();
			}
		};

		document.addEventListener('visibilitychange', handleVisibility);
		window.addEventListener('pageshow', handlePageShow);

		return () => {
			window.removeEventListener('hashchange', handleHashChange);
			document.removeEventListener('visibilitychange', handleVisibility);
			window.removeEventListener('pageshow', handlePageShow);
			if (hiddenTimer) clearTimeout(hiddenTimer);
		};
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

	function handleShowMainScreen() {
		if (typeof window !== 'undefined') {
			window.location.hash = '';
		}
		leaveSession();
		sidebarOpen = false;
	}

	let connected = $derived($isConnected);
	let interrupted = $derived($isInterrupted);
	let sError = $derived($sessionError);
	let readOnly = $derived($isReadOnly);
	let sessionInfo = $derived($activeSessionInfo);
	let appState = $derived($piState);
	let models = $derived($availableModels.models);

	let hasJoinedFromHash = $state(false);
	let wasSessionActive = $state(false);
	let currentSessionId = $derived(sessionInfo.sessionId);

	// Update hash when sessionId changes, only if connected to prevent clearing on reload
	$effect(() => {
		if (typeof window !== 'undefined' && connected) {
			if (currentSessionId) {
				window.location.hash = encodeURIComponent(currentSessionId);
				wasSessionActive = true;
			} else if (wasSessionActive) {
				wasSessionActive = false;
				if (window.location.hash) {
					window.location.hash = '';
				}
			}
		}
	});

	// Auto-join session from hash when connected
	$effect(() => {
		if (
			connected &&
			typeof window !== 'undefined' &&
			window.location.hash &&
			!hasJoinedFromHash
		) {
			const hashId = decodeURIComponent(window.location.hash.slice(1));
			if (hashId) {
				hasJoinedFromHash = true;
				setTimeout(() => {
					joinSession(hashId);
				}, 300);
			}
		}
	});

	// Reset guard flag on disconnect
	$effect(() => {
		if (!connected) {
			hasJoinedFromHash = false;
			wasSessionActive = false;
		}
	});

	// Close sidebar on mobile when a session is joined
	$effect(() => {
		if (currentSessionId) {
			sidebarOpen = false;
		}
	});

	let isCreating = $derived($isCreatingSession);
	let searchFolder = $derived($searchFolderStore);

	// The bottom composer is always mounted but mode-switched: it acts as the
	// search composer when connected, a search folder is configured, and no
	// session is active. Keeping it mounted (not conditionally rendered) means it
	// exists at tap time so we can focus it synchronously inside a user gesture.
	let chatInput: {focusInput: () => void} | undefined = $state();
	let searchActive = $derived(
		connected && !!searchFolder && !sessionInfo.sessionFile,
	);

	// On page load with no session, focus the search composer so it is ready to
	// type. (One-shot; not inside the tap path, so no mobile-keyboard concern.)
	let hasFocusedSearch = $state(false);
	$effect(() => {
		if (searchActive && !hasFocusedSearch && chatInput) {
			hasFocusedSearch = true;
			chatInput.focusInput();
		}
	});

	// Top-bar magnifier (active-session case): leave the session and focus the
	// search composer SYNCHRONOUSLY inside this gesture so the mobile virtual
	// keyboard rises (focusing later from a reactive effect would not, esp. iOS).
	function startSearch() {
		// Clear the hash synchronously so the chat area drops straight to the
		// search empty-state instead of flashing the "Loading session..." spinner
		// (ChatMessageList reads window.location.hash, which is not reactive).
		if (typeof window !== 'undefined' && window.location.hash) {
			window.location.hash = '';
		}
		leaveSession();
		chatInput?.focusInput();
	}
</script>

<Head title="Wherever" description="Create & maintain apps from wherever" />

{#if isCreating}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-brand-dark/60 backdrop-blur-sm"
	>
		<div class="flex flex-col items-center gap-4">
			<div
				class="h-12 w-12 animate-spin rounded-full border-4 border-brand-blue border-t-transparent"
			></div>
			<span class="text-lg font-bold text-brand-text">Creating session...</span>
		</div>
	</div>
{/if}

<div
	class="fixed inset-0 flex overflow-hidden overscroll-none bg-brand-dark text-brand-text"
>
	<!-- Sidebar -->
	<div
		class="{sidebarOpen
			? 'translate-x-0'
			: '-translate-x-full'} fixed z-20 flex h-full w-72 flex-col border-r border-brand-border bg-brand-surface transition-transform duration-200 md:relative md:translate-x-0"
	>
		<div class="border-b border-brand-border bg-brand-surface-2/20 p-4">
			<div class="flex items-center justify-between">
				{#if showSettings}
					<span class="text-lg font-bold text-brand-text"
						>Connection Settings</span
					>
					<button
						onclick={() => (showSettings = false)}
						class="rounded px-2 py-1 text-xs font-semibold text-brand-blue transition-colors hover:bg-brand-surface-2 hover:text-brand-blue"
					>
						◀ Back
					</button>
				{:else}
					<button
						onclick={handleShowMainScreen}
						class="flex items-center gap-2 text-left"
						title="Show Main Screen / New Session"
					>
						<img src={url('/logo.svg')} alt="Wherever" class="h-6 w-6" />
						<span class="gradient-text text-lg font-bold">Wherever</span>
					</button>
					<div class="flex items-center gap-2">
						<button
							onclick={() => (showSettings = true)}
							class="flex items-center gap-1 rounded border border-brand-border px-1.5 py-1 text-xs text-brand-text-muted transition-colors hover:bg-brand-surface-2 hover:text-brand-text"
							title="Connection Settings"
						>
							⚙️ Config
						</button>
						<button
							onclick={() => (sidebarOpen = false)}
							class="text-brand-text-muted hover:text-brand-text md:hidden"
						>
							X
						</button>
					</div>
				{/if}
			</div>
		</div>

		{#if showSettings}
			<div class="flex-1 overflow-y-auto">
				<ConnectionSettings
					host={appState.connected ? 'localhost' : 'localhost'}
					port={31415}
					token=""
					onConnected={handleConnected}
				/>

				<div class="mt-2 border-t border-brand-border p-4">
					<h3
						class="mb-3 text-xs font-bold tracking-wider text-brand-text-muted uppercase"
					>
						Server Control
					</h3>
					<div class="space-y-2">
						<button
							onclick={handleRefresh}
							class="flex w-full items-center justify-between rounded border border-brand-border bg-brand-surface-2 px-3 py-2 text-left text-sm text-brand-text transition-colors hover:bg-brand-surface-3 hover:text-brand-text"
						>
							<span>Refresh Session List</span>
							<span>🔄</span>
						</button>
						<button
							onclick={handleReconnect}
							class="flex w-full items-center justify-between rounded border border-brand-border bg-brand-surface-2 px-3 py-2 text-left text-sm text-brand-text transition-colors hover:bg-brand-surface-3 hover:text-brand-text"
						>
							<span>Reconnect WebSocket</span>
							<span>🔌</span>
						</button>
						<button
							onclick={handleDisconnect}
							class="flex w-full items-center justify-between rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-left text-sm text-rose-400 transition-colors hover:bg-red-500/20 hover:text-rose-300"
						>
							<span>Disconnect Server</span>
							<span>🛑</span>
						</button>
					</div>
				</div>
			</div>
		{:else}
			<!-- Connection status -->
			<div class="border-b border-brand-border p-4">
				<div class="flex items-center gap-2">
					<div
						class="h-2.5 w-2.5 rounded-full {connected
							? 'bg-emerald-500'
							: 'bg-rose-500'}"
					></div>
					<span
						class="text-sm {connected ? 'text-emerald-400' : 'text-rose-400'}"
					>
						{connected ? 'Connected' : 'Disconnected'}
					</span>
				</div>
				{#if sessionInfo.sessionFile}
					<div class="mt-2 space-y-1">
						{#if sessionInfo.cwd}
							<div
								class="truncate text-xs text-brand-text-muted"
								title={sessionInfo.cwd}
							>
								📁 {sessionInfo.cwd.split('/').pop() || sessionInfo.cwd}
							</div>
						{/if}
						{#if sessionInfo.model}
							<div
								class="truncate text-xs text-brand-text-muted"
								title={sessionInfo.model}
							>
								🤖 {sessionInfo.model}
							</div>
						{/if}
						<div class="pt-1.5">
							<button
								onclick={handleShowMainScreen}
								class="w-full rounded border border-brand-border bg-brand-surface-2 px-2 py-1 text-center text-xs text-brand-text transition-colors hover:bg-brand-surface-3 hover:text-brand-text"
								title="Show Main Screen (Clear URL Hash)"
							>
								Close Session
							</button>
						</div>
					</div>
				{/if}
				{#if appState.error && !connected}
					<div class="mt-2 text-xs text-rose-400">
						{appState.error}
					</div>
				{/if}
			</div>

			<!-- Session Browser -->
			<div class="flex-1 overflow-hidden">
				<SessionBrowser />
			</div>
		{/if}
	</div>

	<!-- Main content -->
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Top bar -->
		<div
			class="flex items-center gap-3 border-b border-brand-border bg-brand-surface p-3"
		>
			<button
				onclick={() => (sidebarOpen = !sidebarOpen)}
				class="p-1 text-brand-text-muted hover:text-brand-text md:hidden"
			>
				=
			</button>

			<!-- Compact search affordance (active-session case): drop to the search
			     empty-state. Hidden in the empty-state itself, where the bottom
			     composer already IS the search input. -->
			{#if connected && searchFolder && sessionInfo.sessionFile}
				<button
					type="button"
					onclick={startSearch}
					class="flex flex-shrink-0 items-center justify-center rounded border border-brand-border bg-brand-surface-2 px-2.5 py-1.5 text-sm text-brand-text-muted transition-colors hover:bg-brand-surface-3 hover:text-brand-text"
					title="Search the web"
					aria-label="Search the web"
				>
					🔍
				</button>
			{/if}

			<!-- Status indicator -->
			{#if !connected || !sessionInfo.sessionFile}
				<div class="flex min-w-0 items-center gap-2">
					{#if connected && searchActive}
						<span class="text-sm text-brand-text-muted"
							>Search the web below, or pick a session from the sidebar</span
						>
					{:else if connected}
						<span class="text-sm text-brand-text-muted"
							>Select a session from sidebar</span
						>
					{:else}
						<span class="text-sm text-brand-text-muted">Not connected</span>
					{/if}
				</div>
			{/if}

			<!-- Folder and model info -->
			{#if sessionInfo.sessionFile}
				<div class="flex min-w-0 flex-1 items-center gap-3">
					<!-- Folder -->
					{#if sessionInfo.cwd}
						<div
							class="flex min-w-0 items-center gap-1.5 text-xs text-brand-text-muted"
						>
							<span class="flex-shrink-0">📁</span>
							<span class="truncate" title={sessionInfo.cwd}
								>{sessionInfo.cwd.split('/').pop() || sessionInfo.cwd}</span
							>
						</div>
					{/if}

					<!-- Model selector -->
					{#if sessionInfo.model}
						<div class="flex min-w-0 items-center gap-1.5 text-xs">
							<span
								class="relative flex flex-shrink-0 items-center justify-center text-sm"
							>
								<span>🤖</span>
								<span
									class="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-brand-surface {appState.isStreaming
										? 'animate-pulse bg-orange-500'
										: 'bg-emerald-500'}"
									title={appState.isStreaming ? 'Agent working...' : 'Ready'}
								></span>
							</span>
							{#if models.length > 0 && !readOnly}
								<select
									value={sessionInfo.model}
									oninput={(e) => changeModel(e.currentTarget.value)}
									class="max-w-48 truncate rounded border border-brand-border bg-brand-surface-2 px-1.5 py-0.5 text-brand-text focus:border-brand-blue focus:outline-none"
								>
									{#each models as model}
										<option value={`${model.provider}:${model.modelId}`}>
											{model.label}
										</option>
									{/each}
								</select>
							{:else}
								<span
									class="truncate text-brand-text-muted"
									title={sessionInfo.model}>{sessionInfo.model}</span
								>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if readOnly}
				<span
					class="flex-shrink-0 rounded bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400"
					>Read-only</span
				>
			{/if}
		</div>

		<!-- Interruption notification -->
		{#if interrupted}
			<div
				class="border border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-sm text-rose-400"
			>
				Your session was interrupted — another client took over.
			</div>
		{/if}

		<!-- Session error notification -->
		{#if sError}
			<div
				class="flex items-center justify-between border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-rose-400"
			>
				<span>{sError}</span>
				<button
					onclick={() => dismissSessionError()}
					class="ml-2 text-rose-300 hover:text-rose-200">X</button
				>
			</div>
		{/if}

		<!-- Read-only banner -->
		{#if readOnly && !interrupted}
			<div
				class="border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-center text-sm text-yellow-400"
			>
				Read-only: another session is active in this folder
			</div>
		{/if}

		<!-- Chat area -->
		<ChatMessageList bind:this={chatList} onMessageSent={() => {}} />

		<!-- Input: one composer, mode-switched. Search mode when connected, a
		     search folder is configured, and no session is active; chat mode
		     otherwise. Always mounted so it can be focused inside a tap gesture. -->
		<ChatInput
			bind:this={chatInput}
			searchMode={searchActive}
			searchConfigured={!!searchFolder}
			onSubmit={(q) => runSearch(q)}
			placeholder="Search the web..."
			submitLabel="Search"
			disabled={searchActive
				? !connected
				: !connected || readOnly || !sessionInfo.sessionFile}
			onSend={() => chatList?.forceScrollToBottom()}
		/>
	</div>

	<!-- Session Conflict Dialog -->
	<SessionConflictDialog />

	<!-- Overlay for mobile sidebar -->
	{#if sidebarOpen}
		<button
			type="button"
			class="fixed inset-0 z-10 bg-brand-dark/50 md:hidden"
			onclick={() => (sidebarOpen = false)}
			aria-label="Close sidebar"
		></button>
	{/if}
</div>

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
	} from '$lib/pi-remote';
	import {fetchSessions, availableModels} from '$lib/session-store';
	import {onMount} from 'svelte';

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
		return () => {
			window.removeEventListener('hashchange', handleHashChange);
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
</script>

<Head title="Pi Remote" description="Chat with your Pi coding agent remotely" />

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
						<img src="/logo.svg" alt="Pi Remote" class="h-6 w-6" />
						<span class="gradient-text text-lg font-bold">Pi Remote</span>
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

			<!-- Status indicator -->
			<div class="flex min-w-0 items-center gap-2">
				{#if appState.isStreaming}
					<span class="flex items-center gap-1.5 text-sm">
						<span
							class="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-cyan"
						></span>
						<span class="text-brand-text">Agent working...</span>
					</span>
				{:else if connected && sessionInfo.sessionFile}
					<span class="text-sm text-emerald-400">Ready</span>
				{:else if connected}
					<span class="text-sm text-brand-text-muted"
						>Select a session from sidebar</span
					>
				{:else}
					<span class="text-sm text-brand-text-muted">Not connected</span>
				{/if}
			</div>

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
							<span class="flex-shrink-0">🤖</span>
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

		<!-- Input -->
		<ChatInput
			disabled={!connected || readOnly || !sessionInfo.sessionFile}
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

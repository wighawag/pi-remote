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
</script>

<Head title="Pi Remote" description="Chat with your Pi coding agent remotely" />

<div class="flex h-dvh overflow-hidden bg-gray-900 text-white">
	<!-- Sidebar -->
	<div
		class="{sidebarOpen
			? 'translate-x-0'
			: '-translate-x-full'} bg-gray-850 fixed z-20 flex h-full w-72 flex-col border-r border-gray-700 transition-transform duration-200 md:relative md:translate-x-0"
	>
		<div class="border-b border-gray-700 p-4">
			<div class="flex items-center justify-between">
				<h1 class="text-lg font-bold">Pi Remote</h1>
				<button
					onclick={() => (sidebarOpen = false)}
					class="text-gray-400 hover:text-white md:hidden"
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
		<div class="border-b border-gray-700 p-4">
			<div class="flex items-center gap-2">
				<div
					class="h-2.5 w-2.5 rounded-full {connected
						? 'bg-green-500'
						: 'bg-red-500'}"
				></div>
				<span class="text-sm {connected ? 'text-green-400' : 'text-red-400'}">
					{connected ? 'Connected' : 'Disconnected'}
				</span>
			</div>
			{#if sessionInfo.sessionFile}
				<div class="mt-2 space-y-1">
					{#if sessionInfo.cwd}
						<div class="truncate text-xs text-gray-400" title={sessionInfo.cwd}>
							📁 {sessionInfo.cwd.split('/').pop() || sessionInfo.cwd}
						</div>
					{/if}
					{#if sessionInfo.model}
						<div
							class="truncate text-xs text-gray-400"
							title={sessionInfo.model}
						>
							🤖 {sessionInfo.model}
						</div>
					{/if}
				</div>
			{/if}
			{#if appState.error && !connected}
				<div class="mt-2 text-xs text-red-400">
					{appState.error}
				</div>
			{/if}
		</div>

		<!-- Session Browser -->
		<div class="flex-1 overflow-hidden">
			<SessionBrowser />
		</div>

		<!-- Quick actions -->
		<div class="space-y-2 border-t border-gray-700 p-4">
			<button
				onclick={handleRefresh}
				class="w-full rounded px-2 py-1.5 text-left text-sm text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
			>
				Refresh Sessions
			</button>
			<button
				onclick={handleReconnect}
				class="w-full rounded px-2 py-1.5 text-left text-sm text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
			>
				Reconnect
			</button>
			<button
				onclick={handleDisconnect}
				class="w-full rounded px-2 py-1.5 text-left text-sm text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
			>
				Disconnect
			</button>
		</div>
	</div>

	<!-- Main content -->
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Top bar -->
		<div
			class="bg-gray-850 flex items-center gap-3 border-b border-gray-700 p-3"
		>
			<button
				onclick={() => (sidebarOpen = !sidebarOpen)}
				class="p-1 text-gray-400 hover:text-white md:hidden"
			>
				=
			</button>

			<!-- Status indicator -->
			<div class="flex min-w-0 items-center gap-2">
				{#if appState.isStreaming}
					<span class="flex items-center gap-1.5 text-sm">
						<span
							class="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400"
						></span>
						<span class="text-gray-300">Agent working...</span>
					</span>
				{:else if connected && sessionInfo.sessionFile}
					<span class="text-sm text-green-400">Ready</span>
				{:else if connected}
					<span class="text-sm text-gray-400"
						>Select a session from sidebar</span
					>
				{:else}
					<span class="text-sm text-gray-400">Not connected</span>
				{/if}
			</div>

			<!-- Folder and model info -->
			{#if sessionInfo.sessionFile}
				<div class="flex min-w-0 flex-1 items-center gap-3">
					<!-- Folder -->
					{#if sessionInfo.cwd}
						<div
							class="flex min-w-0 items-center gap-1.5 text-xs text-gray-400"
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
									class="max-w-48 truncate rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-gray-300 focus:border-blue-500 focus:outline-none"
								>
									{#each models as model}
										<option value={`${model.provider}:${model.modelId}`}>
											{model.label}
										</option>
									{/each}
								</select>
							{:else}
								<span class="truncate text-gray-400" title={sessionInfo.model}
									>{sessionInfo.model}</span
								>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if readOnly}
				<span
					class="flex-shrink-0 rounded bg-yellow-600/30 px-2 py-1 text-xs text-yellow-400"
					>Read-only</span
				>
			{/if}
		</div>

		<!-- Interruption notification -->
		{#if interrupted}
			<div
				class="border border-red-500/50 bg-red-600/20 px-4 py-2 text-center text-sm text-red-400"
			>
				Your session was interrupted — another client took over.
			</div>
		{/if}

		<!-- Session error notification -->
		{#if sError}
			<div
				class="flex items-center justify-between border border-red-500/50 bg-red-600/20 px-4 py-2 text-sm text-red-400"
			>
				<span>{sError}</span>
				<button
					onclick={() => dismissSessionError()}
					class="ml-2 text-red-300 hover:text-red-200">X</button
				>
			</div>
		{/if}

		<!-- Read-only banner -->
		{#if readOnly && !interrupted}
			<div
				class="border border-yellow-500/50 bg-yellow-600/20 px-4 py-2 text-center text-sm text-yellow-400"
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
			class="fixed inset-0 z-10 bg-black/50 md:hidden"
			onclick={() => (sidebarOpen = false)}
			aria-label="Close sidebar"
		></button>
	{/if}
</div>

<style>
	.bg-gray-850 {
		background-color: rgb(30, 30, 35);
	}
</style>

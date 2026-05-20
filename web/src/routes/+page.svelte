<script lang="ts">
	import Head from '$lib/Head.svelte';
	import ConnectionSettings from '$lib/components/ConnectionSettings.svelte';
	import ChatMessageList from '$lib/components/ChatMessageList.svelte';
	import ChatInput from '$lib/components/ChatInput.svelte';
	import { piState, isConnected, connect, disconnect } from '$lib/pi-remote';
	import { onMount } from 'svelte';

	let sidebarOpen = $state(false);
	let autoConnect = $state(true);

	onMount(() => {
		if (autoConnect) {
			setTimeout(() => connect(), 200);
		}
	});

	function handleConnected() {
		connect();
	}

	let connected = $derived($isConnected);
	let appState = $derived($piState);
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
					✕
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
			{#if appState.session}
				<div class="text-xs text-gray-500 mt-2 truncate">
					Session: {appState.session}
				</div>
			{/if}
			{#if appState.error}
				<div class="text-xs text-red-400 mt-2">
					{appState.error}
				</div>
			{/if}
		</div>

		<!-- Quick actions -->
		<div class="p-4 space-y-2">
			<button
				onclick={() => { disconnect(); setTimeout(() => connect(), 100); }}
				class="w-full text-left text-sm text-gray-400 hover:text-white py-1.5 px-2 rounded hover:bg-gray-700 transition-colors"
			>
				⟳ Reconnect
			</button>
			<button
				onclick={() => { disconnect(); }}
				class="w-full text-left text-sm text-gray-400 hover:text-white py-1.5 px-2 rounded hover:bg-gray-700 transition-colors"
			>
				⏻ Disconnect
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
				☰
			</button>
			<div class="flex-1 flex items-center gap-2">
				<span class="text-sm text-gray-400">
					{#if appState.isStreaming}
						<span class="flex items-center gap-1.5">
							<span class="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
							Agent working...
						</span>
					{:else if connected}
						Ready
					{:else}
						Not connected
					{/if}
				</span>
			</div>
		</div>

		<!-- Chat area -->
		<ChatMessageList onMessageSent={() => {}} />

		<!-- Input -->
		<ChatInput disabled={!connected || appState.isStreaming} />
	</div>

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

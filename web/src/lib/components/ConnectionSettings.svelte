<script lang="ts">
	import { connect, disconnect, getConfig, setConfig, isConnected } from '$lib/pi-remote';
	import { onMount } from 'svelte';

	let { host, port, token, onConnected }: {
		host: string;
		port: number;
		token: string;
		onConnected: () => void;
	} = $props();

	let localHost = $state('');
	let localPort = $state(0);
	let localToken = $state('');
	let saving = $state(false);
	let connected = $derived($isConnected);

	onMount(() => {
		const config = getConfig();
		localHost = config.host;
		localPort = config.port;
		localToken = config.token || '';
	});

	function handleConnect() {
		setConfig({ host: localHost, port: localPort, token: localToken });
		disconnect();
		setTimeout(() => connect(), 100);
	}

	function handleDisconnect() {
		disconnect();
	}
</script>

<div class="p-4 border-b border-gray-700">
	<div class="space-y-3">
		<div>
			<label for="pi-host" class="block text-xs text-gray-400 mb-1">Host</label>
			<input
				id="pi-host"
				type="text"
				bind:value={localHost}
				placeholder="localhost"
				class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
			/>
		</div>

		<div>
			<label for="pi-port" class="block text-xs text-gray-400 mb-1">Port</label>
			<input
				id="pi-port"
				type="number"
				bind:value={localPort}
				class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
			/>
		</div>

		<div>
			<label for="pi-token" class="block text-xs text-gray-400 mb-1">Token (optional)</label>
			<input
				id="pi-token"
				type="password"
				bind:value={localToken}
				placeholder="Authentication token"
				class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
			/>
		</div>

		<div class="flex gap-2">
			{#if connected}
				<button
					onclick={handleDisconnect}
					class="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 px-4 rounded transition-colors"
				>
					Disconnect
				</button>
			{:else}
				<button
					onclick={handleConnect}
					disabled={saving}
					class="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm py-2 px-4 rounded transition-colors"
				>
					{saving ? 'Connecting...' : 'Connect'}
				</button>
			{/if}
		</div>
	</div>
</div>

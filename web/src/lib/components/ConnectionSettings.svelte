<script lang="ts">
	import {
		connect,
		disconnect,
		getConfig,
		setConfig,
		isConnected,
	} from '$lib/pi-remote';
	import {onMount} from 'svelte';

	let {
		host,
		port,
		token,
		onConnected,
	}: {
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
		setConfig({host: localHost, port: localPort, token: localToken});
		disconnect();
		setTimeout(() => connect(), 100);
	}

	function handleDisconnect() {
		disconnect();
	}
</script>

<div class="border-b border-gray-700 p-4">
	<div class="space-y-3">
		<div>
			<label for="pi-host" class="mb-1 block text-xs text-gray-400">Host</label>
			<input
				id="pi-host"
				type="text"
				bind:value={localHost}
				placeholder="localhost"
				class="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
			/>
		</div>

		<div>
			<label for="pi-port" class="mb-1 block text-xs text-gray-400">Port</label>
			<input
				id="pi-port"
				type="number"
				bind:value={localPort}
				class="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
			/>
		</div>

		<div>
			<label for="pi-token" class="mb-1 block text-xs text-gray-400"
				>Token (optional)</label
			>
			<input
				id="pi-token"
				type="password"
				bind:value={localToken}
				placeholder="Authentication token"
				class="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
			/>
		</div>

		<div class="flex gap-2">
			{#if connected}
				<button
					onclick={handleDisconnect}
					class="flex-1 rounded bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
				>
					Disconnect
				</button>
			{:else}
				<button
					onclick={handleConnect}
					disabled={saving}
					class="flex-1 rounded bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-800"
				>
					{saving ? 'Connecting...' : 'Connect'}
				</button>
			{/if}
		</div>
	</div>
</div>

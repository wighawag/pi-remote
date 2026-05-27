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
	let localHideThinking = $state(false);
	let localHideTools = $state(false);
	let saving = $state(false);
	let connected = $derived($isConnected);

	onMount(() => {
		const config = getConfig();
		localHost = config.host;
		localPort = config.port;
		localToken = config.token || '';
		localHideThinking = !!config.hideThinking;
		localHideTools = !!config.hideTools;
	});

	function handleConfigChange() {
		setConfig({
			host: localHost,
			port: localPort,
			token: localToken,
			hideThinking: localHideThinking,
			hideTools: localHideTools,
		});
	}

	function handleConnect() {
		setConfig({
			host: localHost,
			port: localPort,
			token: localToken,
			hideThinking: localHideThinking,
			hideTools: localHideTools,
		});
		disconnect();
		setTimeout(() => connect(), 100);
	}

	function handleDisconnect() {
		disconnect();
	}
</script>

<div class="border-b border-brand-border p-4">
	<div class="space-y-3">
		<div>
			<label for="pi-host" class="mb-1 block text-xs text-brand-text-muted"
				>Host</label
			>
			<input
				id="pi-host"
				type="text"
				bind:value={localHost}
				placeholder="localhost"
				class="w-full rounded border border-brand-border bg-brand-surface-2 px-3 py-2 text-sm text-brand-text placeholder-brand-text-muted focus:border-brand-blue focus:outline-none"
			/>
		</div>

		<div>
			<label for="pi-port" class="mb-1 block text-xs text-brand-text-muted"
				>Port</label
			>
			<input
				id="pi-port"
				type="number"
				bind:value={localPort}
				class="w-full rounded border border-brand-border bg-brand-surface-2 px-3 py-2 text-sm text-brand-text placeholder-brand-text-muted focus:border-brand-blue focus:outline-none"
			/>
		</div>

		<div>
			<label for="pi-token" class="mb-1 block text-xs text-brand-text-muted"
				>Token (optional)</label
			>
			<input
				id="pi-token"
				type="password"
				bind:value={localToken}
				placeholder="Authentication token"
				class="w-full rounded border border-brand-border bg-brand-surface-2 px-3 py-2 text-sm text-brand-text placeholder-brand-text-muted focus:border-brand-blue focus:outline-none"
			/>
		</div>

		<div class="flex items-center gap-2 py-1">
			<input
				id="pi-hide-thinking"
				type="checkbox"
				bind:checked={localHideThinking}
				onchange={handleConfigChange}
				class="h-4 w-4 rounded border-brand-border bg-brand-surface-2 text-brand-blue focus:ring-brand-blue focus:ring-offset-0"
			/>
			<label for="pi-hide-thinking" class="text-xs text-brand-text select-none cursor-pointer">
				Hide thinking steps
			</label>
		</div>

		<div class="flex items-center gap-2 py-1">
			<input
				id="pi-hide-tools"
				type="checkbox"
				bind:checked={localHideTools}
				onchange={handleConfigChange}
				class="h-4 w-4 rounded border-brand-border bg-brand-surface-2 text-brand-blue focus:ring-brand-blue focus:ring-offset-0"
			/>
			<label for="pi-hide-tools" class="text-xs text-brand-text select-none cursor-pointer">
				Hide tool calls
			</label>
		</div>

		<div class="flex gap-2">
			{#if connected}
				<button
					onclick={handleDisconnect}
					class="flex-1 rounded bg-rose-500 px-4 py-2 text-sm text-white transition-colors hover:bg-rose-600"
				>
					Disconnect
				</button>
			{:else}
				<button
					onclick={handleConnect}
					disabled={saving}
					class="flex-1 rounded bg-gradient-to-r from-brand-cyan to-brand-blue px-4 py-2 text-sm text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:from-brand-surface-3 disabled:to-brand-surface-3"
				>
					{saving ? 'Connecting...' : 'Connect'}
				</button>
			{/if}
		</div>
	</div>
</div>

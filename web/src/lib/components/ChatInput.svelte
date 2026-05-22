<script lang="ts">
	import { sendMessage } from '$lib/pi-remote';
	import { isStreaming, isReadOnly, activeSessionInfo } from '$lib/pi-remote';

	let { disabled, onSend }: { disabled: boolean; onSend?: () => void } = $props();

	let text = $state('');

	let streaming = $derived($isStreaming);
	let readOnly = $derived($isReadOnly);
	let sessionInfo = $derived($activeSessionInfo);

	let effectivelyDisabled = $derived(disabled || streaming || readOnly || !sessionInfo.sessionId);

	function handleSend() {
		const trimmed = text.trim();
		if (!trimmed || effectivelyDisabled) return;
		sendMessage(trimmed);
		text = '';
		onSend?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}
</script>

<div class="p-4 border-t border-gray-700">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleSend();
		}}
		class="flex gap-2"
	>
		<input
			type="text"
			bind:value={text}
			onkeydown={handleKeydown}
			disabled={effectivelyDisabled}
			placeholder={streaming ? 'Agent is working...' : readOnly ? 'Read-only mode' : !sessionInfo.sessionId ? 'Select a session first...' : 'Type a message...'}
			class="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
		/>
		<button
			type="submit"
			disabled={effectivelyDisabled || !text.trim()}
			class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors"
		>
			Send
		</button>
	</form>
</div>

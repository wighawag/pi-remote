<script lang="ts">
	import { onMount } from 'svelte';
	import { sendMessage, piState, isConnected, createSession, clearMessages, leaveSession } from '$lib/pi-remote';
	import { isStreaming, isReadOnly, activeSessionInfo } from '$lib/pi-remote';

	let { disabled, onSend }: { disabled: boolean; onSend?: () => void } = $props();

	let text = $state('');
	let enterToSend = $state(true);
	let queuedText = $state<string | null>(null);

	let streaming = $derived($isStreaming);
	let readOnly = $derived($isReadOnly);
	let sessionInfo = $derived($activeSessionInfo);
	let connected = $derived($isConnected);
	let appState = $derived($piState);

	let effectivelyDisabled = $derived(disabled || readOnly || !sessionInfo.sessionId || !!queuedText);

	let textarea = $state<HTMLTextAreaElement>();

	onMount(() => {
		const stored = localStorage.getItem('pi-remote-enter-to-send');
		if (stored !== null) {
			enterToSend = stored === 'true';
		}
	});

	function toggleEnterToSend() {
		enterToSend = !enterToSend;
		localStorage.setItem('pi-remote-enter-to-send', String(enterToSend));
	}

	$effect(() => {
		if (textarea) {
			// Trigger reactive updates when text changes
			text;
			textarea.style.height = 'auto';
			textarea.style.height = `${textarea.scrollHeight}px`;
		}
	});

	// Automatically focus/refocus the textarea whenever it becomes active/enabled
	$effect(() => {
		if (!effectivelyDisabled && textarea) {
			textarea.focus();
		}
	});

	// Auto-send queued message when agent stops streaming
	$effect(() => {
		if (!streaming && queuedText) {
			sendMessage(queuedText);
			text = '';
			queuedText = null;
			onSend?.();
		}
	});

	function handleUnqueue() {
		queuedText = null;
		setTimeout(() => textarea?.focus(), 0);
	}

	function handleSend() {
		const trimmed = text.trim();
		if (!trimmed) return;

		// Handle local slash commands to match terminal behavior
		if (trimmed.startsWith('/')) {
			const lower = trimmed.toLowerCase();
			if (lower === '/new' || lower === '/reset') {
				if (sessionInfo.cwd) {
					createSession(sessionInfo.cwd, sessionInfo.model || undefined);
					text = '';
					queuedText = null;
					return;
				}
			} else if (lower === '/clear') {
				clearMessages();
				text = '';
				queuedText = null;
				return;
			} else if (lower === '/leave' || lower === '/exit') {
				leaveSession();
				text = '';
				queuedText = null;
				return;
			}
		}

		if (streaming) {
			queuedText = trimmed;
		} else {
			sendMessage(trimmed);
			text = '';
			onSend?.();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			if (enterToSend) {
				// Default mode: Enter to send, Shift+Enter for newline
				if (!e.shiftKey) {
					e.preventDefault();
					handleSend();
				}
			} else {
				// Dev mode: Enter for newline, Shift+Enter / Ctrl+Enter to send
				if (e.shiftKey || e.ctrlKey || e.metaKey) {
					e.preventDefault();
					handleSend();
				}
			}
		}
	}
</script>

<div class="p-4 border-t border-gray-700">
	{#if !connected || appState.connecting || appState.error}
		<div class="text-xs text-gray-500 mb-2.5 flex items-center gap-1.5 font-medium select-none">
			{#if appState.connecting}
				<span class="inline-block w-1.5 h-1.5 bg-yellow-500 rounded-full animate-ping"></span>
				<span>Connecting to remote server...</span>
			{:else if appState.error}
				<span class="text-red-500">⚠️</span>
				<span class="text-red-400/80">{appState.error}</span>
			{:else if !connected}
				<span class="inline-block w-1.5 h-1.5 bg-gray-600 rounded-full"></span>
				<span>Disconnected from remote server</span>
			{/if}
		</div>
	{/if}
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleSend();
		}}
		class="flex gap-2 items-end"
	>
		<textarea
			bind:this={textarea}
			bind:value={text}
			onkeydown={handleKeydown}
			disabled={effectivelyDisabled}
			rows={1}
			placeholder={queuedText ? 'Message is queued...' : streaming ? 'Agent is working (type next message...)' : readOnly ? 'Read-only mode' : !sessionInfo.sessionId ? 'Select a session first...' : 'Type a message...'}
			class="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 resize-none overflow-y-auto max-h-48 min-h-[48px] h-auto leading-relaxed"
		></textarea>
		{#if queuedText}
			<button
				type="button"
				onclick={handleUnqueue}
				class="bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-lg font-medium transition-colors h-[48px] flex items-center justify-center shrink-0"
			>
				Unqueue
			</button>
		{:else}
			<button
				type="submit"
				disabled={effectivelyDisabled || !text.trim()}
				class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors h-[48px] flex items-center justify-center shrink-0"
			>
				{#if streaming}
					Queue
				{:else}
					Send
				{/if}
			</button>
		{/if}
	</form>

	<div class="mt-2 flex items-center justify-between text-[11px] text-gray-400 select-none px-1">
		<label class="flex items-center gap-1.5 cursor-pointer hover:text-gray-300">
			<input
				type="checkbox"
				checked={enterToSend}
				onchange={toggleEnterToSend}
				class="rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-0 focus:ring-offset-0"
			/>
			<span>Press Enter to send (Shift+Enter for newline)</span>
		</label>
		<span class="opacity-60 font-mono">
			{#if enterToSend}
				Ctrl+Enter/Cmd+Enter also sends
			{:else}
				Shift+Enter or Ctrl+Enter to send
			{/if}
		</span>
	</div>
</div>

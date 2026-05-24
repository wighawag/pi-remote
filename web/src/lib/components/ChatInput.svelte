<script lang="ts">
	import {onMount} from 'svelte';
	import {
		sendMessage,
		piState,
		isConnected,
		createSession,
		clearMessages,
		leaveSession,
	} from '$lib/pi-remote';
	import {isStreaming, isReadOnly, activeSessionInfo} from '$lib/pi-remote';
	import SpeechButton from './speech/SpeechButton.svelte';

	let {disabled, onSend}: {disabled: boolean; onSend?: () => void} = $props();

	let text = $state('');
	let enterToSend = $state(true);
	let queuedText = $state<string | null>(null);

	let streaming = $derived($isStreaming);
	let readOnly = $derived($isReadOnly);
	let sessionInfo = $derived($activeSessionInfo);
	let connected = $derived($isConnected);
	let appState = $derived($piState);

	let effectivelyDisabled = $derived(
		disabled || readOnly || !sessionInfo.sessionId || !!queuedText,
	);

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
				// Enter for newline, Shift+Enter to send
				if (e.shiftKey) {
					e.preventDefault();
					handleSend();
				}
			}
		}
	}
</script>

<div class="border-t border-gray-700 p-4">
	{#if !connected || appState.connecting || appState.error}
		<div
			class="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-gray-500 select-none"
		>
			{#if appState.connecting}
				<span
					class="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-yellow-500"
				></span>
				<span>Connecting to remote server...</span>
			{:else if appState.error}
				<span class="text-red-500">⚠️</span>
				<span class="text-red-400/80">{appState.error}</span>
			{:else if !connected}
				<span class="inline-block h-1.5 w-1.5 rounded-full bg-gray-600"></span>
				<span>Disconnected from remote server</span>
			{/if}
		</div>
	{/if}
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleSend();
		}}
		class="flex items-end gap-2"
	>
		<textarea
			bind:this={textarea}
			bind:value={text}
			onkeydown={handleKeydown}
			disabled={effectivelyDisabled}
			rows={1}
			placeholder={queuedText
				? 'Message is queued...'
				: streaming
					? 'Agent is working (type next message...)'
					: readOnly
						? 'Read-only mode'
						: !sessionInfo.sessionId
							? 'Select a session first...'
							: 'Type a message...'}
			class="h-auto max-h-48 min-h-[48px] flex-1 resize-none overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 leading-relaxed text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
		></textarea>
		<SpeechButton bind:text={text} disabled={effectivelyDisabled} onSend={handleSend} />
		{#if queuedText}
			<button
				type="button"
				onclick={handleUnqueue}
				class="flex h-[48px] shrink-0 items-center justify-center rounded-lg bg-amber-600 px-6 py-3 font-medium text-white transition-colors hover:bg-amber-700"
			>
				Unqueue
			</button>
		{:else}
			<button
				type="submit"
				disabled={effectivelyDisabled || !text.trim()}
				class="flex h-[48px] shrink-0 items-center justify-center rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-600"
			>
				{#if streaming}
					Queue
				{:else}
					Send
				{/if}
			</button>
		{/if}
	</form>

	<div
		class="mt-2 flex items-center justify-between px-1 text-[11px] text-gray-400 select-none"
	>
		<label class="flex cursor-pointer items-center gap-1.5 hover:text-gray-300">
			<input
				type="checkbox"
				checked={enterToSend}
				onchange={toggleEnterToSend}
				class="rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-0 focus:ring-offset-0"
			/>
			<span>Press Enter to send (Shift+Enter for newline)</span>
		</label>
		<span class="font-mono opacity-60">
			{#if !enterToSend}
				Shift+Enter to send (Enter for newline)
			{/if}
		</span>
	</div>
</div>

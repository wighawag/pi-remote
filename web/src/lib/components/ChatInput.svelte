<script lang="ts">
	import {onMount} from 'svelte';
	import {
		sendMessage,
		piState,
		isConnected,
		createSession,
		clearMessages,
		leaveSession,
		uploadFile,
	} from '$lib/pi-remote';
	import {isStreaming, isReadOnly, activeSessionInfo} from '$lib/pi-remote';
	import {getBaseUrl, getToken} from '$lib/session-store';
	import SpeechButton from './speech/SpeechButton.svelte';

	let {disabled, onSend}: {disabled: boolean; onSend?: () => void} = $props();

	let text = $state('');
	let enterToSend = $state(true);
	let queuedText = $state<string | null>(null);

	let fileInput = $state<HTMLInputElement>();
	let attachments = $state<{ name: string; path?: string; error?: string; uploading: boolean }[]>([]);

	let streaming = $derived($isStreaming);
	let readOnly = $derived($isReadOnly);
	let sessionInfo = $derived($activeSessionInfo);
	let connected = $derived($isConnected);
	let appState = $derived($piState);

	let effectivelyDisabled = $derived(
		disabled || readOnly || !sessionInfo.sessionId || !!queuedText,
	);

	let isAnyUploading = $derived(attachments.some(a => a.uploading));
	let canSend = $derived(
		!effectivelyDisabled &&
		!isAnyUploading &&
		(text.trim().length > 0 || attachments.length > 0)
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

	async function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (!target.files) return;
		const files = Array.from(target.files);
		target.value = '';

		const startIdx = attachments.length;
		attachments = [
			...attachments,
			...files.map((f) => ({ name: f.name, uploading: true })),
		];

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const idx = startIdx + i;
			try {
				if (!sessionInfo.sessionId) {
					throw new Error('No active session');
				}
				const res = await uploadFile(sessionInfo.sessionId, file);
				attachments = attachments.map((a, currentIdx) =>
					currentIdx === idx
						? { name: file.name, path: res.savedPath, uploading: false }
						: a,
				);
			} catch (err) {
				const errMsg = (err as Error).message || 'Failed to upload';
				console.error('File upload error details:', err);

				// Build a diagnostics target URL (/health)
				let targetUrl = '';
				try {
					const baseUrl = getBaseUrl();
					const token = getToken();
					targetUrl = `${baseUrl}/health${token ? `?token=${encodeURIComponent(token)}` : ''}`;
				} catch (e) {}

				attachments = attachments.map((a, currentIdx) =>
					currentIdx === idx
						? { name: file.name, error: errMsg, url: targetUrl, uploading: false } as any
						: a,
				);
			}
		}
	}

	function removeAttachment(index: number) {
		attachments = attachments.filter((_, idx) => idx !== index);
	}

	function handleSend() {
		const trimmed = text.trim();
		if (!trimmed && attachments.length === 0) return;

		let messageToSend = trimmed;
		if (attachments.length > 0) {
			const validAttachments = attachments.filter((a) => a.path);
			if (validAttachments.length > 0) {
				const fileLines = validAttachments
					.map((a) => `[Uploaded file: ${a.path}]`)
					.join('\n');

				if (messageToSend) {
					messageToSend += '\n\n' + fileLines;
				} else {
					messageToSend = `I have uploaded the following file(s) for you:\n${fileLines}`;
				}
			}
		}

		// Handle local slash commands to match terminal behavior
		if (trimmed.startsWith('/') && attachments.length === 0) {
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
			queuedText = messageToSend;
			text = '';
			attachments = [];
		} else {
			sendMessage(messageToSend);
			text = '';
			attachments = [];
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
	{#if attachments.length > 0}
		<div class="mb-3 flex flex-wrap gap-2">
			{#each attachments as attachment, index}
				<div class="flex items-center gap-2 rounded bg-gray-800 px-2.5 py-1.5 text-xs border border-gray-700">
					<span class="max-w-[150px] truncate font-medium text-gray-200" title={attachment.name}>
						{attachment.name}
					</span>
					{#if attachment.uploading}
						<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></span>
					{:else if attachment.error}
						<span class="text-red-400 font-medium text-[10px] flex items-center gap-1" title={attachment.error}>
							<span class="truncate max-w-[120px]">⚠️ {attachment.error}</span>
							{#if (attachment as any).url}
								<a href={(attachment as any).url} target="_blank" class="underline text-blue-400 hover:text-blue-300 font-semibold shrink-0 ml-1">
									[Test Link]
								</a>
							{/if}
						</span>
					{:else}
						<span class="text-emerald-500">✓</span>
					{/if}
					<button
						type="button"
						onclick={() => removeAttachment(index)}
						class="ml-1 text-gray-400 hover:text-white font-bold"
					>
						×
					</button>
				</div>
			{/each}
		</div>
	{/if}
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleSend();
		}}
		class="flex items-stretch gap-3"
	>
		<div class="flex-1 min-w-0">
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
				class="h-full min-h-[120px] max-h-48 w-full resize-none overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 leading-relaxed text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
			></textarea>
		</div>

		<div class="flex flex-col gap-2 justify-end shrink-0 w-[80px]">
			<button
				type="button"
				onclick={() => fileInput?.click()}
				disabled={effectivelyDisabled}
				class="flex h-[40px] w-full items-center justify-center rounded-lg border border-gray-600 bg-gray-800 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
				title="Attach file (image or document)"
			>
				📎
			</button>
			<input
				bind:this={fileInput}
				type="file"
				multiple
				onchange={handleFileChange}
				class="hidden"
			/>
			<div class="w-full flex justify-center">
				<SpeechButton
					bind:text
					disabled={effectivelyDisabled}
					onSend={handleSend}
				/>
			</div>
			{#if queuedText}
				<button
					type="button"
					onclick={handleUnqueue}
					class="flex h-[40px] w-full items-center justify-center rounded-lg bg-amber-600 text-xs font-medium text-white transition-colors hover:bg-amber-700"
				>
					Unqueue
				</button>
			{:else}
				<button
					type="submit"
					disabled={!canSend}
					class="flex h-[40px] w-full items-center justify-center rounded-lg bg-blue-600 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-600"
				>
					{#if streaming}
						Queue
					{:else}
						Send
					{/if}
				</button>
			{/if}
		</div>
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

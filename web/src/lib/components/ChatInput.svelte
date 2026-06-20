<script lang="ts">
	import {onMount, untrack} from 'svelte';
	import {
		sendMessage,
		piState,
		isConnected,
		createSession,
		clearMessages,
		leaveSession,
		uploadFile,
		beginFilePicker,
		endFilePicker,
	} from '$lib/wherever';
	import {isStreaming, isReadOnly, activeSessionInfo} from '$lib/wherever';
	import {getBaseUrl, getToken} from '$lib/session-store';
	import SpeechButton from './speech/SpeechButton.svelte';

	let {
		disabled,
		onSend,
		onSubmit,
		placeholder,
		submitLabel,
		showAttach = true,
		searchMode = false,
		searchConfigured = false,
	}: {
		disabled: boolean;
		onSend?: () => void;
		// When provided (search mode), submit routes here instead of sendMessage.
		onSubmit?: (text: string) => void;
		placeholder?: string;
		submitLabel?: string;
		showAttach?: boolean;
		searchMode?: boolean;
		// Whether a search folder is configured (gates enablement in search mode).
		searchConfigured?: boolean;
	} = $props();

	let text = $state('');
	let enterToSend = $state(true);
	let queuedText = $state<string | null>(null);
	let queuedTextBackup = $state<string | null>(null);
	let isCollapsed = $state(false);

	let fileInput = $state<HTMLInputElement>();
	let attachments = $state<
		{name: string; path?: string; error?: string; uploading: boolean}[]
	>([]);

	let streaming = $derived($isStreaming);
	let readOnly = $derived($isReadOnly);
	let sessionInfo = $derived($activeSessionInfo);
	let connected = $derived($isConnected);
	let appState = $derived($piState);

	// In search mode the composer must work with no active session: it requires
	// only a live connection and a configured search folder. In chat mode it
	// stays gated on an active session as before.
	let effectivelyDisabled = $derived(
		searchMode
			? disabled || !connected || !searchConfigured
			: disabled || readOnly || !sessionInfo.sessionId || !!queuedText,
	);

	let isAnyUploading = $derived(attachments.some((a) => a.uploading));
	let canSend = $derived(
		!effectivelyDisabled &&
			!isAnyUploading &&
			(text.trim().length > 0 || attachments.length > 0),
	);

	let textarea = $state<HTMLTextAreaElement>();

	// Persist the in-progress draft so it is never lost when this composer is
	// unmounted out from under the user (e.g. the parent swaps it for the
	// "Reconnecting and syncing session..." status line during a resync, or on a
	// transient disconnect). The draft is keyed per session so switching sessions
	// does not bleed text between them; search mode (no session) uses a shared
	// 'search' key. Cleared on a successful send.
	// A draft belongs to the active session when one is open, otherwise to the
	// (no-session) search composer. Keying on sessionId-or-search this way means:
	// a session keeps its own draft, and the search query is preserved under one
	// shared key so switching into a session and back to search (by closing the
	// session or hitting the search button) restores what was typed. This holds
	// whether or not a search folder is configured (no session == search mode).
	const DRAFT_PREFIX = 'wherever-draft:';
	let draftKey = $derived(
		DRAFT_PREFIX + (sessionInfo.sessionId ?? 'search'),
	);
	// Tracks which key we have already hydrated so the restore effect fires only
	// when the key actually changes (mount, session switch, search<->chat), not on
	// every keystroke. The persist effect below removes the key whenever the
	// textarea goes empty, so a successful send (which clears `text`) also clears
	// the saved draft.
	let hydratedKey = $state<string | null>(null);

	onMount(() => {
		const stored = localStorage.getItem('wherever-enter-to-send');
		if (stored !== null) {
			enterToSend = stored === 'true';
		}
	});

	// Swap the textarea to the active draft key's saved draft whenever the key
	// changes (initial mount, session switch, search<->chat). This is an
	// unconditional swap: the previous session's draft must NOT linger in the box
	// after switching, but going back to a session restores its own saved draft.
	// The hydratedKey guard makes this fire ONLY on a real key change (not on
	// every keystroke), so it never clobbers text the user is actively typing
	// within the current session. text/queuedText reads are untracked accordingly.
	$effect(() => {
		const key = draftKey;
		if (key === hydratedKey) return;
		untrack(() => {
			let saved: string | null = null;
			if (typeof localStorage !== 'undefined') {
				try {
					saved = localStorage.getItem(key);
				} catch {}
			}
			// A queued (in-flight) message takes precedence over a restored draft.
			if (!queuedText) {
				text = saved ?? '';
			}
			hydratedKey = key;
		});
	});

	// Persist the draft on every text change. Removing the key when empty keeps
	// storage clean (and means a successful send, which clears text, clears it).
	// Only persists once the current key has been hydrated, so the restore above
	// is never overwritten by a stale empty value mid-switch.
	$effect(() => {
		const value = text;
		const key = draftKey;
		if (key !== hydratedKey || typeof localStorage === 'undefined') return;
		try {
			if (value.trim().length > 0) {
				localStorage.setItem(key, value);
			} else {
				localStorage.removeItem(key);
			}
		} catch {}
	});

	// Exposed so a parent can focus the textarea SYNCHRONOUSLY inside a user
	// gesture (required to raise the mobile virtual keyboard, esp. iOS Safari).
	export function focusInput() {
		if (isCollapsed) isCollapsed = false;
		textarea?.focus();
	}

	function toggleEnterToSend() {
		enterToSend = !enterToSend;
		localStorage.setItem('wherever-enter-to-send', String(enterToSend));
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

	// Show queued text in the textarea so user can see it
	$effect(() => {
		if (queuedText) {
			text = queuedText;
		}
	});

	// Auto-send queued message when agent stops streaming
	$effect(() => {
		if (!streaming && queuedText) {
			sendMessage(queuedText);
			text = '';
			queuedText = null;
			queuedTextBackup = null;
			onSend?.();
		}
	});

	function handleUnqueue() {
		// Restore the queued message into the editable input so the user can
		// edit or resend it, instead of discarding it.
		const restore = queuedTextBackup ?? queuedText ?? '';
		queuedText = null;
		queuedTextBackup = null;
		text = restore;
		setTimeout(() => {
			textarea?.focus();
			if (textarea) {
				textarea.selectionStart = textarea.selectionEnd = text.length;
			}
		}, 0);
	}

	async function handleFileChange(e: Event) {
		// The native picker is closed now that we have a change event; allow the
		// background suspend timer to resume its normal behaviour.
		endFilePicker();
		const target = e.target as HTMLInputElement;
		if (!target.files) return;
		const files = Array.from(target.files);
		target.value = '';

		const startIdx = attachments.length;
		attachments = [
			...attachments,
			...files.map((f) => ({name: f.name, uploading: true})),
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
						? {name: file.name, path: res.savedPath, uploading: false}
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
						? ({
								name: file.name,
								error: errMsg,
								url: targetUrl,
								uploading: false,
							} as any)
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

		// Search mode: route to the injected handler, skip slash commands,
		// attachments and the streaming/queue machinery entirely.
		if (searchMode) {
			if (!trimmed || effectivelyDisabled) return;
			onSubmit?.(trimmed);
			text = '';
			onSend?.();
			return;
		}

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
			queuedTextBackup = messageToSend;
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

<div class="border-t border-brand-border p-4">
	{#if !connected || appState.connecting || appState.error}
		<div
			class="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-brand-text-muted select-none"
		>
			{#if appState.connecting}
				<span
					class="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-amber-400"
				></span>
				<span>Connecting to remote server...</span>
			{:else if appState.error}
				<span class="text-rose-400">⚠️</span>
				<span class="text-rose-400/80">{appState.error}</span>
			{:else if !connected}
				<span class="inline-block h-1.5 w-1.5 rounded-full bg-brand-surface-3"
				></span>
				<span>Disconnected from remote server</span>
			{/if}
		</div>
	{/if}
	{#if isCollapsed}
		<div class="flex items-center">
			<button
				type="button"
				onclick={() => {
					isCollapsed = false;
					setTimeout(() => textarea?.focus(), 50);
				}}
				class="flex w-full items-center justify-between rounded-lg border border-brand-border bg-brand-surface-2 px-4 py-2.5 text-sm text-brand-text-muted transition-all hover:bg-brand-surface-3 hover:text-brand-text"
			>
				<span class="flex items-center gap-2">
					<span>{searchMode ? '🔍' : '💬'}</span>
					<span>
						{#if searchMode}
							{placeholder ?? 'Search the web...'}
						{:else if queuedText}
							Message is queued...
						{:else if streaming}
							Agent is working (click to type next)...
						{:else if readOnly}
							Read-only mode
						{:else if !sessionInfo.sessionId}
							Select a session first...
						{:else}
							Tap to type a message...
						{/if}
					</span>
				</span>
				<span
					class="rounded bg-brand-surface-3 px-2 py-1 text-xs font-medium text-brand-text transition-colors hover:bg-brand-surface-2"
					>Expand ▲</span
				>
			</button>
		</div>
	{:else}
		{#if attachments.length > 0}
			<div class="mb-3 flex flex-wrap gap-2">
				{#each attachments as attachment, index}
					<div
						class="flex items-center gap-2 rounded border border-brand-border bg-brand-surface-2 px-2.5 py-1.5 text-xs"
					>
						<span
							class="max-w-[150px] truncate font-medium text-brand-text"
							title={attachment.name}
						>
							{attachment.name}
						</span>
						{#if attachment.uploading}
							<span
								class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-blue border-t-transparent"
							></span>
						{:else if attachment.error}
							<span
								class="flex items-center gap-1 text-[10px] font-medium text-rose-400"
								title={attachment.error}
							>
								<span class="max-w-[120px] truncate">⚠️ {attachment.error}</span
								>
								{#if (attachment as any).url}
									<a
										href={(attachment as any).url}
										target="_blank"
										class="ml-1 shrink-0 font-semibold text-brand-blue underline hover:opacity-80"
									>
										[Test Link]
									</a>
								{/if}
							</span>
						{:else}
							<span class="text-emerald-400">✓</span>
						{/if}
						<button
							type="button"
							onclick={() => removeAttachment(index)}
							class="ml-1 font-bold text-brand-text-muted hover:text-brand-text"
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
			<div class="min-w-0 flex-1">
				<textarea
					bind:this={textarea}
					bind:value={text}
					onkeydown={handleKeydown}
					disabled={effectivelyDisabled}
					rows={1}
					placeholder={searchMode
						? (placeholder ?? 'Search the web...')
						: streaming
							? 'Agent is working (type next message...)'
							: readOnly
								? 'Read-only mode'
								: !sessionInfo.sessionId
									? 'Select a session first...'
									: 'Type a message...'}
					class="h-full max-h-48 min-h-[120px] w-full resize-none overflow-y-auto rounded-lg border border-brand-border bg-brand-surface-2 px-4 py-3 leading-relaxed placeholder-brand-text-muted focus:border-brand-blue focus:outline-none disabled:opacity-50 {queuedText
						? 'text-brand-text-muted italic'
						: 'text-brand-text'}"
				></textarea>
			</div>

			<div class="flex w-[80px] shrink-0 flex-col justify-end gap-2">
				{#if showAttach && !searchMode}
					<button
						type="button"
						onclick={() => {
							// Mark the picker active before it opens so the page-hidden
							// suspend timer doesn't tear down the session while the user
							// takes a photo / browses files.
							beginFilePicker();
							fileInput?.click();
						}}
						disabled={effectivelyDisabled}
						class="flex h-[40px] w-full items-center justify-center rounded-lg border border-brand-border bg-brand-surface-2 text-brand-text-muted transition-colors hover:bg-brand-surface-3 hover:text-brand-text disabled:cursor-not-allowed disabled:opacity-50"
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
				{/if}
				<div class="flex w-full justify-center">
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
						class="flex h-[40px] w-full items-center justify-center rounded-lg bg-amber-500 text-xs font-medium text-brand-text transition-colors hover:bg-amber-600"
					>
						Unqueue
					</button>
				{:else}
					<button
						type="submit"
						disabled={!canSend}
						class="flex h-[40px] w-full items-center justify-center rounded-lg bg-gradient-to-r from-brand-cyan to-brand-blue text-xs font-medium text-brand-text transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:bg-brand-surface-3 disabled:from-brand-surface-3 disabled:to-brand-surface-3 disabled:opacity-50"
					>
						{#if searchMode}
							{submitLabel ?? 'Search'}
						{:else if streaming}
							Queue
						{:else}
							Send
						{/if}
					</button>
				{/if}
			</div>
		</form>

		<div
			class="mt-2 flex items-center justify-between px-1 text-[11px] text-brand-text-muted select-none"
		>
			<label
				class="flex cursor-pointer items-center gap-1.5 hover:text-brand-text"
			>
				<input
					type="checkbox"
					checked={enterToSend}
					onchange={toggleEnterToSend}
					class="rounded border-brand-border bg-brand-surface-2 text-brand-blue focus:ring-0 focus:ring-offset-0"
				/>
				<span>Press Enter to send</span>
			</label>
			<div class="flex items-center gap-3">
				<button
					type="button"
					onclick={() => (isCollapsed = true)}
					class="rounded bg-brand-surface-3/50 px-2 py-0.5 text-xs text-brand-text-muted transition-colors hover:bg-brand-surface-3 hover:text-brand-text"
				>
					Collapse ▽
				</button>
				{#if !enterToSend}
					<span class="hidden font-mono opacity-60 sm:inline">
						Shift+Enter to send
					</span>
				{/if}
			</div>
		</div>
	{/if}
</div>

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
		composerPrefill,
	} from '$lib/wherever';
	import {isStreaming, isReadOnly, activeSessionInfo} from '$lib/wherever';
	import {getBaseUrl, getToken} from '$lib/session-store';
	import {decideComposeSend} from '$lib/core/compose-send';
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
		searchModels = [],
		searchModel = $bindable(''),
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
		// Model list + bound selection for the search-mode model picker. Values are
		// "provider:modelId"; empty label list hides the picker.
		searchModels?: {value: string; label: string}[];
		searchModel?: string;
	} = $props();

	let text = $state('');
	let enterToSend = $state(true);
	let isCollapsed = $state(false);

	// --- Slash-command (skill) autocomplete ---------------------------------
	// Mirrors the pi CLI: when the message STARTS with a `/` token (no space yet),
	// offer the session's `/skill:<name>` commands. Selecting one only INSERTS
	// `/skill:<name> ` (trailing space) so the user can keep typing an argument;
	// it never submits. Expansion happens server-side at send time. `/skill:` is
	// start-anchored, so a `/` mid-message is ignored, exactly like the CLI.
	let skillMenuOpen = $state(false);
	let skillMenuIndex = $state(0);

	let fileInput = $state<HTMLInputElement>();
	let attachments = $state<
		{name: string; path?: string; error?: string; uploading: boolean}[]
	>([]);

	let streaming = $derived($isStreaming);
	let readOnly = $derived($isReadOnly);
	let sessionInfo = $derived($activeSessionInfo);
	let connected = $derived($isConnected);
	let appState = $derived($piState);

	// The `/` token currently being typed at the START of the message, or null
	// when the message doesn't begin a slash command (no leading `/`, or a space
	// has already been typed so the command name is committed). Only the leading
	// token triggers the menu, matching the CLI's start-of-line anchoring.
	let slashPrefix = $derived.by(() => {
		if (searchMode) return null;
		const m = text.match(/^\/([^\s]*)$/);
		return m ? m[1] : null;
	});

	// Skill commands the composer can offer, fuzzily filtered by the typed token.
	// `s.name` is the full invocation without the slash (e.g. "skill:setup"), so
	// typing "/setu" surfaces "skill:setup" via substring match on the name.
	let skillMatches = $derived.by(() => {
		if (slashPrefix === null) return [];
		const all = appState.skills ?? [];
		if (all.length === 0) return [];
		const q = slashPrefix.toLowerCase();
		const matches = q
			? all.filter((s) => s.name.toLowerCase().includes(q))
			: all.slice();
		// Rank exact-prefix hits ("skill:setup" for "skill:set") above loose
		// substring hits so the most likely completion is highlighted first.
		return matches.sort((a, b) => {
			const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
			const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
			return ap - bp || a.name.localeCompare(b.name);
		});
	});

	// Open the menu whenever there are matches for the current slash token, and
	// keep the highlighted index in range as the list shrinks/grows. Closes when
	// the token is committed (space typed) or there are no matches.
	$effect(() => {
		const count = skillMatches.length;
		if (count === 0) {
			if (untrack(() => skillMenuOpen)) skillMenuOpen = false;
			return;
		}
		if (!untrack(() => skillMenuOpen)) skillMenuOpen = true;
		if (untrack(() => skillMenuIndex) >= count) skillMenuIndex = 0;
	});

	// Insert `/skill:<name> ` (trailing space), keeping focus and placing the
	// cursor after the space so the user can immediately type an argument. Never
	// submits: this only rewrites the composer, exactly like the pi CLI.
	function applySkill(name: string) {
		text = `/${name} `;
		skillMenuOpen = false;
		skillMenuIndex = 0;
		queueMicrotask(() => {
			if (!textarea) return;
			textarea.focus();
			const end = text.length;
			textarea.setSelectionRange(end, end);
		});
	}

	// In search mode the composer must work with no active session: it requires
	// only a live connection and a configured search folder. In chat mode it
	// stays gated on an active session as before.
	// Note: streaming does NOT disable the composer. A mid-stream submit steers
	// the agent immediately (pi's default), so the box stays live while the agent
	// works and the primary button reads "Steer".
	let effectivelyDisabled = $derived(
		searchMode
			? disabled || !connected || !searchConfigured
			: disabled || !connected || readOnly || !sessionInfo.sessionId,
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
	let draftKey = $derived(DRAFT_PREFIX + (sessionInfo.sessionId ?? 'search'));
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
	// within the current session. The text read is untracked accordingly.
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
			text = saved ?? '';
			hydratedKey = key;
		});
	});

	// Fork prefill: when the fork-at-user-message flow sets composerPrefill (a
	// bumped {text, bump}), drop that text into the box for the user to edit and
	// send, mirroring pi's `/fork`. Keyed on `bump` so re-applying the same text
	// works; guarded so bump:0 (the initial empty value) is ignored. Runs after a
	// session switch, so it deliberately wins over the (empty) hydrated draft.
	let appliedPrefillBump = $state(0);
	$effect(() => {
		const {text: prefillText, bump} = $composerPrefill;
		if (bump === 0 || bump === appliedPrefillBump) return;
		appliedPrefillBump = bump;
		untrack(() => {
			// Ensure the current key is treated as hydrated so the persist effect
			// saves this prefilled draft rather than being skipped/overwritten.
			hydratedKey = draftKey;
			text = prefillText;
			if (isCollapsed) isCollapsed = false;
			queueMicrotask(() => textarea?.focus());
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
					return;
				}
			} else if (lower === '/clear') {
				clearMessages();
				text = '';
				return;
			} else if (lower === '/leave' || lower === '/exit') {
				leaveSession();
				text = '';
				return;
			}
		}

		// pi's default: an explicit submit sends NOW. When the agent is streaming,
		// the server turns this mid-stream `message` into a STEER (injected at the
		// next tool/step boundary, before the next LLM call) rather than parking it
		// in a local queue that waits for the whole turn to resolve. The decision
		// helper is a pure, unit-tested function so this behaviour is gated in tests.
		const decision = decideComposeSend({
			streaming,
			connected,
			agentPending: appState.agentPending,
			readOnly,
			hasSession: !!sessionInfo.sessionId,
		});
		if (decision.action !== 'send') {
			// A genuine block (no session / read-only / disconnected / agent still
			// building). Keep the user's text intact; the composer's disabled/status
			// affordances already explain the state, and sendMessage() would surface a
			// recoverable error anyway. Never silently swallow the message.
			if (
				decision.reason === 'disconnected' ||
				decision.reason === 'agent-pending'
			) {
				// Route through sendMessage so it sets the clear, recoverable session
				// error ("Not connected..." / "Preparing the session agent..."). It
				// returns false and leaves the text so the user can retry.
				sendMessage(messageToSend);
			}
			return;
		}

		// Only clear the composer if the message actually went out. On a dropped
		// send (socket died in the race) sendMessage() returns false and surfaces an
		// error; keep the text so the user can retry once reconnected instead of
		// silently losing what they typed.
		const sent = sendMessage(messageToSend);
		if (sent) {
			text = '';
			attachments = [];
			onSend?.();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		// Skill autocomplete owns the navigation keys while the menu is open. The
		// first Enter/Tab ACCEPTS the highlighted command (inserting `/skill:<name> `)
		// and is swallowed, so a second Enter is needed to actually send, matching the
		// pi CLI's accept-then-send behaviour and giving the user room to type args.
		if (skillMenuOpen && skillMatches.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				skillMenuIndex = (skillMenuIndex + 1) % skillMatches.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				skillMenuIndex =
					(skillMenuIndex - 1 + skillMatches.length) % skillMatches.length;
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				const chosen = skillMatches[skillMenuIndex] ?? skillMatches[0];
				if (chosen) applySkill(chosen.name);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				skillMenuOpen = false;
				return;
			}
		}
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
						{:else if streaming}
							Agent is working, tap to Steer...
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
		{#if searchMode && searchModels.length > 0}
			<!-- Model picker for search mode. Lets the user override the search
			     folder's default model before pressing Search. -->
			<div class="mb-2 flex items-center gap-2">
				<label
					for="search-model"
					class="text-xs font-medium text-brand-text-muted">Model</label
				>
				<select
					id="search-model"
					bind:value={searchModel}
					disabled={effectivelyDisabled}
					class="min-w-0 flex-1 rounded-lg border border-brand-border bg-brand-surface-2 px-2 py-1.5 text-xs text-brand-text focus:border-brand-blue focus:outline-none disabled:opacity-50"
				>
					{#each searchModels as m}
						<option value={m.value}>{m.label}</option>
					{/each}
				</select>
			</div>
		{/if}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSend();
			}}
			class="flex items-stretch gap-3"
		>
			<div class="relative min-w-0 flex-1">
				{#if skillMenuOpen && skillMatches.length > 0}
					<!-- Skill-command autocomplete. Floats above the composer. Selecting an
					     item only inserts `/skill:<name> ` (see applySkill); it never sends. -->
					<ul
						class="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-full overflow-y-auto rounded-lg border border-brand-border bg-brand-surface-2 py-1 shadow-lg"
						role="listbox"
					>
						{#each skillMatches as skill, i (skill.name)}
							<li>
								<button
									type="button"
								role="option"
								aria-selected={i === skillMenuIndex}
								onmousedown={(e) => {
									// mousedown (not click) so the textarea doesn't blur first and
									// tear the menu down before the selection lands.
									e.preventDefault();
									applySkill(skill.name);
								}}
								onmouseenter={() => (skillMenuIndex = i)}
								class="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-sm {i ===
								skillMenuIndex
									? 'bg-brand-surface-3 text-brand-text'
									: 'text-brand-text-muted hover:bg-brand-surface-3/60'}"
							>
								<span class="font-mono text-brand-text">/{skill.name}</span>
								{#if skill.description}
									<span class="line-clamp-1 text-[11px] text-brand-text-muted"
										>{skill.description}</span
									>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
				{/if}
				<textarea
					bind:this={textarea}
					bind:value={text}
					onkeydown={handleKeydown}
					disabled={effectivelyDisabled}
					rows={1}
					placeholder={searchMode
						? (placeholder ?? 'Search the web...')
						: !connected
							? appState.connecting
								? 'Reconnecting to remote server...'
								: 'Disconnected - cannot send'
							: streaming
								? 'Agent is working, Steer to interrupt...'
								: readOnly
									? 'Read-only mode'
									: !sessionInfo.sessionId
										? 'Select a session first...'
										: 'Type a message...'}
					class="h-full max-h-48 min-h-[120px] w-full resize-none overflow-y-auto rounded-lg border border-brand-border bg-brand-surface-2 px-4 py-3 leading-relaxed text-brand-text placeholder-brand-text-muted focus:border-brand-blue focus:outline-none disabled:opacity-50"
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
				<button
					type="submit"
					disabled={!canSend}
					title={!searchMode && streaming
						? 'Steer the agent now (injected at the next step, before the next model call)'
						: undefined}
					class="flex h-[40px] w-full items-center justify-center rounded-lg bg-gradient-to-r from-brand-cyan to-brand-blue text-xs font-medium text-brand-text transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:bg-brand-surface-3 disabled:from-brand-surface-3 disabled:to-brand-surface-3 disabled:opacity-50"
				>
					{#if searchMode}
						{submitLabel ?? 'Search'}
					{:else if streaming}
						Steer
					{:else}
						Send
					{/if}
				</button>
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

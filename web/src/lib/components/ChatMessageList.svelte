<script lang="ts">
	import {
		messages,
		isStreaming,
		abort,
		activeSessionInfo,
		createSession,
		piState,
		updateConfig,
		loadMoreHistory,
		hasMoreHistory,
		isLoadingMoreHistory,
		isLoadingSession,
	} from '$lib/wherever';
	import {
		availableModels,
		gitInitDefaultStore,
		checkPath,
		autocompletePath,
	} from '$lib/session-store';
	import type {ChatMessage} from '$lib/wherever';
	import {onMount} from 'svelte';
	import {url} from '$lib/core/utils/web/path';
	import {renderMarkdown} from '$lib/core/utils/markdown';

	// Memoize rendered markdown per (message id + content length) so a finalized
	// assistant message is parsed once and its DOM stays stable afterwards. A
	// stable node is what lets a text selection survive (re-parsing on every
	// keystroke would collapse the selection, the bug we are fixing). Streaming
	// messages are NOT rendered as markdown -- they show plain text until final.
	const markdownCache = new Map<string, string>();
	function renderAssistant(id: string, content: string): string {
		const key = `${id}:${content.length}`;
		let cached = markdownCache.get(key);
		if (cached === undefined) {
			cached = renderMarkdown(content);
			markdownCache.set(key, cached);
		}
		return cached;
	}

	// Context-window usage indicator, shown next to the Hide Thinking/Tools
	// toggles. Humanize like the pi CLI: 1_000_000 -> "1.0M", 128_000 -> "128K".
	function formatTokens(n: number): string {
		if (n >= 1_000_000) {
			const m = n / 1_000_000;
			return (m >= 10 ? Math.round(m).toString() : m.toFixed(1)) + 'M';
		}
		if (n >= 1_000) return Math.round(n / 1_000) + 'K';
		return String(n);
	}

	// "11.3% / 1.0M". Percent omitted ("–") right after compaction when tokens are
	// momentarily unknown.
	let contextLabel = $derived.by(() => {
		const u = $piState.contextUsage;
		if (!u || !u.contextWindow) return null;
		const window = formatTokens(u.contextWindow);
		if (u.percent == null) return `– / ${window}`;
		return `${u.percent.toFixed(1)}% / ${window}`;
	});

	function parseUserMessage(content: string) {
		if (!content) return {cleanContent: '', attachments: []};
		const lines = content.split('\n');
		const fileRegex = /^\[Uploaded file: (.+)\]$/;
		const cleanLines: string[] = [];
		const attachments: string[] = [];

		for (const line of lines) {
			const match = line.match(fileRegex);
			if (match) {
				attachments.push(match[1]);
			} else {
				cleanLines.push(line);
			}
		}

		let cleanContent = cleanLines.join('\n').trim();
		if (cleanContent === 'I have uploaded the following file(s) for you:') {
			cleanContent = '';
		}
		return {cleanContent, attachments};
	}

	let newFolderCwd = $state('');
	let completions = $state<string[]>([]);
	let inputFocused = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let containerEl = $state<HTMLDivElement | null>(null);
	let lastCheckedPath = '';
	let newFolderModel = $state('');
	let newFolderGitInit = $state(false);
	let userManualGitInit = $state<boolean | null>(null);
	let createRemoteRepo = $state(true);
	let repoVisibility = $state<'private' | 'public'>('private');
	let showGitInitConfirmModal = $state(false);

	let appState = $derived($piState);
	let modelsData = $derived($availableModels);
	let defaultGitInit = $derived($gitInitDefaultStore);

	// Sync git init default
	$effect(() => {
		if (userManualGitInit === null) {
			newFolderGitInit = defaultGitInit;
		}
	});

	let pathStatus = $state<{
		exists: boolean | null;
		isGit: boolean;
		resolvedPath: string;
		matchingRule: {provider: string; visibility: string} | null;
	}>({
		exists: null,
		isGit: false,
		resolvedPath: '',
		matchingRule: null,
	});

	let isRemoteRepoCreation = $derived(
		pathStatus.exists !== true && pathStatus.matchingRule && createRemoteRepo,
	);

	let pathCheckTimeout: ReturnType<typeof setTimeout> | null = null;

	async function triggerCheck(pathValue: string, immediate = false) {
		if (pathCheckTimeout) clearTimeout(pathCheckTimeout);

		if (pathValue === lastCheckedPath && !immediate) return;
		lastCheckedPath = pathValue;

		if (!pathValue.trim()) {
			pathStatus = {
				exists: null,
				isGit: false,
				resolvedPath: '',
				matchingRule: null,
			};
			const fetchEmpty = async () => {
				const list = await autocompletePath('');
				completions = list || [];
			};
			if (immediate) {
				await fetchEmpty();
			} else {
				pathCheckTimeout = setTimeout(fetchEmpty, 300);
			}
			return;
		}

		const fetchFn = async () => {
			const [res, list] = await Promise.all([
				checkPath(pathValue),
				autocompletePath(pathValue),
			]);
			completions = list || [];
			if (res) {
				pathStatus = {
					exists: res.exists,
					isGit: res.isGit,
					resolvedPath: res.resolvedPath,
					matchingRule: (res as any).matchingRule || null,
				};
				if (!res.exists) {
					newFolderGitInit =
						userManualGitInit !== null ? userManualGitInit : defaultGitInit;
					createRemoteRepo = true; // reset to true for non-existing folders
					if ((res as any).matchingRule) {
						repoVisibility = (res as any).matchingRule.visibility as
							| 'private'
							| 'public';
					}
				}
			} else {
				pathStatus = {
					exists: null,
					isGit: false,
					resolvedPath: '',
					matchingRule: null,
				};
			}
		};

		if (immediate) {
			await fetchFn();
		} else {
			pathCheckTimeout = setTimeout(fetchFn, 300);
		}
	}

	$effect(() => {
		const pathValue = newFolderCwd;
		triggerCheck(pathValue, false);
	});

	// Select default model if any
	$effect(() => {
		if (modelsData.models.length > 0 && !newFolderModel) {
			const defaultModel = modelsData.models.find((m) => m.isDefault);
			if (defaultModel) {
				newFolderModel = `${defaultModel.provider}:${defaultModel.modelId}`;
			} else {
				newFolderModel = `${modelsData.models[0].provider}:${modelsData.models[0].modelId}`;
			}
		}
	});

	function handleFormCreateSession() {
		if (!newFolderCwd.trim()) return;
		if (pathStatus.exists === true) {
			newFolderGitInit = false; // toggled off by default in modal
			createRemoteRepo = false; // toggled off by default in modal
			if (pathStatus.matchingRule) {
				repoVisibility = pathStatus.matchingRule.visibility as
					| 'private'
					| 'public';
			}
			showGitInitConfirmModal = true;
		} else {
			createSession(
				newFolderCwd.trim(),
				newFolderModel || undefined,
				newFolderGitInit,
				pathStatus.matchingRule ? createRemoteRepo : undefined,
				pathStatus.matchingRule ? repoVisibility : undefined,
			);
		}
	}

	let messageList = $state<HTMLDivElement>();
	let {onMessageSent}: {onMessageSent: () => void} = $props();

	let sessionInfo = $derived($activeSessionInfo);
	let loadingSession = $derived($isLoadingSession);

	let shouldAutoScroll = $state(true);
	let forceScroll = $state(false);

	let expandedMessages = $state<Record<string, boolean>>({});

	function toggleMessage(id: string, currentVal: boolean) {
		expandedMessages[id] = !currentVal;
	}

	function parseArgsObject(
		argsStr: string | undefined,
	): Record<string, any> | null {
		if (!argsStr) return null;
		const trimmed = argsStr.trim();
		if (!trimmed) return null;

		// If it's JSON
		if (trimmed.startsWith('{')) {
			try {
				return JSON.parse(trimmed);
			} catch (e) {}
		}

		// If it's k1="v1" k2="v2" format, parse it
		const obj: Record<string, any> = {};
		const regex =
			/([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+))/g;
		let match;
		while ((match = regex.exec(trimmed)) !== null) {
			const key = match[1];
			const val =
				match[2] !== undefined
					? match[2]
					: match[3] !== undefined
						? match[3]
						: match[4];
			obj[key] = val;
		}

		if (Object.keys(obj).length > 0) {
			return obj;
		}

		return null;
	}

	function getSmartTitleArgs(
		toolName: string,
		argsObj: Record<string, any> | null,
		rawArgsStr: string,
	): string {
		if (!argsObj) {
			return rawArgsStr ? rawArgsStr.trim() : '';
		}

		const name = toolName.toLowerCase();

		// 1. read, write, edit, ls: show the path directly
		if (['read', 'write', 'edit', 'ls'].includes(name)) {
			const pathVal = argsObj.path || argsObj.filepath || argsObj.file;
			if (pathVal) {
				return String(pathVal);
			}
		}

		// 2. bash: show the first few characters of the command
		if (name === 'bash') {
			const cmd = argsObj.command || argsObj.cmd;
			if (cmd) {
				const cleanCmd = String(cmd).replace(/\s+/g, ' ').trim();
				return cleanCmd.length > 50 ? cleanCmd.slice(0, 47) + '...' : cleanCmd;
			}
		}

		// 3. grep: show pattern / pattern in path
		if (name === 'grep') {
			const pattern = argsObj.pattern;
			const pathVal = argsObj.path;
			if (pattern) {
				return pathVal ? `"${pattern}" in ${pathVal}` : `"${pattern}"`;
			}
		}

		// 4. find: show pattern or path
		if (name === 'find') {
			const pattern = argsObj.pattern || argsObj.path;
			if (pattern) {
				return String(pattern);
			}
		}

		// Custom tools check for common key names
		const commonPath =
			argsObj.path ||
			argsObj.filepath ||
			argsObj.file ||
			argsObj.name ||
			argsObj.query;
		if (commonPath) {
			return String(commonPath);
		}

		// Default fallback formatting for title
		return Object.entries(argsObj)
			.filter(([k, v]) => v !== undefined && v !== '')
			.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
			.join(' ');
	}

	function getFullArgsFormatted(
		argsObj: Record<string, any> | null,
		rawArgsStr: string,
	): string {
		if (argsObj) {
			return JSON.stringify(argsObj, null, 2);
		}
		return rawArgsStr ? rawArgsStr.trim() : '';
	}

	function parseToolMessage(msg: ChatMessage) {
		let toolName = msg.toolName || 'tool';
		let toolArgs = msg.toolArgs !== undefined ? msg.toolArgs : '';
		let toolOutput = msg.toolOutput !== undefined ? msg.toolOutput : '';
		let isError = !!msg.isError;

		// If we don't have toolArgs or toolOutput, or if they are empty but msg.content is populated,
		// let's parse from content to be absolutely sure we get any args embedded in the raw text.
		if (!toolArgs && !toolOutput && msg.content) {
			let content = msg.content || '';

			if (content.startsWith('Error: ')) {
				isError = true;
				content = content.slice(7);
			} else if (content.startsWith('Tool error: ')) {
				isError = true;
				content = content.slice(12);
			}

			const firstLineBreak = content.indexOf('\n');
			const headerLine =
				firstLineBreak !== -1 ? content.slice(0, firstLineBreak) : content;
			toolOutput =
				firstLineBreak !== -1 ? content.slice(firstLineBreak + 1) : '';

			let header = headerLine.trim();
			if (header.startsWith('$ ')) {
				header = header.slice(2);
			}

			const firstSpace = header.indexOf(' ');
			toolName =
				msg.toolName ||
				(firstSpace !== -1 ? header.slice(0, firstSpace) : header) ||
				'tool';
			toolArgs = firstSpace !== -1 ? header.slice(firstSpace + 1) : '';
		}

		const argsObj = parseArgsObject(toolArgs);
		const smartTitleArgs = getSmartTitleArgs(toolName, argsObj, toolArgs);
		const fullArgs = getFullArgsFormatted(argsObj, toolArgs);

		return {
			toolName,
			smartTitleArgs,
			fullArgs,
			toolOutput,
			isError,
		};
	}

	function isScrolledToBottom(el: HTMLDivElement): boolean {
		const threshold = 20;
		return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
	}

	function handleScroll() {
		if (messageList) {
			shouldAutoScroll = isScrolledToBottom(messageList);
		}
	}

	function scrollToBottom() {
		if (messageList) {
			messageList.scrollTop = messageList.scrollHeight;
		}
	}

	function scrollToBottomIfShould() {
		if (shouldAutoScroll || forceScroll) {
			scrollToBottom();
			forceScroll = false;
		}
	}

	onMount(scrollToBottom);

	$effect(() => {
		if (messageList) {
			messageList.addEventListener('scroll', handleScroll);
			return () => {
				if (messageList) {
					messageList.removeEventListener('scroll', handleScroll);
				}
			};
		}
	});

	let lastSessionFile = $state<string | null>(null);
	let wasLoadingSession = $state(false);

	// Scroll the freshly-loaded session to the bottom. The session history
	// arrives as a separate WS message after the session itself, and the
	// rendered messages (markdown, code blocks) keep growing for a few frames
	// after they mount, so a single synchronous scroll lands too early. Retry
	// across a couple of frames to settle on the true bottom.
	function scrollToBottomSettled() {
		forceScroll = true;
		scrollToBottom();
		requestAnimationFrame(() => {
			scrollToBottom();
			requestAnimationFrame(scrollToBottom);
		});
		setTimeout(scrollToBottom, 60);
		setTimeout(scrollToBottom, 150);
	}

	$effect(() => {
		// Force scroll to bottom when the active session changes...
		const sFile = sessionInfo.sessionFile;
		if (sFile !== lastSessionFile) {
			lastSessionFile = sFile;
			forceScroll = true;
		}

		// ...and again once its history finishes loading, since the messages only
		// render after loadingSession flips back to false.
		const isLoading = loadingSession;
		if (wasLoadingSession && !isLoading) {
			scrollToBottomSettled();
		}
		wasLoadingSession = isLoading;
	});

	let msgList = $derived.by(() => {
		const filtered = $messages.filter((msg) => {
			if (msg.role === 'thinking') {
				if ($piState.hideThinking) {
					return false;
				}
			}
			if (msg.role === 'tool') {
				if ($piState.hideTools) {
					return isAssociatedWithForceCommand(msg) || !!msg.isStreaming;
				}
			}
			return (
				(msg.role !== 'assistant' && msg.role !== 'thinking') ||
				msg.isStreaming ||
				msg.content.trim() !== ''
			);
		});

		const activeStreamExists = filtered.some((msg) => msg.isStreaming);
		if (streaming && !activeStreamExists) {
			const isThinking = $messages.some(
				(msg) => msg.role === 'thinking' && msg.isStreaming,
			);
			filtered.push({
				id: 'fallback-loader-message-id',
				role: 'thinking',
				content: isThinking ? 'FALLBACK_THINKING_LOADER' : 'FALLBACK_LOADER',
				timestamp: Date.now(),
				isStreaming: true,
			});
		}

		return filtered;
	});
	let streaming = $derived($isStreaming);

	$effect.pre(() => {
		// React to msgList length and content changes of the last message in msgList
		const lastMsg = msgList[msgList.length - 1];
		const triggerValue = lastMsg
			? `${msgList.length}-${lastMsg.content.length}`
			: '0';

		if (messageList) {
			shouldAutoScroll = isScrolledToBottom(messageList);
		}
	});

	$effect(() => {
		// React to msgList length and content changes of the last message in msgList
		const lastMsg = msgList[msgList.length - 1];
		const triggerValue = lastMsg
			? `${msgList.length}-${lastMsg.content.length}`
			: '0';

		scrollToBottomIfShould();
	});

	function formatTime(timestamp: number) {
		return new Date(timestamp).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function isAssociatedWithForceCommand(msg: ChatMessage): boolean {
		const list = $messages;
		const idx = list.findIndex((m) => m.id === msg.id);
		if (idx === -1) return false;

		// Look back for the closest user message
		for (let i = idx - 1; i >= 0; i--) {
			if (list[i].role === 'user') {
				const content = list[i].content ? list[i].content.trim() : '';
				return content.startsWith('!') || content.startsWith('!!');
			}
		}
		return false;
	}

	function shouldAutoExpand(msg: ChatMessage, list: ChatMessage[]): boolean {
		return isAssociatedWithForceCommand(msg);
	}

	export function forceScrollToBottom() {
		forceScroll = true;
		setTimeout(scrollToBottom, 0);
	}

	let moreHistory = $derived($hasMoreHistory);
	let loadingMore = $derived($isLoadingMoreHistory);

	// Scroll anchoring: when older messages are prepended, keep the viewport on
	// the same content by preserving the distance from the bottom.
	let pendingAnchorFromBottom = $state<number | null>(null);

	function handleLoadMore() {
		if (!messageList || loadingMore || !moreHistory) return;
		// Record how far we are from the bottom so we can restore it after the
		// older window is prepended and the list grows upward.
		pendingAnchorFromBottom = messageList.scrollHeight - messageList.scrollTop;
		loadMoreHistory();
	}

	$effect(() => {
		// When messages change and we have a pending anchor (older history was
		// just prepended), restore the scroll position relative to the bottom.
		const _len = $messages.length;
		if (pendingAnchorFromBottom !== null && messageList) {
			const anchor = pendingAnchorFromBottom;
			pendingAnchorFromBottom = null;
			// Defer until after DOM paints the prepended nodes.
			requestAnimationFrame(() => {
				if (messageList) {
					messageList.scrollTop = messageList.scrollHeight - anchor;
				}
			});
		}
	});
</script>

<div class="flex flex-1 flex-col overflow-hidden bg-brand-dark">
	{#if appState.connecting}
		<div
			class="flex flex-1 flex-col items-center justify-center bg-brand-dark p-6 text-brand-text-muted"
		>
			<div class="text-center">
				<div
					class="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-brand-blue border-t-transparent"
				></div>
				<p class="text-base font-medium text-brand-text">
					Connecting to Wherever Server...
				</p>
				<p class="mt-1 text-xs text-brand-text-muted">
					Establishing secure connection to your agent
				</p>
			</div>
		</div>
	{:else if !appState.connected}
		<div
			class="flex flex-1 flex-col items-center justify-center bg-brand-dark p-6 text-brand-text-muted"
		>
			<div
				class="w-full max-w-md rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center text-brand-text"
			>
				<div class="mb-3 text-4xl">⚠️</div>
				<h3 class="text-lg font-bold text-rose-400">Not Connected to Server</h3>
				<p class="mt-2 text-sm text-brand-text-muted">
					We couldn't connect to the Wherever Server. Please verify the server
					is running and check your connection settings in the sidebar.
				</p>
				{#if appState.error}
					<p
						class="mt-3 max-h-24 overflow-y-auto rounded bg-brand-surface-3 p-2 font-mono text-xs text-rose-300/80"
					>
						{appState.error}
					</p>
				{/if}
				<button
					onclick={() => {
						import('$lib/wherever').then((m) => m.connect());
					}}
					class="mt-5 rounded bg-brand-surface-2 px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-surface-3"
				>
					Retry Connection
				</button>
			</div>
		</div>
	{:else if loadingSession || (!sessionInfo.sessionFile && typeof window !== 'undefined' && window.location.hash)}
		<div
			class="flex flex-1 flex-col items-center justify-center bg-brand-dark p-6 text-brand-text-muted"
		>
			<div class="text-center">
				<div
					class="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-brand-blue border-t-transparent"
				></div>
				<p class="text-base font-medium text-brand-text">Loading session...</p>
				<p class="mt-1 text-xs text-brand-text-muted">
					Retrieving workspace session history
				</p>
			</div>
		</div>
	{:else if !sessionInfo.sessionFile}
		<div class="flex flex-1 items-center justify-center p-6">
			<div
				class="w-full max-w-md rounded-lg border border-brand-border bg-brand-surface/40 p-6 text-brand-text"
			>
				<div class="mb-5 text-center">
					<div class="mb-3 flex justify-center">
						<img src={url('/logo.svg')} alt="Wherever" class="h-16 w-16" />
					</div>
					<h2 class="mb-1 text-2xl font-bold">
						<span class="gradient-text">Wherever</span>
					</h2>
					<h3 class="text-sm font-semibold text-brand-text">
						Create a New Session
					</h3>
					<p class="mt-1 text-xs text-brand-text-muted">
						Start a coding session in any folder on your machine, or use the
						sidebar to open an existing session.
					</p>
				</div>

				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleFormCreateSession();
					}}
					class="space-y-4"
				>
					<div>
						<label
							class="mb-1 block text-xs font-bold tracking-wider text-brand-text-muted uppercase"
							for="main-folder-path">Folder Path</label
						>
						<div class="relative" bind:this={containerEl}>
							<input
								bind:this={inputEl}
								id="main-folder-path"
								type="text"
								autocomplete="off"
								spellcheck="false"
								placeholder="e.g. ~/projects/my-new-app"
								bind:value={newFolderCwd}
								onfocus={() => {
									inputFocused = true;
									triggerCheck(newFolderCwd, true);
								}}
								onblur={(e) => {
									if (
										containerEl &&
										containerEl.contains(e.relatedTarget as Node)
									) {
										return;
									}
									inputFocused = false;
								}}
								onkeydown={(e) => {
									if (e.key === 'Escape') {
										inputFocused = false;
									}
								}}
								class="w-full rounded border px-3 py-2 text-sm text-brand-text placeholder-brand-text-muted transition-all duration-200 focus:outline-none {isRemoteRepoCreation
									? 'border-emerald-500/80 bg-emerald-500/10 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30'
									: 'border-brand-border bg-brand-surface-3 focus:border-brand-blue'}"
							/>
							{#if inputFocused && completions.length > 0}
								<div
									class="absolute right-0 left-0 z-50 mt-1 max-h-48 overflow-y-auto rounded border border-brand-border bg-brand-surface-2 py-1 shadow-xl"
								>
									{#each completions as completion}
										<button
											type="button"
											onclick={() => {
												newFolderCwd = completion;
												triggerCheck(completion, true);
												inputEl?.focus();
											}}
											class="block w-full px-3 py-1.5 text-left text-sm text-brand-text transition-colors hover:bg-brand-surface-3 hover:text-brand-text"
										>
											{completion}
										</button>
									{/each}
								</div>
							{/if}
						</div>
						{#if pathStatus.exists === true}
							<span class="mt-1.5 block text-xs font-medium text-yellow-400">
								📁 Folder already exists. Joining will create a session in it.
								{#if pathStatus.isGit}
									<span class="ml-1 font-medium text-emerald-400"
										>(Git repo detected)</span
									>
								{/if}
							</span>
						{:else}
							<span class="mt-1 block text-[10px] text-brand-text-muted"
								>Relative paths are created inside your home folder.</span
							>
						{/if}
					</div>

					<div>
						<label
							class="mb-1 block text-xs font-bold tracking-wider text-brand-text-muted uppercase"
							for="main-model-select">Model</label
						>
						{#if modelsData.models.length > 0}
							<select
								id="main-model-select"
								bind:value={newFolderModel}
								class="w-full rounded border border-brand-border bg-brand-surface-3 px-3 py-2 text-sm text-brand-text focus:border-brand-blue focus:outline-none"
							>
								{#each modelsData.models as model}
									<option value={`${model.provider}:${model.modelId}`}>
										{model.label}{model.isDefault ? ' (default)' : ''}
									</option>
								{/each}
							</select>
						{:else}
							<input
								id="main-model-select"
								type="text"
								bind:value={newFolderModel}
								placeholder="provider:model"
								class="w-full rounded border border-brand-border bg-brand-surface-3 px-3 py-2 text-sm text-brand-text placeholder-brand-text-muted focus:border-brand-blue focus:outline-none"
							/>
						{/if}
					</div>

					{#if pathStatus.exists !== true && pathStatus.matchingRule}
						<div class="space-y-1.5 pt-1">
							<div class="flex items-center gap-2">
								<input
									id="main-create-remote"
									type="checkbox"
									bind:checked={createRemoteRepo}
									class="h-4 w-4 rounded border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue focus:ring-offset-brand-surface"
								/>
								<label
									for="main-create-remote"
									class="cursor-pointer text-sm text-brand-text select-none"
								>
									Create remote {pathStatus.matchingRule.provider} repository
								</label>
							</div>

							{#if createRemoteRepo}
								<div
									class="flex items-center gap-4 pl-6 text-xs text-brand-text-muted"
								>
									<span>Visibility:</span>
									<label
										class="flex cursor-pointer items-center gap-1.5 transition-colors select-none hover:text-brand-text"
									>
										<input
											type="radio"
											name="main-visibility"
											value="private"
											bind:group={repoVisibility}
											class="border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue"
										/>
										Private
									</label>
									<label
										class="flex cursor-pointer items-center gap-1.5 transition-colors select-none hover:text-brand-text"
									>
										<input
											type="radio"
											name="main-visibility"
											value="public"
											bind:group={repoVisibility}
											class="border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue"
										/>
										Public
									</label>
								</div>
							{/if}
						</div>
					{/if}

					{#if pathStatus.exists !== true && (!pathStatus.matchingRule || !createRemoteRepo)}
						<div class="flex items-center gap-2 pt-1">
							<input
								id="main-git-init"
								type="checkbox"
								bind:checked={newFolderGitInit}
								onchange={(e) => {
									userManualGitInit = e.currentTarget.checked;
								}}
								class="h-4 w-4 rounded border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue focus:ring-offset-brand-surface"
							/>
							<label
								for="main-git-init"
								class="cursor-pointer text-sm text-brand-text select-none"
							>
								Initialize Git repository
							</label>
						</div>
					{/if}

					<button
						type="submit"
						disabled={!newFolderCwd.trim()}
						class="w-full rounded bg-gradient-to-r from-brand-cyan to-brand-blue py-2.5 text-sm font-semibold text-brand-text transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Create & Start Session
					</button>
				</form>
			</div>
		</div>
	{:else if msgList.length === 0}
		<div class="flex flex-1 items-center justify-center text-brand-text-muted">
			<div class="text-center">
				<div class="mb-4 text-4xl">💬</div>
				<p class="mb-2 text-lg font-medium text-brand-text">
					New Session Started
				</p>
				<p class="text-sm">Type a message below to start building</p>
			</div>
		</div>
	{:else}
		<div
			bind:this={messageList}
			class="flex-1 space-y-4 overflow-y-auto overscroll-y-contain p-4"
		>
			{#if moreHistory}
				<div class="flex justify-center pb-2">
					<button
						onclick={handleLoadMore}
						disabled={loadingMore}
						class="rounded border border-brand-border bg-brand-surface-2 px-3 py-1.5 text-xs text-brand-text-muted transition-colors hover:bg-brand-surface-3 hover:text-brand-text disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if loadingMore}
							Loading older messages...
						{:else}
							Load older messages
						{/if}
					</button>
				</div>
			{/if}
			{#each msgList as msg (msg.id)}
				<div
					class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}"
				>
					<div
						class="max-w-[85%] rounded-lg px-4 py-3 {msg.role === 'user'
							? 'bg-brand-blue/80 text-brand-text'
							: msg.role === 'thinking'
								? 'border-l-2 border-brand-border bg-brand-surface/30 text-sm text-brand-text-muted'
								: msg.role === 'tool'
									? $piState.hideTools && !isAssociatedWithForceCommand(msg)
										? 'border-l-2 border-brand-border bg-brand-surface/30 text-sm text-brand-text-muted'
										: `border-l-2 bg-brand-surface-2 font-mono text-sm text-brand-text ${
												msg.isStreaming
													? 'border-amber-400'
													: msg.isError
														? 'border-rose-400'
														: 'border-emerald-400'
											}`
									: msg.role === 'assistant'
										? 'border-l-2 border-brand-purple bg-brand-purple/10 text-brand-text'
										: msg.content === '' && msg.isStreaming
											? 'bg-brand-surface-3 text-brand-text-muted italic'
											: 'bg-brand-surface-2 text-brand-text'}"
					>
						{#if msg.role === 'thinking'}
							{#if msg.content === 'FALLBACK_THINKING_LOADER'}
								<div
									class="flex items-center gap-2 font-sans text-sm text-brand-text-muted italic select-none"
								>
									<svg
										class="h-4 w-4 animate-spin text-brand-cyan"
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
									>
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										></circle>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										></path>
									</svg>
									<span>Agent is thinking...</span>
								</div>
							{:else if msg.content === 'FALLBACK_LOADER'}
								<div
									class="flex items-center gap-2 font-sans text-sm text-brand-text-muted italic select-none"
								>
									<svg
										class="h-4 w-4 animate-spin text-brand-cyan"
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
									>
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										></circle>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										></path>
									</svg>
									<span>Agent working...</span>
								</div>
							{:else if $piState.hideThinking}
								<div
									class="flex items-center gap-2 font-sans text-sm text-brand-text-muted italic select-none"
								>
									<svg
										class="h-4 w-4 animate-spin text-brand-cyan"
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
									>
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										></circle>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										></path>
									</svg>
									<span>Agent is thinking...</span>
								</div>
							{:else}
								<div class="flex flex-col gap-1">
									{#if msg.isStreaming}
										<div
											class="mb-1 flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-brand-cyan uppercase select-none"
										>
											<span
												class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-cyan"
											></span>
											<span>Thinking</span>
										</div>
									{/if}
									<div class="font-mono text-sm whitespace-pre-wrap">
										{msg.content}
									</div>
								</div>
							{/if}
						{:else if msg.role === 'tool'}
							{#if $piState.hideTools && !isAssociatedWithForceCommand(msg)}
								<div
									class="flex items-center gap-2 font-sans text-sm text-brand-text-muted italic select-none"
								>
									<svg
										class="h-4 w-4 animate-spin text-amber-500"
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
									>
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										></circle>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										></path>
									</svg>
									<span
										>Running tool: <span
											class="rounded bg-brand-surface-3 px-1 py-0.5 font-mono text-xs font-semibold"
											>{msg.toolName || 'agent'}</span
										>...</span
									>
								</div>
							{:else}
								{@const parsed = parseToolMessage(msg)}
								{@const isExpanded =
									expandedMessages[msg.id] !== undefined
										? expandedMessages[msg.id]
										: shouldAutoExpand(msg, msgList)}
								<div
									class="flex max-w-full min-w-[280px] flex-col sm:min-w-[400px] md:min-w-[550px]"
								>
									<!-- Header of tool execution -->
									<button
										onclick={() => toggleMessage(msg.id, isExpanded)}
										class="flex w-full items-center justify-between gap-3 rounded p-1 text-left transition-colors hover:bg-brand-surface-3/30 focus:outline-none"
									>
										<div class="flex flex-1 items-center gap-2 overflow-hidden">
											<!-- Status icon -->
											{#if msg.isStreaming}
												<!-- Running -->
												<span
													class="inline-block animate-spin font-bold text-amber-400"
													>⚡</span
												>
											{:else if parsed.isError}
												<!-- Error -->
												<span class="font-bold text-rose-400" title="Failed"
													>❌</span
												>
											{:else}
												<!-- Success -->
												<span
													class="font-bold text-emerald-400"
													title="Succeeded">✅</span
												>
											{/if}

											<span class="font-mono text-sm font-bold text-brand-text">
												{parsed.toolName}
											</span>

											{#if parsed.smartTitleArgs}
												<span
													class="max-w-[180px] truncate font-mono text-xs text-brand-text-muted sm:max-w-[300px] md:max-w-[450px]"
													title={parsed.smartTitleArgs}
												>
													{parsed.smartTitleArgs}
												</span>
											{/if}
										</div>

										<div
											class="flex shrink-0 items-center gap-1 font-sans text-xs font-medium whitespace-nowrap text-brand-text-muted select-none hover:text-brand-text"
										>
											{#if isExpanded}
												Collapse <span class="text-[10px]">▲</span>
											{:else}
												Expand <span class="text-[10px]">▼</span>
											{/if}
										</div>
									</button>

									<!-- Tool Output (collapsible) -->
									{#if isExpanded}
										<div
											class="mt-2 flex flex-col gap-3 overflow-hidden border-t border-brand-border/40 pt-2"
										>
											<!-- Full Arguments section -->
											{#if parsed.fullArgs && parsed.fullArgs !== '{}'}
												<div class="flex flex-col gap-1">
													<span
														class="font-sans text-[10px] font-bold tracking-wider text-brand-text-muted uppercase"
														>Arguments</span
													>
													<pre
														class="max-h-40 overflow-x-auto rounded border border-brand-border/30 bg-brand-dark/60 p-1.5 font-mono text-[11px] whitespace-pre-wrap text-amber-400">{parsed.fullArgs}</pre>
												</div>
											{/if}

											<!-- Tool Output section -->
											<div class="flex flex-col gap-1">
												<span
													class="font-sans text-[10px] font-bold tracking-wider text-brand-text-muted uppercase"
													>Output</span
												>
												{#if parsed.toolOutput}
													<pre
														class="max-h-96 overflow-x-auto rounded border border-brand-border/40 bg-brand-dark/60 p-2 font-mono text-xs whitespace-pre-wrap text-brand-text">{parsed.toolOutput}</pre>
												{:else if msg.isStreaming}
													<div
														class="animate-pulse p-1 text-xs text-brand-text-muted italic"
													>
														Running and waiting for output...
													</div>
												{:else}
													<div class="p-1 text-xs text-brand-text-muted italic">
														No output returned
													</div>
												{/if}
											</div>
										</div>
									{/if}
								</div>
							{/if}
						{:else if msg.role === 'assistant' && msg.content !== ''}
							{#if msg.isStreaming}
								<!-- While streaming, render plain text. Re-parsing markdown on
								     every token would rebuild the DOM and collapse any active
								     selection; the finalized branch renders once and stays stable. -->
								<pre
									class="chat-selectable font-sans text-sm leading-relaxed whitespace-pre-wrap">{msg.content}<span
										class="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-brand-cyan align-text-bottom"
									></span></pre>
							{:else}
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- output sanitized via DOMPurify in renderMarkdown -->
								<div
									class="chat-selectable markdown-body text-sm leading-relaxed"
								>
									{@html renderAssistant(msg.id, msg.content)}
								</div>
							{/if}
						{:else}
							{@const parsedUserMsg = parseUserMessage(msg.content)}
							<div class="text-sm leading-relaxed whitespace-pre-wrap">
								{#if parsedUserMsg.cleanContent}
									{parsedUserMsg.cleanContent}
								{:else if parsedUserMsg.attachments.length > 0}
									<span class="text-brand-text-muted italic"
										>Shared file{parsedUserMsg.attachments.length > 1
											? 's'
											: ''} with agent:</span
									>
								{:else}
									{msg.content || (msg.isStreaming ? 'Thinking...' : '')}
								{/if}
								{#if msg.isStreaming && streaming}
									<span
										class="ml-1 inline-block h-4 w-1.5 animate-pulse bg-brand-cyan"
									></span>
								{/if}
							</div>
							{#if parsedUserMsg.attachments.length > 0}
								<div
									class="mt-2 flex flex-col gap-1 border-t border-brand-blue/20 pt-2"
								>
									{#each parsedUserMsg.attachments as filePath}
										<div
											class="flex items-center gap-1.5 rounded bg-brand-blue/20 px-2 py-1 font-mono text-xs text-brand-text select-all"
										>
											<span>📎</span>
											<span class="truncate" title={filePath}>{filePath}</span>
										</div>
									{/each}
								</div>
							{/if}
						{/if}
						{#if msg.role !== 'thinking' && msg.role !== 'tool'}
							<div
								class="mt-1 text-xs opacity-50 {msg.role === 'user'
									? 'text-brand-text-muted'
									: msg.role === 'assistant'
										? 'text-brand-purple'
										: 'text-brand-text-muted'}"
							>
								{formatTime(msg.timestamp)}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<div
		class="app-chrome flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-brand-border p-2"
	>
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
			<label
				class="flex cursor-pointer items-center gap-1.5 text-xs text-brand-text-muted select-none hover:text-brand-text"
			>
				<input
					type="checkbox"
					checked={$piState.hideThinking}
					onchange={(e) =>
						updateConfig({
							hideThinking: (e.currentTarget as HTMLInputElement).checked,
						})}
					class="h-3.5 w-3.5 rounded border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue"
				/>
				Hide Thinking
			</label>
			<label
				class="flex cursor-pointer items-center gap-1.5 text-xs text-brand-text-muted select-none hover:text-brand-text"
			>
				<input
					type="checkbox"
					checked={$piState.hideTools}
					onchange={(e) =>
						updateConfig({
							hideTools: (e.currentTarget as HTMLInputElement).checked,
						})}
					class="h-3.5 w-3.5 rounded border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue"
				/>
				Hide Tools
			</label>

			<!-- Context-window usage, e.g. "11.3% / 1.0M" -->
			{#if contextLabel}
				<div
					class="flex items-center gap-1 text-xs text-brand-text-muted"
					title={$piState.contextUsage?.tokens != null
						? `${$piState.contextUsage.tokens.toLocaleString()} context tokens of ${$piState.contextUsage.contextWindow.toLocaleString()}`
						: 'Context window size'}
				>
					<span class="flex-shrink-0">🧠</span>
					<span class="tabular-nums whitespace-nowrap">{contextLabel}</span>
				</div>
			{/if}
		</div>
		<button
			onclick={abort}
			disabled={!streaming}
			class="rounded bg-rose-500 px-3 py-1.5 text-xs text-brand-text transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
			title="Abort"
		>
			Abort
		</button>
	</div>

	<!-- Custom Confirm Modal for Existing Folders -->
	{#if showGitInitConfirmModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark/65 p-4"
			role="dialog"
			aria-modal="true"
		>
			<div
				class="w-full max-w-sm rounded-lg border border-brand-border bg-brand-surface-2 p-6 text-brand-text"
			>
				<h3 class="mb-2 text-base font-bold text-brand-text">
					Folder Already Exists
				</h3>
				<p class="mb-4 text-sm text-brand-text-muted">
					The folder <span class="font-mono text-xs text-brand-text"
						>{newFolderCwd}</span
					> already exists. Do you want to initialize a Git repository in it?
				</p>

				<div class="mb-6 flex flex-col gap-3.5">
					<div class="flex items-center gap-2">
						<input
							id="modal-git-init"
							type="checkbox"
							bind:checked={newFolderGitInit}
							disabled={pathStatus.isGit}
							class="h-4 w-4 rounded border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue disabled:opacity-50"
						/>
						<label
							for="modal-git-init"
							class="cursor-pointer text-sm text-brand-text select-none disabled:opacity-50"
						>
							Initialize Git repository
							{#if pathStatus.isGit}
								<span class="ml-1 text-xs text-brand-text-muted"
									>(already a Git repository)</span
								>
							{:else}
								<span class="ml-1 text-xs font-medium text-yellow-500"
									>(folder not empty)</span
								>
							{/if}
						</label>
					</div>

					{#if pathStatus.matchingRule}
						<div class="space-y-1.5">
							<div class="flex items-center gap-2">
								<input
									id="modal-create-remote"
									type="checkbox"
									bind:checked={createRemoteRepo}
									class="h-4 w-4 rounded border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue"
								/>
								<label
									for="modal-create-remote"
									class="cursor-pointer text-sm text-brand-text select-none"
								>
									Create remote {pathStatus.matchingRule.provider} repository
								</label>
							</div>

							{#if createRemoteRepo}
								<div
									class="flex items-center gap-4 pl-6 text-xs text-brand-text-muted"
								>
									<span>Visibility:</span>
									<label
										class="flex cursor-pointer items-center gap-1.5 transition-colors select-none hover:text-brand-text"
									>
										<input
											type="radio"
											name="modal-visibility"
											value="private"
											bind:group={repoVisibility}
											class="border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue"
										/>
										Private
									</label>
									<label
										class="flex cursor-pointer items-center gap-1.5 transition-colors select-none hover:text-brand-text"
									>
										<input
											type="radio"
											name="modal-visibility"
											value="public"
											bind:group={repoVisibility}
											class="border-brand-border bg-brand-surface-3 text-brand-blue focus:ring-brand-blue"
										/>
										Public
									</label>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<div class="flex justify-end gap-2.5">
					<button
						type="button"
						onclick={() => (showGitInitConfirmModal = false)}
						class="rounded bg-brand-surface-3 px-3.5 py-1.5 text-xs font-semibold text-brand-text transition-colors hover:bg-brand-surface-2"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={() => {
							showGitInitConfirmModal = false;
							createSession(
								newFolderCwd.trim(),
								newFolderModel || undefined,
								newFolderGitInit,
								pathStatus.matchingRule ? createRemoteRepo : undefined,
								pathStatus.matchingRule ? repoVisibility : undefined,
							);
						}}
						class="rounded bg-gradient-to-r from-brand-cyan to-brand-blue px-3.5 py-1.5 text-xs font-semibold text-brand-text transition-all hover:opacity-90"
					>
						Confirm & Create
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

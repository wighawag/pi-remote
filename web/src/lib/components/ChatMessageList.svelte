<script lang="ts">
	import {
		messages,
		isStreaming,
		abort,
		clearMessages,
		activeSessionInfo,
		createSession,
		piState,
	} from '$lib/pi-remote';
	import {
		availableModels,
		gitInitDefaultStore,
		checkPath,
	} from '$lib/session-store';
	import type {ChatMessage} from '$lib/pi-remote';
	import {onMount} from 'svelte';

	let newFolderCwd = $state('');
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
		matchingRule: { provider: string; visibility: string } | null;
	}>({
		exists: null,
		isGit: false,
		resolvedPath: '',
		matchingRule: null,
	});

	let pathCheckTimeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const pathValue = newFolderCwd;
		if (pathCheckTimeout) clearTimeout(pathCheckTimeout);

		if (!pathValue.trim()) {
			pathStatus = { exists: null, isGit: false, resolvedPath: '', matchingRule: null };
			return;
		}

		pathCheckTimeout = setTimeout(async () => {
			const res = await checkPath(pathValue);
			if (res) {
				pathStatus = {
					exists: res.exists,
					isGit: res.isGit,
					resolvedPath: res.resolvedPath,
					matchingRule: (res as any).matchingRule || null
				};
				if (!res.exists) {
					newFolderGitInit = userManualGitInit !== null ? userManualGitInit : defaultGitInit;
					createRemoteRepo = true; // reset to true for non-existing folders
					if ((res as any).matchingRule) {
						repoVisibility = (res as any).matchingRule.visibility as 'private' | 'public';
					}
				}
			} else {
				pathStatus = { exists: null, isGit: false, resolvedPath: '', matchingRule: null };
			}
		}, 300);
	});

	// Select default model if any
	$effect(() => {
		if (modelsData.models.length > 0 && !newFolderModel) {
			const defaultModel = modelsData.models.find(m => m.isDefault);
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
				repoVisibility = pathStatus.matchingRule.visibility as 'private' | 'public';
			}
			showGitInitConfirmModal = true;
		} else {
			createSession(
				newFolderCwd.trim(), 
				newFolderModel || undefined, 
				newFolderGitInit, 
				pathStatus.matchingRule ? createRemoteRepo : undefined,
				pathStatus.matchingRule ? repoVisibility : undefined
			);
		}
	}

	let messageList = $state<HTMLDivElement>();
	let {onMessageSent}: {onMessageSent: () => void} = $props();

	let sessionInfo = $derived($activeSessionInfo);

	let shouldAutoScroll = $state(true);
	let forceScroll = $state(false);

	let expandedMessages = $state<Record<string, boolean>>({});

	function toggleMessage(id: string) {
		expandedMessages[id] = !expandedMessages[id];
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

	$effect(() => {
		// React to both array length and the last message's content length (which changes on every single streamed token!)
		const lastMsg = $messages[$messages.length - 1];
		const triggerValue = lastMsg
			? `${$messages.length}-${lastMsg.content.length}`
			: '0';

		setTimeout(scrollToBottomIfShould, 0);
	});

	$effect(() => {
		// Force scroll to bottom when the active session changes
		const sFile = sessionInfo.sessionFile;
		forceScroll = true;
		setTimeout(scrollToBottom, 50);
	});

	let msgList = $derived(
		$messages.filter(
			(msg) =>
				(msg.role !== 'assistant' && msg.role !== 'thinking') ||
				msg.isStreaming ||
				msg.content.trim() !== '',
		),
	);
	let streaming = $derived($isStreaming);

	function formatTime(timestamp: number) {
		return new Date(timestamp).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	export function forceScrollToBottom() {
		forceScroll = true;
		setTimeout(scrollToBottom, 0);
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden bg-gray-900">
	{#if appState.connecting}
		<div class="flex flex-1 flex-col items-center justify-center p-6 bg-gray-900 text-gray-500">
			<div class="text-center">
				<div class="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mb-4"></div>
				<p class="text-base font-medium text-gray-300">Connecting to Pi Remote Server...</p>
				<p class="text-xs text-gray-500 mt-1">Establishing secure connection to your agent</p>
			</div>
		</div>
	{:else if !appState.connected}
		<div class="flex flex-1 flex-col items-center justify-center p-6 bg-gray-900 text-gray-500">
			<div class="w-full max-w-md rounded-lg border border-red-500/30 bg-red-900/10 p-6 text-center text-gray-300">
				<div class="mb-3 text-4xl">⚠️</div>
				<h3 class="text-lg font-bold text-red-400">Not Connected to Server</h3>
				<p class="text-sm text-gray-400 mt-2">
					We couldn't connect to the Pi Remote Server. Please verify the server is running and check your connection settings in the sidebar.
				</p>
				{#if appState.error}
					<p class="mt-3 rounded bg-red-950/40 p-2 font-mono text-xs text-red-300/80 max-h-24 overflow-y-auto">
						{appState.error}
					</p>
				{/if}
				<button
					onclick={() => {
						import('$lib/pi-remote').then(m => m.connect());
					}}
					class="mt-5 rounded bg-gray-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-750"
				>
					Retry Connection
				</button>
			</div>
		</div>
	{:else if !sessionInfo.sessionFile && typeof window !== 'undefined' && window.location.hash}
		<div class="flex flex-1 flex-col items-center justify-center p-6 bg-gray-900 text-gray-500">
			<div class="text-center">
				<div class="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mb-4"></div>
				<p class="text-base font-medium text-gray-300">Loading session...</p>
				<p class="text-xs text-gray-500 mt-1">Retrieving workspace session history</p>
			</div>
		</div>
	{:else if !sessionInfo.sessionFile}
		<div class="flex flex-1 items-center justify-center p-6">
			<div class="w-full max-w-md rounded-lg border border-gray-700 bg-gray-800/40 p-6 text-gray-300">
				<div class="mb-5 text-center">
					<div class="mb-2 text-4xl">📁</div>
					<h3 class="text-lg font-bold text-white">Create a New Session</h3>
					<p class="text-xs text-gray-400 mt-1">Start a coding session in any folder on your machine</p>
				</div>
				
				<form onsubmit={(e) => { e.preventDefault(); handleFormCreateSession(); }} class="space-y-4">
					<div>
						<label class="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1" for="main-folder-path">Folder Path</label>
						<input
							id="main-folder-path"
							type="text"
							placeholder="e.g. ~/projects/my-new-app"
							bind:value={newFolderCwd}
							class="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
						/>
						{#if pathStatus.exists === true}
							<span class="text-xs text-yellow-400 mt-1.5 block font-medium">
								📁 Folder already exists. Joining will create a session in it.
								{#if pathStatus.isGit}
									<span class="text-green-400 font-medium ml-1">(Git repo detected)</span>
								{/if}
							</span>
						{:else}
							<span class="text-[10px] text-gray-500 mt-1 block">Relative paths are created inside your home folder.</span>
						{/if}
					</div>

					<div>
						<label class="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1" for="main-model-select">Model</label>
						{#if modelsData.models.length > 0}
							<select
								id="main-model-select"
								bind:value={newFolderModel}
								class="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
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
								class="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
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
									class="h-4 w-4 rounded border-gray-600 bg-gray-750 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
								/>
								<label for="main-create-remote" class="text-sm text-gray-300 select-none cursor-pointer">
									Create remote {pathStatus.matchingRule.provider} repository
								</label>
							</div>
							
							{#if createRemoteRepo}
								<div class="flex items-center gap-4 pl-6 text-xs text-gray-400">
									<span>Visibility:</span>
									<label class="flex items-center gap-1.5 select-none cursor-pointer hover:text-white transition-colors">
										<input type="radio" name="main-visibility" value="private" bind:group={repoVisibility} class="text-blue-600 bg-gray-700 border-gray-600 focus:ring-blue-500" />
										Private
									</label>
									<label class="flex items-center gap-1.5 select-none cursor-pointer hover:text-white transition-colors">
										<input type="radio" name="main-visibility" value="public" bind:group={repoVisibility} class="text-blue-600 bg-gray-700 border-gray-600 focus:ring-blue-500" />
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
								onchange={(e) => { userManualGitInit = e.currentTarget.checked; }}
								class="h-4 w-4 rounded border-gray-600 bg-gray-750 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
							/>
							<label for="main-git-init" class="text-sm text-gray-300 select-none cursor-pointer">
								Initialize Git repository
							</label>
						</div>
					{/if}

					<button
						type="submit"
						disabled={!newFolderCwd.trim()}
						class="w-full rounded bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						Create & Start Session
					</button>
				</form>
			</div>
		</div>
	{:else if msgList.length === 0}
		<div class="flex flex-1 items-center justify-center text-gray-500">
			<div class="text-center">
				<div class="mb-4 text-4xl">💬</div>
				<p class="mb-2 text-lg font-medium">New Session Started</p>
				<p class="text-sm">
					Type a message below to start chatting with your Pi coding agent
				</p>
			</div>
		</div>
	{:else}
		<div bind:this={messageList} class="flex-1 space-y-4 overflow-y-auto p-4">
			{#each msgList as msg (msg.id)}
				<div
					class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}"
				>
					<div
						class="max-w-[85%] rounded-lg px-4 py-3 {msg.role === 'user'
							? 'bg-blue-600 text-white'
							: msg.role === 'thinking'
								? 'border-l-2 border-gray-600 bg-gray-900/30 text-sm text-gray-400'
								: msg.role === 'tool'
									? `border-l-2 bg-gray-800 font-mono text-sm text-gray-300 ${
											msg.isStreaming
												? 'border-amber-500'
												: msg.isError
													? 'border-rose-500'
													: 'border-emerald-500'
										}`
									: msg.role === 'assistant'
										? 'border-l-2 border-purple-500 bg-purple-900/30 text-purple-100'
										: msg.content === '' && msg.isStreaming
											? 'bg-gray-700 text-gray-400 italic'
											: 'bg-gray-800 text-gray-100'}"
					>
						{#if msg.role === 'thinking'}
							<div class="font-mono text-sm whitespace-pre-wrap">
								{msg.content}
							</div>
						{:else if msg.role === 'tool'}
							{@const parsed = parseToolMessage(msg)}
							<div
								class="flex max-w-full min-w-[280px] flex-col sm:min-w-[400px] md:min-w-[550px]"
							>
								<!-- Header of tool execution -->
								<button
									onclick={() => toggleMessage(msg.id)}
									class="hover:bg-gray-750/30 flex w-full items-center justify-between gap-3 rounded p-1 text-left transition-colors focus:outline-none"
								>
									<div class="flex flex-1 items-center gap-2 overflow-hidden">
										<!-- Status icon -->
										{#if msg.isStreaming}
											<!-- Running -->
											<span
												class="inline-block animate-spin font-bold text-amber-500"
												>⚡</span
											>
										{:else if parsed.isError}
											<!-- Error -->
											<span class="font-bold text-rose-500" title="Failed"
												>❌</span
											>
										{:else}
											<!-- Success -->
											<span class="font-bold text-emerald-500" title="Succeeded"
												>✅</span
											>
										{/if}

										<span class="font-mono text-sm font-bold text-gray-200">
											{parsed.toolName}
										</span>

										{#if parsed.smartTitleArgs}
											<span
												class="max-w-[180px] truncate font-mono text-xs text-gray-400 sm:max-w-[300px] md:max-w-[450px]"
												title={parsed.smartTitleArgs}
											>
												{parsed.smartTitleArgs}
											</span>
										{/if}
									</div>

									<div
										class="flex shrink-0 items-center gap-1 font-sans text-xs font-medium whitespace-nowrap text-gray-400 select-none hover:text-gray-200"
									>
										{#if expandedMessages[msg.id]}
											Collapse <span class="text-[10px]">▲</span>
										{:else}
											Expand <span class="text-[10px]">▼</span>
										{/if}
									</div>
								</button>

								<!-- Tool Output (collapsible) -->
								{#if expandedMessages[msg.id]}
									<div
										class="mt-2 flex flex-col gap-3 overflow-hidden border-t border-gray-700/50 pt-2"
									>
										<!-- Full Arguments section -->
										{#if parsed.fullArgs && parsed.fullArgs !== '{}'}
											<div class="flex flex-col gap-1">
												<span
													class="font-sans text-[10px] font-bold tracking-wider text-gray-500 uppercase"
													>Arguments</span
												>
												<pre
													class="max-h-40 overflow-x-auto rounded border border-gray-700/20 bg-gray-950/40 p-1.5 font-mono text-[11px] whitespace-pre-wrap text-amber-400">{parsed.fullArgs}</pre>
											</div>
										{/if}

										<!-- Tool Output section -->
										<div class="flex flex-col gap-1">
											<span
												class="font-sans text-[10px] font-bold tracking-wider text-gray-500 uppercase"
												>Output</span
											>
											{#if parsed.toolOutput}
												<pre
													class="max-h-96 overflow-x-auto rounded border border-gray-700/30 bg-gray-950/60 p-2 font-mono text-xs whitespace-pre-wrap text-gray-300">{parsed.toolOutput}</pre>
											{:else if msg.isStreaming}
												<div
													class="animate-pulse p-1 text-xs text-gray-500 italic"
												>
													Running and waiting for output...
												</div>
											{:else}
												<div class="p-1 text-xs text-gray-500 italic">
													No output returned
												</div>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						{:else if msg.role === 'assistant' && msg.content !== ''}
							<pre
								class="font-sans text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</pre>
						{:else}
							<div class="text-sm leading-relaxed whitespace-pre-wrap">
								{msg.content || (msg.isStreaming ? 'Thinking...' : '')}
								{#if msg.isStreaming && streaming}
									<span
										class="ml-1 inline-block h-4 w-1.5 animate-pulse bg-blue-400"
									></span>
								{/if}
							</div>
						{/if}
						<div
							class="mt-1 text-xs opacity-50 {msg.role === 'user'
								? 'text-blue-200'
								: msg.role === 'assistant'
									? 'text-purple-300'
									: 'text-gray-400'}"
						>
							{formatTime(msg.timestamp)}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if msgList.length > 0}
		<div class="flex gap-2 border-t border-gray-700 p-2">
			<button
				onclick={() => clearMessages()}
				class="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600"
				title="Clear messages"
			>
				Clear
			</button>
			{#if streaming}
				<button
					onclick={abort}
					class="rounded bg-red-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-700"
					title="Abort"
				>
					Abort
				</button>
			{/if}
		</div>
	{/if}

	<!-- Custom Confirm Modal for Existing Folders -->
	{#if showGitInitConfirmModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true">
			<div class="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-800 p-6 text-gray-300">
				<h3 class="text-base font-bold text-white mb-2">Folder Already Exists</h3>
				<p class="text-sm text-gray-400 mb-4">
					The folder <span class="text-gray-200 font-mono text-xs">{newFolderCwd}</span> already exists. Do you want to initialize a Git repository in it?
				</p>

				<div class="flex flex-col gap-3.5 mb-6">
					<div class="flex items-center gap-2">
						<input
							id="modal-git-init"
							type="checkbox"
							bind:checked={newFolderGitInit}
							disabled={pathStatus.isGit}
							class="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
						/>
						<label for="modal-git-init" class="text-sm text-gray-300 select-none cursor-pointer disabled:opacity-50">
							Initialize Git repository
							{#if pathStatus.isGit}
								<span class="text-xs text-gray-500 ml-1">(already a Git repository)</span>
							{:else}
								<span class="text-xs text-yellow-500 ml-1 font-medium">(folder not empty)</span>
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
									class="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
								/>
								<label for="modal-create-remote" class="text-sm text-gray-300 select-none cursor-pointer">
									Create remote {pathStatus.matchingRule.provider} repository
								</label>
							</div>
							
							{#if createRemoteRepo}
								<div class="flex items-center gap-4 pl-6 text-xs text-gray-400">
									<span>Visibility:</span>
									<label class="flex items-center gap-1.5 select-none cursor-pointer hover:text-white transition-colors">
										<input type="radio" name="modal-visibility" value="private" bind:group={repoVisibility} class="text-blue-600 bg-gray-700 border-gray-600 focus:ring-blue-500" />
										Private
									</label>
									<label class="flex items-center gap-1.5 select-none cursor-pointer hover:text-white transition-colors">
										<input type="radio" name="modal-visibility" value="public" bind:group={repoVisibility} class="text-blue-600 bg-gray-700 border-gray-600 focus:ring-blue-500" />
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
						class="rounded bg-gray-700 px-3.5 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-600"
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
								pathStatus.matchingRule ? repoVisibility : undefined
							);
						}}
						class="rounded bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
					>
						Confirm & Create
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

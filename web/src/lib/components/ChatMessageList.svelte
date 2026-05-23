<script lang="ts">
	import {
		messages,
		isStreaming,
		abort,
		clearMessages,
		activeSessionInfo,
	} from '$lib/pi-remote';
	import type {ChatMessage} from '$lib/pi-remote';
	import {onMount} from 'svelte';

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

<div class="flex flex-1 flex-col overflow-hidden">
	{#if msgList.length === 0}
		<div class="flex flex-1 items-center justify-center text-gray-500">
			<div class="text-center">
				<div class="mb-4 text-4xl">🤖</div>
				<p class="mb-2 text-lg font-medium">Pi Remote Chat</p>
				<p class="text-sm">
					Select a session from the sidebar to start chatting
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
</div>

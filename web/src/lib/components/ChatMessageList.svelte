<script lang="ts">
	import { messages, isStreaming, abort, clearMessages, activeSessionInfo } from '$lib/pi-remote';
	import type { ChatMessage } from '$lib/pi-remote';
	import { onMount } from 'svelte';

	let messageList = $state<HTMLDivElement>();
	let { onMessageSent }: { onMessageSent: () => void } = $props();

	let sessionInfo = $derived($activeSessionInfo);

	let shouldAutoScroll = $state(true);
	let forceScroll = $state(false);

	let expandedMessages = $state<Record<string, boolean>>({});

	function toggleMessage(id: string) {
		expandedMessages[id] = !expandedMessages[id];
	}

	function parseArgsObject(argsStr: string | undefined): Record<string, any> | null {
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
		const regex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+))/g;
		let match;
		while ((match = regex.exec(trimmed)) !== null) {
			const key = match[1];
			const val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);
			obj[key] = val;
		}

		if (Object.keys(obj).length > 0) {
			return obj;
		}

		return null;
	}

	function getSmartTitleArgs(toolName: string, argsObj: Record<string, any> | null, rawArgsStr: string): string {
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
		const commonPath = argsObj.path || argsObj.filepath || argsObj.file || argsObj.name || argsObj.query;
		if (commonPath) {
			return String(commonPath);
		}

		// Default fallback formatting for title
		return Object.entries(argsObj)
			.filter(([k, v]) => v !== undefined && v !== '')
			.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
			.join(' ');
	}

	function getFullArgsFormatted(argsObj: Record<string, any> | null, rawArgsStr: string): string {
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
			const headerLine = firstLineBreak !== -1 ? content.slice(0, firstLineBreak) : content;
			toolOutput = firstLineBreak !== -1 ? content.slice(firstLineBreak + 1) : '';

			let header = headerLine.trim();
			if (header.startsWith('$ ')) {
				header = header.slice(2);
			}

			const firstSpace = header.indexOf(' ');
			toolName = msg.toolName || (firstSpace !== -1 ? header.slice(0, firstSpace) : header) || 'tool';
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
			isError
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
		$messages.length;
		setTimeout(scrollToBottomIfShould, 0);
	});

	let msgList = $derived($messages);
	let streaming = $derived($isStreaming);

	function formatTime(timestamp: number) {
		return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	export function forceScrollToBottom() {
		forceScroll = true;
		setTimeout(scrollToBottom, 0);
	}
</script>

<div class="flex-1 overflow-hidden flex flex-col">
	{#if msgList.length === 0}
		<div class="flex-1 flex items-center justify-center text-gray-500">
			<div class="text-center">
				<div class="text-4xl mb-4">🤖</div>
				<p class="text-lg font-medium mb-2">Pi Remote Chat</p>
				<p class="text-sm">Select a session from the sidebar to start chatting</p>
			</div>
		</div>
	{:else}
		<div
			bind:this={messageList}
			class="flex-1 overflow-y-auto p-4 space-y-4"
		>
			{#each msgList as msg (msg.id)}
				<div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
					<div
						class="max-w-[85%] rounded-lg px-4 py-3 {msg.role === 'user'
							? 'bg-blue-600 text-white'
							: msg.role === 'thinking'
								? 'bg-gray-900/30 text-gray-400 text-sm border-l-2 border-gray-600'
								: msg.role === 'tool'
									? `bg-gray-800 text-gray-300 text-sm border-l-2 font-mono ${
											msg.isStreaming
												? 'border-amber-500'
												: msg.isError
													? 'border-rose-500'
													: 'border-emerald-500'
										}`
									: msg.role === 'assistant'
										? 'bg-purple-900/30 text-purple-100 border-l-2 border-purple-500'
										: msg.content === '' && msg.isStreaming
											? 'bg-gray-700 text-gray-400 italic'
											: 'bg-gray-800 text-gray-100'}"
					>
						{#if msg.role === 'thinking'}
							<div class="text-sm font-mono whitespace-pre-wrap">{msg.content}</div>
						{:else if msg.role === 'tool'}
							{@const parsed = parseToolMessage(msg)}
							<div class="flex flex-col min-w-[280px] sm:min-w-[400px] md:min-w-[550px] max-w-full">
								<!-- Header of tool execution -->
								<button
									onclick={() => toggleMessage(msg.id)}
									class="flex items-center justify-between w-full text-left gap-3 focus:outline-none hover:bg-gray-750/30 p-1 rounded transition-colors"
								>
									<div class="flex items-center gap-2 overflow-hidden flex-1">
										<!-- Status icon -->
										{#if msg.isStreaming}
											<!-- Running -->
											<span class="inline-block animate-spin text-amber-500 font-bold">⚡</span>
										{:else if parsed.isError}
											<!-- Error -->
											<span class="text-rose-500 font-bold" title="Failed">❌</span>
										{:else}
											<!-- Success -->
											<span class="text-emerald-500 font-bold" title="Succeeded">✅</span>
										{/if}

										<span class="font-bold text-gray-200 text-sm font-mono">
											{parsed.toolName}
										</span>

										{#if parsed.smartTitleArgs}
											<span class="text-gray-400 text-xs font-mono truncate max-w-[180px] sm:max-w-[300px] md:max-w-[450px]" title={parsed.smartTitleArgs}>
												{parsed.smartTitleArgs}
											</span>
										{/if}
									</div>

									<div class="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 select-none font-sans font-medium whitespace-nowrap shrink-0">
										{#if expandedMessages[msg.id]}
											Collapse <span class="text-[10px]">▲</span>
										{:else}
											Expand <span class="text-[10px]">▼</span>
										{/if}
									</div>
								</button>

								<!-- Tool Output (collapsible) -->
								{#if expandedMessages[msg.id]}
									<div class="mt-2 border-t border-gray-700/50 pt-2 flex flex-col gap-3 overflow-hidden">
										<!-- Full Arguments section -->
										{#if parsed.fullArgs && parsed.fullArgs !== '{}'}
											<div class="flex flex-col gap-1">
												<span class="text-[10px] font-bold tracking-wider uppercase text-gray-500 font-sans">Arguments</span>
												<pre class="overflow-x-auto text-[11px] whitespace-pre-wrap text-amber-400 font-mono bg-gray-950/40 p-1.5 rounded border border-gray-700/20 max-h-40">{parsed.fullArgs}</pre>
											</div>
										{/if}

										<!-- Tool Output section -->
										<div class="flex flex-col gap-1">
											<span class="text-[10px] font-bold tracking-wider uppercase text-gray-500 font-sans">Output</span>
											{#if parsed.toolOutput}
												<pre class="overflow-x-auto text-xs whitespace-pre-wrap max-h-96 text-gray-300 font-mono bg-gray-950/60 p-2 rounded border border-gray-700/30">{parsed.toolOutput}</pre>
											{:else if msg.isStreaming}
												<div class="text-xs text-gray-500 italic animate-pulse p-1">Running and waiting for output...</div>
											{:else}
												<div class="text-xs text-gray-500 italic p-1">No output returned</div>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						{:else if msg.role === 'assistant' && msg.content !== ''}
							<pre class="text-sm leading-relaxed whitespace-pre-wrap font-sans">{msg.content}</pre>
						{:else}
							<div class="text-sm whitespace-pre-wrap leading-relaxed">
								{msg.content || (msg.isStreaming ? 'Thinking...' : '')}
								{#if msg.isStreaming && streaming}
									<span class="inline-block w-1.5 h-4 bg-blue-400 ml-1 animate-pulse"></span>
								{/if}
							</div>
						{/if}
						<div class="text-xs mt-1 opacity-50 {msg.role === 'user' ? 'text-blue-200' : msg.role === 'assistant' ? 'text-purple-300' : 'text-gray-400'}">
							{formatTime(msg.timestamp)}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

 {#if msgList.length > 0}
		<div class="flex gap-2 p-2 border-t border-gray-700">
			<button
				onclick={() => clearMessages()}
				class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
				title="Clear messages"
			>
				Clear
			</button>
			{#if streaming}
				<button
					onclick={abort}
					class="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
					title="Abort"
				>
					Abort
				</button>
			{/if}
		</div>
	{/if}
</div>

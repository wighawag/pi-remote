<script lang="ts">
	import { messages, isStreaming, abort, clearMessages, activeSessionInfo } from '$lib/pi-remote';
	import { onMount } from 'svelte';

	let messageList = $state<HTMLDivElement>();
	let { onMessageSent }: { onMessageSent: () => void } = $props();

	let sessionInfo = $derived($activeSessionInfo);

	let shouldAutoScroll = $state(true);
	let forceScroll = $state(false);

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
				messageList.removeEventListener('scroll', handleScroll);
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
								? 'bg-purple-900/30 text-purple-300 text-sm border-l-2 border-purple-500'
								: msg.role === 'tool'
									? 'bg-gray-800 text-gray-300 text-sm border-l-2 border-yellow-500 font-mono'
									: msg.content === '' && msg.isStreaming
										? 'bg-gray-700 text-gray-400 italic'
										: 'bg-gray-800 text-gray-100'}"
					>
						{#if msg.role === 'thinking'}
							<div class="text-sm font-mono whitespace-pre-wrap">{msg.content}</div>
						{:else if msg.role === 'tool'}
							<div class="text-sm font-mono whitespace-pre-wrap">{msg.content}</div>
						{:else if msg.role === 'assistant' && msg.content !== ''}
							<pre class="text-sm leading-relaxed whitespace-pre-wrap font-sans">{msg.content}</pre>
						{:else}
							<div class="text-sm">
								{msg.content || (msg.isStreaming ? 'Thinking...' : '')}
								{#if msg.isStreaming && streaming}
									<span class="inline-block w-1.5 h-4 bg-blue-400 ml-1 animate-pulse"></span>
								{/if}
							</div>
						{/if}
						<div class="text-xs mt-1 opacity-50 {msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}">
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

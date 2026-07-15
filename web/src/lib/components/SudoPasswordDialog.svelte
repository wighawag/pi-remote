<script lang="ts">
	import {sudoPrompt, sendSudoPassword, cancelSudoPrompt} from '$lib/wherever';

	let prompt = $derived($sudoPrompt);

	// Local, transient password buffer. It lives only in this component for as
	// long as the dialog is open, is handed straight to the socket on submit, and
	// is wiped immediately after. It is never written to the store or persisted.
	let password = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	// Autofocus the field and clear any stale buffer each time a new prompt
	// appears. Keyed on promptId so a fresh prompt (new command) always resets.
	let lastPromptId = $state<string | null>(null);
	$effect(() => {
		const id = prompt?.promptId ?? null;
		if (id !== lastPromptId) {
			lastPromptId = id;
			password = '';
			if (id) {
				// Defer so the input is mounted before focusing.
				queueMicrotask(() => inputEl?.focus());
			}
		}
	});

	function submit() {
		if (!prompt) return;
		sendSudoPassword(password);
		password = '';
	}

	function cancel() {
		cancelSudoPrompt();
		password = '';
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		}
	}
</script>

{#if prompt}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark/60"
	>
		<div
			class="mx-4 w-full max-w-md rounded-xl border border-brand-border bg-brand-surface-2 p-6 shadow-xl"
		>
			<h2 class="mb-2 text-lg font-bold text-brand-text">Sudo password</h2>
			<p class="mb-3 text-sm text-brand-text-muted">
				This command needs your sudo password to run. It is used once and never
				stored.
			</p>
			<pre
				class="mb-4 overflow-x-auto rounded-lg bg-brand-surface-3 px-3 py-2 font-mono text-xs text-brand-text">{prompt.command}</pre>

			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:this={inputEl}
				bind:value={password}
				onkeydown={onKeydown}
				type="password"
				autocomplete="off"
				autocapitalize="off"
				autocorrect="off"
				spellcheck="false"
				placeholder="Password"
				class="mb-4 w-full rounded-lg border border-brand-border bg-brand-surface-3 px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-blue"
			/>

			<div class="flex gap-3">
				<button
					onclick={cancel}
					class="flex-1 rounded-lg bg-brand-surface-3 px-4 py-2.5 text-sm text-brand-text transition-colors hover:bg-brand-surface-2"
				>
					Cancel
				</button>
				<button
					onclick={submit}
					class="flex-1 rounded-lg bg-brand-blue px-4 py-2.5 text-sm text-brand-text transition-colors hover:opacity-90"
				>
					Run
				</button>
			</div>
		</div>
	</div>
{/if}

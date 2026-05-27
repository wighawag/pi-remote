<script lang="ts">
	import {conflict, resolveConflict} from '$lib/wherever';

	let c = $derived($conflict);
</script>

{#if c}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark/60"
	>
		<div
			class="mx-4 w-full max-w-md rounded-xl border border-brand-border bg-brand-surface-2 p-6 shadow-xl"
		>
			<h2 class="mb-2 text-lg font-bold text-brand-text">Session Conflict</h2>
			<p class="mb-6 text-sm text-brand-text-muted">
				Another client is active on a session in folder <span
					class="font-mono text-xs text-brand-text">{c.conflictingCwd}</span
				>. What would you like to do?
			</p>

			<div class="flex gap-3">
				<button
					onclick={() => resolveConflict('read_only')}
					class="flex-1 rounded-lg bg-brand-surface-3 px-4 py-2.5 text-sm text-brand-text transition-colors hover:bg-brand-surface-2"
				>
					Read Only
				</button>
				<button
					onclick={() => resolveConflict('take_over')}
					class="flex-1 rounded-lg bg-rose-500 px-4 py-2.5 text-sm text-brand-text transition-colors hover:bg-rose-600"
				>
					Take Over
				</button>
			</div>

			<p class="mt-4 text-xs text-brand-text-muted">
				<strong class="text-brand-text">Read Only:</strong> Observe the session
				live but cannot send messages.<br />
				<strong class="text-brand-text">Take Over:</strong> Interrupt the other client
				and gain control.
			</p>
		</div>
	</div>
{/if}

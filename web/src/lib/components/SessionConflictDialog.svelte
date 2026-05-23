<script lang="ts">
	import {conflict, resolveConflict} from '$lib/pi-remote';

	let c = $derived($conflict);
</script>

{#if c}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
		<div
			class="mx-4 w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-xl"
		>
			<h2 class="mb-2 text-lg font-bold text-white">Session Conflict</h2>
			<p class="mb-6 text-sm text-gray-400">
				Another client is active on a session in folder <span
					class="font-mono text-gray-300">{c.conflictingCwd}</span
				>. What would you like to do?
			</p>

			<div class="flex gap-3">
				<button
					onclick={() => resolveConflict('read_only')}
					class="flex-1 rounded-lg bg-gray-700 px-4 py-2.5 text-sm text-white transition-colors hover:bg-gray-600"
				>
					Read Only
				</button>
				<button
					onclick={() => resolveConflict('take_over')}
					class="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm text-white transition-colors hover:bg-red-700"
				>
					Take Over
				</button>
			</div>

			<p class="mt-4 text-xs text-gray-500">
				<strong>Read Only:</strong> Observe the session live but cannot send
				messages.<br />
				<strong>Take Over:</strong> Interrupt the other client and gain control.
			</p>
		</div>
	</div>
{/if}

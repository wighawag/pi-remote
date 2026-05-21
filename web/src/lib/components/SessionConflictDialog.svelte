<script lang="ts">
  import { conflict, resolveConflict } from '$lib/pi-remote';

  let c = $derived($conflict);
</script>

{#if c}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
    <div class="bg-gray-800 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
      <h2 class="text-lg font-bold text-white mb-2">Session Conflict</h2>
      <p class="text-sm text-gray-400 mb-6">
        Another client is active on a session in folder <span class="text-gray-300 font-mono">{c.conflictingCwd}</span>.
        What would you like to do?
      </p>

      <div class="flex gap-3">
        <button
          onclick={() => resolveConflict('read_only')}
          class="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2.5 px-4 rounded-lg transition-colors"
        >
          Read Only
        </button>
        <button
          onclick={() => resolveConflict('take_over')}
          class="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2.5 px-4 rounded-lg transition-colors"
        >
          Take Over
        </button>
      </div>

      <p class="text-xs text-gray-500 mt-4">
        <strong>Read Only:</strong> Observe the session live but cannot send messages.<br />
        <strong>Take Over:</strong> Interrupt the other client and gain control.
      </p>
    </div>
  </div>
{/if}

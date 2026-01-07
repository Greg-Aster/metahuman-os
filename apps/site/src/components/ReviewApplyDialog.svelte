<script lang="ts">
  export let reviewData: any;
  export let onApply: (strategy: 'replace' | 'merge' | 'append') => void;
  export let onDiscard: () => void;

  let selectedStrategy: 'replace' | 'merge' | 'append' = 'merge';
  let showTranscript = false;
  let showFullDiff = false;

  const strategyDescriptions = {
    replace: 'Completely replace existing persona with new data',
    merge: 'Intelligently merge new data with existing (recommended)',
    append: 'Add new data alongside existing without removing anything',
  };

  function formatValue(value: any): string {
    if (value === undefined || value === null) {
      return '(empty)';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }
</script>

<div class="fixed inset-0 bg-black/75 flex items-center justify-center z-[1000] p-8" on:click={onDiscard}>
  <div class="bg-gray-800 rounded-lg max-w-[900px] w-full max-h-[90vh] flex flex-col text-gray-200" on:click|stopPropagation>
    <div class="p-6 border-b border-gray-700 flex justify-between items-center">
      <h2 class="m-0 text-gray-50">Review Persona Changes</h2>
      <button class="bg-transparent border-none text-gray-400 text-[2rem] cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 hover:text-gray-50" on:click={onDiscard}>×</button>
    </div>

    <div class="p-6 overflow-y-auto flex-1">
      <!-- Summary Stats -->
      <div class="flex gap-4 mb-6">
        <div class="flex-1 bg-gray-900 p-4 rounded-md text-center">
          <span class="block text-xs text-gray-400 mb-2 uppercase tracking-wide">Additions</span>
          <span class="block text-2xl font-bold text-emerald-500">{reviewData.diff.summary.additions}</span>
        </div>
        <div class="flex-1 bg-gray-900 p-4 rounded-md text-center">
          <span class="block text-xs text-gray-400 mb-2 uppercase tracking-wide">Updates</span>
          <span class="block text-2xl font-bold text-blue-500">{reviewData.diff.summary.updates}</span>
        </div>
        <div class="flex-1 bg-gray-900 p-4 rounded-md text-center">
          <span class="block text-xs text-gray-400 mb-2 uppercase tracking-wide">Confidence</span>
          <span class="block text-2xl font-bold text-gray-50">{Math.round(reviewData.confidence * 100)}%</span>
        </div>
      </div>

      <!-- Diff Preview -->
      <div class="mb-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="m-0 text-gray-50 text-base">Changes Preview</h3>
          <button class="px-4 py-2 bg-gray-700 text-gray-200 border-none rounded-md cursor-pointer text-[0.85rem] hover:bg-gray-600" on:click={() => (showFullDiff = !showFullDiff)}>
            {showFullDiff ? 'Show Summary' : 'Show Full Diff'}
          </button>
        </div>

        {#if showFullDiff}
          <div class="bg-gray-900 rounded-md p-4 overflow-x-auto">
            <pre class="m-0 font-mono text-[0.85rem] leading-relaxed text-gray-200">{reviewData.diff.text}</pre>
          </div>
        {:else}
          <div class="flex flex-col gap-3">
            {#each reviewData.diff.changes.slice(0, 5) as change}
              {#if change.action !== 'no-change'}
                <div class="bg-gray-900 border-l-[3px] p-4 rounded-md {change.action === 'add' ? 'border-l-emerald-500' : change.action === 'update' ? 'border-l-blue-500' : 'border-l-red-500'}">
                  <div class="font-semibold text-gray-50 mb-2">{change.field}</div>
                  <div class="inline-block px-2 py-1 bg-gray-700 rounded text-xs font-semibold mb-3">{change.action.toUpperCase()}</div>
                  {#if change.action === 'add'}
                    <div class="mb-2 text-[0.9rem]">
                      <span class="text-gray-400 mr-2">New:</span>
                      <span class="text-gray-200 font-mono">{formatValue(change.newValue)}</span>
                    </div>
                  {:else if change.action === 'update'}
                    <div class="mb-2 text-[0.9rem]">
                      <span class="text-gray-400 mr-2">Old:</span>
                      <span class="text-gray-200 font-mono">{formatValue(change.oldValue)}</span>
                    </div>
                    <div class="mb-2 text-[0.9rem]">
                      <span class="text-gray-400 mr-2">New:</span>
                      <span class="text-gray-200 font-mono">{formatValue(change.newValue)}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
            {#if reviewData.diff.changes.length > 5}
              <div class="text-center text-gray-400 text-[0.85rem] italic p-2">
                + {reviewData.diff.changes.length - 5} more changes
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Merge Strategy Selector -->
      <div class="mb-6">
        <h3 class="m-0 mb-4 text-gray-50 text-base">Merge Strategy</h3>
        <div class="flex flex-col gap-3">
          {#each Object.entries(strategyDescriptions) as [strategy, description]}
            <label class="flex items-start gap-3 p-4 bg-gray-900 rounded-md cursor-pointer border-2 border-transparent transition-all hover:bg-gray-800 hover:border-gray-700 has-[input:checked]:border-blue-500 has-[input:checked]:bg-blue-900">
              <input
                type="radio"
                name="strategy"
                value={strategy}
                bind:group={selectedStrategy}
                class="mt-1 cursor-pointer"
              />
              <div class="flex flex-col gap-1">
                <span class="font-semibold text-gray-50 capitalize">{strategy}</span>
                <span class="text-[0.85rem] text-gray-400">{description}</span>
              </div>
            </label>
          {/each}
        </div>
      </div>

      <!-- Optional: Transcript View -->
      <div class="mb-6">
        <button class="px-4 py-2 bg-gray-700 text-gray-200 border-none rounded-md cursor-pointer text-[0.85rem] hover:bg-gray-600" on:click={() => (showTranscript = !showTranscript)}>
          {showTranscript ? 'Hide' : 'View'} Full Transcript
        </button>

        {#if showTranscript}
          <div class="mt-4">
            <p class="m-0 mb-3 text-gray-400 text-[0.85rem] italic">
              Interview transcript (not included in persona data)
            </p>
            <div class="bg-gray-900 rounded-md p-4 max-h-[400px] overflow-y-auto">
              {#if reviewData.extracted}
                <pre class="m-0 font-mono text-[0.85rem] leading-relaxed text-gray-200">{JSON.stringify(reviewData.extracted, null, 2)}</pre>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="p-6 border-t border-gray-700 flex gap-4 justify-end">
      <button class="px-6 py-3 rounded-md border-none text-[0.95rem] cursor-pointer transition-all bg-gray-700 text-gray-200 hover:bg-gray-600" on:click={onDiscard}>
        Cancel
      </button>
      <button class="px-6 py-3 rounded-md border-none text-[0.95rem] cursor-pointer transition-all bg-blue-500 text-white hover:bg-blue-600" on:click={() => onApply(selectedStrategy)}>
        Apply Changes ({selectedStrategy})
      </button>
    </div>
  </div>
</div>

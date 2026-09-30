<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { parseTrainingDataSettings, TRAINING_MEMORY_TYPES, type TrainingDataSettings, type TrainingObjective } from '@metahuman/core/training-schema';

  export let settings: TrainingDataSettings = parseTrainingDataSettings();
  export let disabled = false;
  const dispatch = createEventDispatcher<{ settingsChange: TrainingDataSettings }>();
  $: visibleTypes = settings.objective === 'human-continuation' ? ['conversation'] : [...TRAINING_MEMORY_TYPES];

  function update(change: Partial<TrainingDataSettings>) {
    dispatch('settingsChange', { ...settings, ...change });
  }
  function weight(type: string, event: Event) {
    update({ memoryTypes: { percentages: {
      ...settings.memoryTypes.percentages, [type]: Number((event.target as HTMLInputElement).value),
    } } });
  }
</script>

<fieldset {disabled} class="p-4 rounded-lg border border-gray-700 space-y-5 disabled:opacity-60">
  <label class="block text-sm">
    <span class="block font-semibold mb-2">Training target</span>
    <select class="w-full p-2 rounded border border-gray-600 bg-white dark:bg-gray-900"
      value={settings.objective}
      on:change={(event) => update({ objective: (event.target as HTMLSelectElement).value as TrainingObjective })}>
      <option value="human-continuation">My next reply</option>
      <option value="assistant-continuation">Persona / assistant reply</option>
    </select>
  </label>
  <p class="text-sm text-gray-500">
    {#if settings.objective === 'human-continuation'}
      Learns your reply after an earlier assistant message in the same conversation.
      Both sides must have a current review and a verified message order.
    {:else}
      Learns the persona's reply to its preceding prompt. Recorded conversations and generated examples keep separate provenance.
    {/if}
  </p>
  <label class="flex items-center justify-between gap-4 text-sm">
    <span><strong>Use my persona as context</strong><span class="block text-xs text-gray-500 mt-1">Includes the saved persona with every example.</span></span>
    <input type="checkbox" checked={settings.includePersona}
      on:change={(event) => update({ includePersona: (event.target as HTMLInputElement).checked })} />
  </label>
  {#if settings.objective === 'assistant-continuation'}
    <label class="block text-sm">
      <span class="font-semibold">Generated examples limit: {settings.maxSyntheticPercent}%</span>
      <input class="w-full" type="range" min="0" max="50" step="1" value={settings.maxSyntheticPercent}
        on:change={(event) => update({ maxSyntheticPercent: Number((event.target as HTMLInputElement).value) })} />
      <span class="block text-xs text-gray-500">Caps examples synthesized from memories. Recorded exchanges are required; zero excludes generated examples.</span>
    </label>
  {/if}
  <div>
    <p class="text-sm font-semibold mb-1">Source weights</p>
    <p class="text-xs text-gray-500 mb-3">Relative shares when the sample budget is limited. Zero excludes a source. Weights apply to eligible, reviewed examples.</p>
    <div class="space-y-3">
      {#each visibleTypes as type}
        <label class="block text-sm">
          <span class="flex justify-between"><span class="capitalize">{type.replaceAll('_', ' ')}</span><span>{settings.memoryTypes.percentages[type] ?? 0}</span></span>
          <input class="w-full" type="range" min="0" max="100" step="1"
            value={settings.memoryTypes.percentages[type] ?? 0} on:change={(event) => weight(type, event)} />
        </label>
      {/each}
    </div>
  </div>
  <details class="border-t border-gray-700 pt-3">
    <summary class="cursor-pointer text-sm font-semibold">Evaluation and repeatability</summary>
    <div class="mt-3 space-y-3">
      <label class="block text-sm">
        <span class="block mb-1">Sessions reserved for evaluation (%)</span>
        <input class="p-2 rounded border border-gray-600 bg-white dark:bg-gray-900" type="number" min="5" max="30" step="1"
          value={settings.evaluationPercent}
          on:change={(event) => update({ evaluationPercent: Number((event.target as HTMLInputElement).value) })} />
      </label>
      <label class="block text-sm">
        <span class="block mb-1">Selection seed</span>
        <input class="w-full p-2 rounded border border-gray-600 bg-white dark:bg-gray-900" maxlength="80" value={settings.seed}
          on:change={(event) => update({ seed: (event.target as HTMLInputElement).value })} />
      </label>
      <p class="text-xs text-gray-500">Keep this seed unchanged to retain the same session split between training and evaluation.</p>
    </div>
  </details>
  <button type="button" class="px-3 py-2 rounded border border-gray-600 text-sm"
    on:click={() => dispatch('settingsChange', parseTrainingDataSettings())}>Reset data settings</button>
</fieldset>

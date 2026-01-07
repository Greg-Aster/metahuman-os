<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  // Props
  export let includePersona: boolean = true;
  export let percentages: Record<string, number> = {};
  export let disabled: boolean = false;

  // Memory type categories for grouping in UI
  // PRIMARY types are 100% included (user voice - most valuable)
  // SECONDARY types are added as a % OF the primary data (LLM-generated supplement)
  const memoryTypeGroups = {
    'Primary Data (100% Included)': [
      { key: 'conversation', label: 'Conversations', description: 'Direct chat messages - YOUR voice', isPrimary: true },
      { key: 'observation', label: 'Observations', description: 'User-captured notes and ingested content', isPrimary: true },
      { key: 'therapy_session', label: 'Therapy Sessions', description: 'In-depth personality Q&A sessions', isPrimary: true },
      { key: 'journal', label: 'Journal', description: 'Journal entries - YOUR writing', isPrimary: true },
    ],
    'Secondary Data (% of Primary)': [
      { key: 'reflection', label: 'Reflections', description: 'AI-generated insights (% of primary data)' },
      { key: 'reflection_summary', label: 'Reflection Summaries', description: 'Condensed reflection themes' },
      { key: 'inner_dialogue', label: 'Inner Dialogue', description: 'Internal thought processes' },
      { key: 'dream', label: 'Dreams', description: 'Dream narratives and symbols' },
      { key: 'curiosity_question', label: 'Curiosity Q&A', description: 'Self-directed questions and answers' },
    ],
    'Other Secondary': [
      { key: 'decision', label: 'Decisions', description: 'Decision-making records' },
      { key: 'summary', label: 'Summaries', description: 'Generated summaries (usually 0%)' },
    ],
  };

  // Default percentages (favoring user input)
  const defaultPercentages: Record<string, number> = {
    conversation: 40,
    observation: 25,
    therapy_session: 15,
    reflection: 5,
    reflection_summary: 3,
    inner_dialogue: 3,
    dream: 3,
    curiosity_question: 3,
    decision: 2,
    journal: 1,
    summary: 0,
  };

  // Initialize percentages with defaults if missing
  $: mergedPercentages = {
    ...defaultPercentages,
    ...percentages,
  };

  // Note: With new "pie chart" logic, percentages for secondary types mean
  // "% of primary data to include", not a slice of total. No 100% validation needed.
  $: totalPercentage = Object.values(mergedPercentages).reduce((sum, val) => sum + val, 0);
  $: isValid = true; // No longer need 100% total - secondary % are relative to primary

  // Handle slider change
  function handleSliderChange(key: string, event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseInt(target.value, 10);
    const newPercentages = { ...mergedPercentages, [key]: value };
    dispatch('percentagesChange', newPercentages);
  }

  // Handle persona toggle
  function handlePersonaChange(event: Event) {
    const target = event.target as HTMLInputElement;
    dispatch('personaChange', target.checked);
  }

  // Reset to defaults
  function resetToDefaults() {
    dispatch('percentagesChange', { ...defaultPercentages });
  }

  // Preset configurations
  function applyPreset(preset: 'balanced' | 'user-focused' | 'self-growth') {
    let newPercentages: Record<string, number>;

    switch (preset) {
      case 'balanced':
        newPercentages = { ...defaultPercentages };
        break;
      case 'user-focused':
        newPercentages = {
          conversation: 50,
          observation: 30,
          therapy_session: 15,
          reflection: 2,
          reflection_summary: 1,
          inner_dialogue: 1,
          dream: 0,
          curiosity_question: 1,
          decision: 0,
          journal: 0,
          summary: 0,
        };
        break;
      case 'self-growth':
        newPercentages = {
          conversation: 25,
          observation: 15,
          therapy_session: 10,
          reflection: 15,
          reflection_summary: 8,
          inner_dialogue: 10,
          dream: 8,
          curiosity_question: 5,
          decision: 2,
          journal: 2,
          summary: 0,
        };
        break;
      default:
        return;
    }

    dispatch('percentagesChange', newPercentages);
  }
</script>

<div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 {disabled ? 'opacity-60 pointer-events-none' : ''}">
  <!-- Persona Toggle -->
  <div class="mb-6">
    <label class="flex justify-between items-center p-3 bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700 cursor-pointer">
      <span class="flex flex-col gap-1">
        <strong class="text-sm">Include Persona Data</strong>
        <span class="text-xs text-gray-500">Include core personality traits and values in training</span>
      </span>
      <input
        type="checkbox"
        checked={includePersona}
        on:change={handlePersonaChange}
        {disabled}
        class="w-5 h-5 cursor-pointer"
      />
    </label>
  </div>

  <!-- Presets -->
  <div class="mb-6">
    <h4 class="m-0 mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Quick Presets</h4>
    <div class="flex flex-wrap gap-2">
      <button
        class="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md text-sm cursor-pointer transition-all text-gray-700 dark:text-gray-300 hover:enabled:bg-blue-500 hover:enabled:text-white hover:enabled:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        on:click={() => applyPreset('balanced')}
        {disabled}
        title="Default balanced mix: conversations 40%, observations 25%, therapy 15%, self-generated lower"
      >
        Balanced (Default)
      </button>
      <button
        class="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md text-sm cursor-pointer transition-all text-gray-700 dark:text-gray-300 hover:enabled:bg-blue-500 hover:enabled:text-white hover:enabled:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        on:click={() => applyPreset('user-focused')}
        {disabled}
        title="Focus on user input: conversations 50%, observations 30%, minimal self-generated content"
      >
        User-Focused
      </button>
      <button
        class="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md text-sm cursor-pointer transition-all text-gray-700 dark:text-gray-300 hover:enabled:bg-blue-500 hover:enabled:text-white hover:enabled:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        on:click={() => applyPreset('self-growth')}
        {disabled}
        title="Increase self-generated content: reflections 15%, inner dialogue 10%, dreams 8%"
      >
        Self-Growth
      </button>
    </div>
  </div>

  <!-- Memory Type Sliders -->
  <div class="mb-0">
    <div class="flex justify-between items-center mb-2">
      <h4 class="m-0 text-sm font-semibold text-gray-700 dark:text-gray-300">Memory Type Weights</h4>
      <span class="text-[0.7rem] font-semibold px-2 py-1 bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 rounded">
        Primary = 100% | Secondary = % of primary
      </span>
    </div>

    {#each Object.entries(memoryTypeGroups) as [groupName, types]}
      <div class="p-3 bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700 mb-3">
        <h5 class="m-0 mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wide">{groupName}</h5>
        {#each types as type, i}
          <div class="{i < types.length - 1 ? 'mb-3' : ''}">
            <div class="flex justify-between items-center mb-1">
              <span class="text-sm font-medium">{type.label}</span>
              <span class="text-sm font-semibold text-blue-500 dark:text-blue-400 min-w-[3rem] text-right">{mergedPercentages[type.key]}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={mergedPercentages[type.key]}
              on:input={(e) => handleSliderChange(type.key, e)}
              {disabled}
              class="slider w-full h-1.5 rounded bg-gray-200 dark:bg-gray-700 appearance-none cursor-pointer"
            />
            <span class="text-[0.7rem] text-gray-500 dark:text-gray-400 block mt-1">{type.description}</span>
          </div>
        {/each}
      </div>
    {/each}

    <button
      class="mt-4 px-4 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 cursor-pointer transition-all hover:enabled:bg-gray-200 dark:hover:enabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
      on:click={resetToDefaults}
      {disabled}
    >
      Reset to Defaults
    </button>
  </div>

  <!-- Info Box -->
  <div class="mt-4 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-500 rounded-md text-[0.8rem] text-blue-800 dark:text-blue-200 leading-relaxed">
    <strong class="block mb-1">How it works (Pie Chart Model):</strong>
    <em>Primary data</em> (conversations, observations, journals) = <strong>100% included</strong> — this is YOUR voice.
    <br/>
    <em>Secondary data</em> (reflections, dreams, etc.) = added as a <strong>% of primary</strong>.
    <br/><br/>
    <strong class="block mt-2 mb-1">Example:</strong> If you have 800 conversations + observations, and inner_dialogue is set to 3%,
    you get 800 + (800 × 3% = 24) = 824 total samples.
    <br/><br/>
    <strong class="block mt-2 mb-1">Tip:</strong> Ingest more of your writing (notes, journals, blog posts) to increase primary data.
    The more primary data you have, the more supplemental data gets included proportionally.
  </div>
</div>

<style>
  /* Slider thumb styling - can't be done with Tailwind */
  .slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    transition: transform 0.1s;
  }

  .slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }

  .slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: none;
  }
</style>

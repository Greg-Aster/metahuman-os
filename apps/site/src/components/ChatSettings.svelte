<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  let config: any = null;
  let settings: any = null;
  let scope: any = null;
  let loading = true;
  let saving = false;
  let applyingPreset = false;

  // Local state for sliders
  let contextInfluence = 0.5;
  let historyInfluence = 0.6;
  let facetInfluence = 0.7;
  let temperature = 0.6;
  let semanticSearchThreshold = 0.62;
  let maxContextChars = 900;
  let maxHistoryMessages = 30;
  let userInputPriority = true;
  let innerDialogHistoryLimit = 80;
  let innerDialogHistoryDays = 7;
  let unifiedConsciousness = false;

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    try {
      loading = true;
      const res = await apiFetch('/api/chat-settings');
      if (res.ok) {
        const data = await res.json();
        config = data.config;
        settings = data.settings;
        scope = data.scope;

        // Update local state
        contextInfluence = settings.contextInfluence;
        historyInfluence = settings.historyInfluence;
        facetInfluence = settings.facetInfluence;
        temperature = settings.temperature;
        semanticSearchThreshold = settings.semanticSearchThreshold;
        maxContextChars = settings.maxContextChars;
        maxHistoryMessages = settings.maxHistoryMessages;
        userInputPriority = settings.userInputPriority;
        innerDialogHistoryLimit = settings.innerDialogHistoryLimit ?? 80;
        innerDialogHistoryDays = settings.innerDialogHistoryDays ?? 7;
        unifiedConsciousness = settings.unifiedConsciousness ?? false;
      }
    } catch (error) {
      console.error('Failed to load chat settings:', error);
    } finally {
      loading = false;
    }
  }

  async function saveSettings() {
    try {
      saving = true;
      const updates = {
        contextInfluence,
        historyInfluence,
        facetInfluence,
        temperature,
        semanticSearchThreshold,
        maxContextChars,
        maxHistoryMessages,
        userInputPriority,
        innerDialogHistoryLimit,
        innerDialogHistoryDays,
        unifiedConsciousness,
      };

      const res = await apiFetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });

      if (res.ok) {
        await loadSettings();
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      saving = false;
    }
  }

  async function applyPreset(presetName: string) {
    try {
      applyingPreset = true;
      const res = await apiFetch('/api/chat-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: presetName }),
      });

      if (res.ok) {
        await loadSettings();
      }
    } catch (error) {
      console.error('Failed to apply preset:', error);
    } finally {
      applyingPreset = false;
    }
  }
</script>

<div class="p-4 text-gray-200">
  <h3 class="m-0 mb-4 text-xl text-white">Chat Behavior Settings</h3>

  {#if loading}
    <p class="text-gray-500 text-sm italic">Loading settings...</p>
  {:else}
    <div class="bg-white/5 rounded-md p-3 mb-4">
      <p class="my-1 text-sm">
        <strong>Scope:</strong> {scope?.scope === 'user' ? 'User-specific' : 'Global'}
        {#if scope?.hasUserOverride}
          <span class="bg-purple-500 text-white py-0.5 px-2 rounded-full text-xs ml-2">Custom</span>
        {/if}
      </p>
      <p class="text-gray-500 text-sm my-1">
        {scope?.scope === 'user'
          ? 'Your personal chat settings (overrides global defaults)'
          : 'Global settings (applies to all users without custom settings)'}
      </p>
    </div>

    <!-- Presets -->
    <div class="mb-6">
      <h4 class="mt-6 mb-3 text-base text-gray-300">Quick Presets</h4>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        <button
          class="preset-btn"
          on:click={() => applyPreset('focused')}
          disabled={applyingPreset}
        >
          🎯 Focused
          <span class="text-xs text-gray-500">Prioritize current question</span>
        </button>
        <button
          class="preset-btn"
          on:click={() => applyPreset('balanced')}
          disabled={applyingPreset}
        >
          ⚖️ Balanced
          <span class="text-xs text-gray-500">Equal context & responsiveness</span>
        </button>
        <button
          class="preset-btn"
          on:click={() => applyPreset('immersive')}
          disabled={applyingPreset}
        >
          🌊 Immersive
          <span class="text-xs text-gray-500">Deep context awareness</span>
        </button>
        <button
          class="preset-btn"
          on:click={() => applyPreset('minimal')}
          disabled={applyingPreset}
        >
          ✨ Minimal
          <span class="text-xs text-gray-500">Clean, direct responses</span>
        </button>
      </div>
    </div>

    <!-- Custom Settings -->
    <div>
      <h4 class="mt-6 mb-3 text-base text-gray-300">Custom Settings</h4>

      <!-- Context Influence -->
      <div class="setting-group">
        <label class="block mb-2 text-sm font-medium">
          Context Influence: {contextInfluence.toFixed(1)}
          <span class="block text-xs text-gray-500 font-normal mt-0.5">How much weight to give memory context</span>
        </label>
        <input type="range" min="0" max="1" step="0.1" bind:value={contextInfluence} on:change={saveSettings} class="range-slider" />
      </div>

      <!-- History Influence -->
      <div class="setting-group">
        <label class="block mb-2 text-sm font-medium">
          History Influence: {historyInfluence.toFixed(1)}
          <span class="block text-xs text-gray-500 font-normal mt-0.5">How much weight to give conversation history</span>
        </label>
        <input type="range" min="0" max="1" step="0.1" bind:value={historyInfluence} on:change={saveSettings} class="range-slider" />
      </div>

      <!-- Facet Influence -->
      <div class="setting-group">
        <label class="block mb-2 text-sm font-medium">
          Facet Influence: {facetInfluence.toFixed(1)}
          <span class="block text-xs text-gray-500 font-normal mt-0.5">How strongly to apply persona facet traits</span>
        </label>
        <input type="range" min="0" max="1" step="0.1" bind:value={facetInfluence} on:change={saveSettings} class="range-slider" />
      </div>

      <!-- Temperature -->
      <div class="setting-group">
        <label class="block mb-2 text-sm font-medium">
          Temperature: {temperature.toFixed(2)}
          <span class="block text-xs text-gray-500 font-normal mt-0.5">Model creativity (0 = deterministic, 1 = very creative)</span>
        </label>
        <input type="range" min="0" max="1" step="0.05" bind:value={temperature} on:change={saveSettings} class="range-slider" />
      </div>

      <!-- Semantic Search Threshold -->
      <div class="setting-group">
        <label class="block mb-2 text-sm font-medium">
          Memory Relevance: {semanticSearchThreshold.toFixed(2)}
          <span class="block text-xs text-gray-500 font-normal mt-0.5">Minimum similarity for memory retrieval</span>
        </label>
        <input type="range" min="0" max="1" step="0.05" bind:value={semanticSearchThreshold} on:change={saveSettings} class="range-slider" />
      </div>

      <!-- Max Context Chars -->
      <div class="setting-group">
        <label class="block mb-2 text-sm font-medium">
          Max Context Size: {maxContextChars} chars
          <span class="block text-xs text-gray-500 font-normal mt-0.5">Maximum context characters in prompts</span>
        </label>
        <input type="range" min="200" max="4000" step="100" bind:value={maxContextChars} on:change={saveSettings} class="range-slider" />
      </div>

      <!-- Max History Messages -->
      <div class="setting-group">
        <label class="block mb-2 text-sm font-medium">
          Max History: {maxHistoryMessages} messages
          <span class="block text-xs text-gray-500 font-normal mt-0.5">Maximum conversation history to retain</span>
        </label>
        <input type="range" min="5" max="100" step="5" bind:value={maxHistoryMessages} on:change={saveSettings} class="range-slider" />
      </div>

      <!-- User Input Priority -->
      <div class="setting-group">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" bind:checked={userInputPriority} on:change={saveSettings} class="w-[18px] h-[18px] cursor-pointer" />
          Prioritize User Input
          <span class="block text-xs text-gray-500 font-normal">Always focus on current question over context</span>
        </label>
      </div>

      <!-- Inner Dialog History Settings -->
      <h4 class="mt-6 mb-3 text-base text-gray-300">Inner Dialog Display</h4>

      <!-- Inner Dialog History Limit -->
      <div class="setting-group">
        <label class="block mb-2 text-sm font-medium">
          Inner Dialog Messages: {innerDialogHistoryLimit}
          <span class="block text-xs text-gray-500 font-normal mt-0.5">Max messages (reflections/dreams) to display in Inner Dialog tab</span>
        </label>
        <input type="range" min="20" max="500" step="10" bind:value={innerDialogHistoryLimit} on:change={saveSettings} class="range-slider" />
      </div>

      <!-- Inner Dialog History Days -->
      <div class="setting-group">
        <label class="block mb-2 text-sm font-medium">
          Inner Dialog History: {innerDialogHistoryDays} days
          <span class="block text-xs text-gray-500 font-normal mt-0.5">Days of audit logs to scan for reflections/dreams</span>
        </label>
        <input type="range" min="1" max="365" step="1" bind:value={innerDialogHistoryDays} on:change={saveSettings} class="range-slider" />
      </div>

      <!-- Consciousness Settings -->
      <h4 class="mt-6 mb-3 text-base text-gray-300">🧠 Consciousness Integration</h4>

      <!-- Unified Consciousness -->
      <div class="setting-group">
        <label class="consciousness-toggle">
          <input type="checkbox" bind:checked={unifiedConsciousness} on:change={saveSettings} class="absolute left-4 top-4 w-[18px] h-[18px] cursor-pointer" />
          <span class="flex items-center gap-2 font-semibold pl-7">
            Unified Consciousness
            {#if unifiedConsciousness}
              <span class="text-[0.7rem] py-0.5 px-2 rounded-full bg-green-500/20 text-green-500">Active</span>
            {:else}
              <span class="text-[0.7rem] py-0.5 px-2 rounded-full bg-white/10 text-gray-500">Off</span>
            {/if}
          </span>
          <span class="block text-xs text-gray-500 font-normal pl-7 mt-2 leading-relaxed">
            When enabled, inner thoughts (reflections, dreams) influence conversation responses.
            Creates more integrated consciousness but may cause inner thoughts to "bleed" into conversation.
          </span>
        </label>
      </div>

      {#if saving}
        <p class="text-gray-500 text-sm italic">Saving...</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Preset button */
  .preset-btn {
    @apply bg-white/[0.08] border border-white/15 text-gray-200 p-3 rounded-md cursor-pointer flex flex-col items-start gap-1 transition-all text-sm;
  }
  .preset-btn:hover:not(:disabled) {
    @apply bg-white/[0.12] border-white/30;
  }
  .preset-btn:disabled {
    @apply opacity-50 cursor-not-allowed;
  }

  /* Setting group spacing */
  .setting-group {
    @apply mb-5;
  }

  /* Range slider styling */
  .range-slider {
    @apply w-full h-1.5 rounded-sm outline-none;
    background: rgba(255, 255, 255, 0.1);
    -webkit-appearance: none;
  }
  .range-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    @apply w-4 h-4 bg-purple-500 rounded-full cursor-pointer;
  }
  .range-slider::-moz-range-thumb {
    @apply w-4 h-4 bg-purple-500 rounded-full cursor-pointer border-0;
  }

  /* Consciousness toggle special card */
  .consciousness-toggle {
    @apply relative flex flex-col items-start bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 cursor-pointer;
  }
</style>

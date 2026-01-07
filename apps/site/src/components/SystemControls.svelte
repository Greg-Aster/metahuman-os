<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchJSONSafe } from '../lib/client/utils/fetch-timeout';

  let loraEnabled = false;
  let loading = true;
  let error: string | null = null;
  let working = false;

  // Training config
  let trainingConfig: any = null;
  let updatingTrainingConfig = false;

  async function loadData() {
    loading = true;
    error = null;
    try {
      const { data, error: fetchError } = await fetchJSONSafe('/api/adapters', {
        timeout: 15000,
        retries: 1,
        retryDelay: 2000,
      });

      if (fetchError) throw new Error(fetchError);
      if (!data || !data.success) throw new Error(data?.error || 'Failed to load data');

      loraEnabled = !!(data.sleep?.loraEnabled);
    } catch (err) {
      console.error('[SystemControls] Load error:', err);
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function loadTrainingConfig() {
    try {
      const { data, error: fetchError } = await fetchJSONSafe('/api/training-data', {
        timeout: 10000,
      });

      if (fetchError) {
        console.warn('[SystemControls] Training config not available');
        return;
      }

      if (data && data.success) {
        trainingConfig = data.config;
      }
    } catch (err) {
      console.warn('[SystemControls] Failed to load training config:', err);
    }
  }

  async function updateTrainingConfig(updates: any) {
    updatingTrainingConfig = true;
    try {
      const res = await apiFetch('/api/training-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await loadTrainingConfig();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      updatingTrainingConfig = false;
    }
  }

  function applyPhasePreset(phase: 'phase1_conservative' | 'phase2_optimal' | 'phase3_maximum') {
    const presets = {
      phase1_conservative: { batchSize: 50, maxSamplesPerSource: 1000, qualityThreshold: 6.5 },
      phase2_optimal: { batchSize: 100, maxSamplesPerSource: 3000, qualityThreshold: 5.5 },
      phase3_maximum: { batchSize: 150, maxSamplesPerSource: 5000, qualityThreshold: 4.5 },
    };
    const preset = presets[phase];
    updateTrainingConfig({
      curator: { batchSize: preset.batchSize, qualityThreshold: preset.qualityThreshold },
      collection: { maxSamplesPerSource: preset.maxSamplesPerSource }
    });
  }

  async function sendAction(action: string, payload: Record<string, any>) {
    working = true;
    try {
      const res = await apiFetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Action failed');
      return data;
    } finally {
      working = false;
    }
  }

  async function runBuilderNow() {
    try {
      await sendAction('runBuilder', {});
      alert('✅ Adapter-builder started. Check datasets tab shortly.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function runDreamerNow() {
    try {
      await sendAction('runDreamer', {});
      alert('✅ Dreamer started. New learnings will appear in morning profile.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function runNightProcessorNow() {
    try {
      await sendAction('runNightProcessor', {});
      alert('✅ Night processor started (transcriber + audio-organizer).');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function startSleepService() {
    try {
      await sendAction('startSleepService', {});
      alert('✅ Sleep service started. Will run nightly automation.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function exportConversationsNow() {
    try {
      const res = await apiFetch('/api/export-conversations', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      alert('✅ Conversations exported successfully.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function mergeHistoricalAdapters() {
    if (!confirm('Merge all historical adapters into a single consolidated adapter?\n\nThis may take several minutes.')) return;

    try {
      await sendAction('mergeAdapters', {});
      alert('✅ Adapter merge started. Check audit logs for progress.');
    } catch (err) {
      alert('❌ ' + (err as Error).message);
    }
  }

  async function onToggleLoraEnabled(e: any) {
    const checked = !!e.currentTarget.checked;
    try {
      await sendAction('sleep', { loraEnabled: checked });
      loraEnabled = checked;
    } catch (err) {
      alert('❌ ' + (err as Error).message);
      await loadData(); // Reload to reset checkbox
    }
  }

  onMount(() => {
    loadData();
    loadTrainingConfig();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  });
</script>

<div class="p-6 max-w-[1400px] mx-auto">
  <div class="flex justify-between items-center mb-6">
    <div>
      <h2 class="m-0 mb-1 text-2xl font-semibold">⚙️ System Controls</h2>
      <p class="m-0 text-gray-500 text-sm">Agent triggers, automation settings, and training configuration.</p>
    </div>
    <button class="bg-blue-500 text-white border-none px-4 py-2 rounded-md cursor-pointer font-medium transition-colors hover:enabled:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={loadData} disabled={loading}>
      {loading ? 'Refreshing…' : '↻ Refresh'}
    </button>
  </div>

  {#if error}
    <div class="bg-red-100 border border-red-300 rounded-md p-4 mb-6 text-red-700 flex justify-between items-center">
      <strong>⚠️ Error:</strong> {error}
      <button class="bg-transparent border-none text-2xl cursor-pointer text-red-700 px-2" on:click={() => error = null}>×</button>
    </div>
  {/if}

  <!-- Agent Controls -->
  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
    <header class="mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
      <h3 class="m-0 mb-1 text-lg font-semibold">🤖 Background Agents</h3>
      <p class="m-0 text-gray-500 text-sm">Manually trigger autonomous agents and services.</p>
    </header>
    <div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <button class="bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-lg py-5 px-4 cursor-pointer transition-all text-center hover:enabled:border-blue-500 hover:enabled:-translate-y-0.5 hover:enabled:shadow-md disabled:opacity-50 disabled:cursor-not-allowed" on:click={runBuilderNow} disabled={working}>
        <div class="text-[2rem] mb-2">📦</div>
        <div class="font-semibold text-sm mb-1">Run Builder</div>
        <div class="text-xs text-gray-500">Generate training dataset</div>
      </button>
      <button class="bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-lg py-5 px-4 cursor-pointer transition-all text-center hover:enabled:border-blue-500 hover:enabled:-translate-y-0.5 hover:enabled:shadow-md disabled:opacity-50 disabled:cursor-not-allowed" on:click={runDreamerNow} disabled={working}>
        <div class="text-[2rem] mb-2">💭</div>
        <div class="font-semibold text-sm mb-1">Run Dreamer</div>
        <div class="text-xs text-gray-500">Generate dream memories</div>
      </button>
      <button class="bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-lg py-5 px-4 cursor-pointer transition-all text-center hover:enabled:border-blue-500 hover:enabled:-translate-y-0.5 hover:enabled:shadow-md disabled:opacity-50 disabled:cursor-not-allowed" on:click={runNightProcessorNow} disabled={working}>
        <div class="text-[2rem] mb-2">🌙</div>
        <div class="font-semibold text-sm mb-1">Night Processor</div>
        <div class="text-xs text-gray-500">Transcribe & organize audio</div>
      </button>
      <button class="bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-lg py-5 px-4 cursor-pointer transition-all text-center hover:enabled:border-blue-500 hover:enabled:-translate-y-0.5 hover:enabled:shadow-md disabled:opacity-50 disabled:cursor-not-allowed" on:click={startSleepService} disabled={working}>
        <div class="text-[2rem] mb-2">😴</div>
        <div class="font-semibold text-sm mb-1">Sleep Service</div>
        <div class="text-xs text-gray-500">Start nightly automation</div>
      </button>
      <button class="bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-lg py-5 px-4 cursor-pointer transition-all text-center hover:enabled:border-blue-500 hover:enabled:-translate-y-0.5 hover:enabled:shadow-md disabled:opacity-50 disabled:cursor-not-allowed" on:click={exportConversationsNow} disabled={working}>
        <div class="text-[2rem] mb-2">💾</div>
        <div class="font-semibold text-sm mb-1">Export Conversations</div>
        <div class="text-xs text-gray-500">Export chat history</div>
      </button>
      <button class="bg-amber-50 dark:bg-amber-950 border-2 border-amber-500 rounded-lg py-5 px-4 cursor-pointer transition-all text-center hover:enabled:border-blue-500 hover:enabled:-translate-y-0.5 hover:enabled:shadow-md disabled:opacity-50 disabled:cursor-not-allowed" on:click={mergeHistoricalAdapters} disabled={working}>
        <div class="text-[2rem] mb-2">🔀</div>
        <div class="font-semibold text-sm mb-1">Merge Adapters</div>
        <div class="text-xs text-gray-500">Consolidate historical adapters</div>
      </button>
    </div>
  </section>

  <!-- System Toggles -->
  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
    <header class="mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
      <h3 class="m-0 mb-1 text-lg font-semibold">🔧 System Configuration</h3>
      <p class="m-0 text-gray-500 text-sm">Core system settings and toggles.</p>
    </header>
    <div class="flex flex-col gap-4">
      <label class="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-900 rounded-md cursor-pointer">
        <div>
          <div class="font-semibold text-sm mb-1">Enable LoRA Training</div>
          <div class="text-xs text-gray-500">Allow nightly LoRA adapter training</div>
        </div>
        <input type="checkbox" checked={loraEnabled} on:change={onToggleLoraEnabled} disabled={working} class="cursor-pointer w-5 h-5" />
      </label>
    </div>
  </section>

  <!-- Training Data Configuration -->
  {#if trainingConfig}
    <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
      <header class="mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
        <h3 class="m-0 mb-1 text-lg font-semibold">📊 Training Data Configuration</h3>
        <p class="m-0 text-gray-500 text-sm">Configure data collection and curation settings for training.</p>
      </header>

      <!-- Quick Presets -->
      <div class="flex items-center gap-4 mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-md flex-wrap">
        <div class="font-semibold text-sm">Quick Presets:</div>
        <button class="flex flex-col py-3 px-4 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-md cursor-pointer transition-all hover:enabled:border-blue-500 hover:enabled:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => applyPhasePreset('phase1_conservative')} disabled={updatingTrainingConfig}>
          <span class="font-semibold text-sm mb-1">Phase 1: Conservative</span>
          <span class="text-xs text-gray-500">~1000 samples</span>
        </button>
        <button class="flex flex-col py-3 px-4 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-md cursor-pointer transition-all hover:enabled:border-blue-500 hover:enabled:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => applyPhasePreset('phase2_optimal')} disabled={updatingTrainingConfig}>
          <span class="font-semibold text-sm mb-1">Phase 2: Optimal</span>
          <span class="text-xs text-gray-500">~3000 samples</span>
        </button>
        <button class="flex flex-col py-3 px-4 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-md cursor-pointer transition-all hover:enabled:border-blue-500 hover:enabled:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => applyPhasePreset('phase3_maximum')} disabled={updatingTrainingConfig}>
          <span class="font-semibold text-sm mb-1">Phase 3: Maximum</span>
          <span class="text-xs text-gray-500">~5000 samples</span>
        </button>
      </div>

      <!-- Configuration Grid -->
      <div class="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-6 mb-4">
        <div class="p-4 bg-gray-50 dark:bg-gray-900 rounded-md">
          <h4 class="m-0 mb-3 text-base font-semibold text-gray-500">Curator Settings</h4>
          <div class="flex flex-col gap-2 mb-4">
            <label for="batch-size" class="font-medium text-sm">Batch Size:</label>
            <input
              id="batch-size"
              type="number"
              min="10"
              max="200"
              step="10"
              value={trainingConfig.curator.batchSize}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { batchSize: parseInt(e.currentTarget.value) } })}
              class="p-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 dark:text-gray-100"
            />
            <span class="text-xs text-gray-500">Samples per curator call (10-200)</span>
          </div>
          <div class="flex flex-col gap-2">
            <label for="quality-threshold" class="font-medium text-sm">Quality Threshold:</label>
            <input
              id="quality-threshold"
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={trainingConfig.curator.qualityThreshold}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ curator: { qualityThreshold: parseFloat(e.currentTarget.value) } })}
              class="p-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 dark:text-gray-100"
            />
            <span class="text-xs text-gray-500">Min quality score (0-10)</span>
          </div>
        </div>

        <div class="p-4 bg-gray-50 dark:bg-gray-900 rounded-md">
          <h4 class="m-0 mb-3 text-base font-semibold text-gray-500">Collection Settings</h4>
          <div class="flex flex-col gap-2">
            <label for="max-samples" class="font-medium text-sm">Max Samples/Source:</label>
            <input
              id="max-samples"
              type="number"
              min="100"
              max="10000"
              step="100"
              value={trainingConfig.collection.maxSamplesPerSource}
              disabled={updatingTrainingConfig}
              on:change={(e) => updateTrainingConfig({ collection: { maxSamplesPerSource: parseInt(e.currentTarget.value) } })}
              class="p-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 dark:text-gray-100"
            />
            <span class="text-xs text-gray-500">Max samples per type (100-10000)</span>
          </div>
        </div>
      </div>

      <div class="p-4 bg-gray-50 dark:bg-gray-900 rounded-md text-sm">
        <strong>Current:</strong>
        Batch size: <span class="text-blue-500 font-semibold">{trainingConfig.curator.batchSize}</span> |
        Max samples: <span class="text-blue-500 font-semibold">{trainingConfig.collection.maxSamplesPerSource}</span> |
        Quality: <span class="text-blue-500 font-semibold">{trainingConfig.curator.qualityThreshold}</span>
      </div>
    </section>
  {/if}
</div>

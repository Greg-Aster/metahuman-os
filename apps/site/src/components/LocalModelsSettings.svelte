<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  // Model status types
  interface ModelInfo {
    id: string;
    hfId?: string;
    size: string;
    dimensions?: number;
    description?: string;
    downloaded: boolean;
  }

  interface ServiceStatus {
    running: boolean;
    endpoint: string;
    loadedModels: {
      embedder: {
        model: string | null;
        loaded: boolean;
        dimensions?: number;
      };
      generator: {
        model: string | null;
        loaded: boolean;
      };
    } | null;
  }

  interface LocalModelsConfig {
    enabled: boolean;
    endpoint: string;
    port: number;
    autoStart: boolean;
    downloadOnWifiOnly: boolean;
    embeddings: {
      model: string;
      preloadAtStartup: boolean;
    };
    llm: {
      model: string;
      preloadAtStartup: boolean;
    };
  }

  // State
  let loading = true;
  let error: string | null = null;
  let status: ServiceStatus | null = null;
  let config: LocalModelsConfig | null = null;
  let embeddingModels: ModelInfo[] = [];
  let llmModels: ModelInfo[] = [];

  // Download state
  let downloading: Record<string, boolean> = {};
  let downloadNotice: string | null = null;

  // Config changes
  let selectedEmbeddingModel = '';
  let selectedLLMModel = '';
  let wifiOnlyDownload = true;
  let autoStart = true;
  let saving = false;

  onMount(() => { void refreshModels(); });

  async function refreshModels() {
    error = null;
    loading = true;
    await Promise.all([loadStatus(), loadConfig(), loadModels()]);
    loading = false;
  }

  async function loadStatus() {
    try {
      const res = await apiFetch('/api/local-models/status');
      if (!res.ok) throw new Error(`Local model status returned ${res.status}`);
      status = await res.json();
    } catch (err) {
      status = null;
      error = err instanceof Error ? err.message : 'Could not load local model status';
      console.error('[LocalModelsSettings] Error loading status:', err);
    }
  }

  async function loadConfig() {
    try {
      const res = await apiFetch('/api/local-models/config');
      if (!res.ok) throw new Error(`Local model configuration returned ${res.status}`);
      {
        const data = await res.json();
        if (!data.localModels) throw new Error('Local model configuration is missing');
        config = data.localModels;
        selectedEmbeddingModel = config?.embeddings?.model || 'qwen3-embedding-0.6b';
        selectedLLMModel = config?.llm?.model || 'qwen3-1.7b';
        wifiOnlyDownload = config?.downloadOnWifiOnly ?? true;
        autoStart = config?.autoStart ?? true;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load local model configuration';
      console.error('[LocalModelsSettings] Error loading config:', err);
    }
  }

  async function loadModels() {
    try {
      const res = await apiFetch('/api/local-models/models');
      if (!res.ok) throw new Error(`Local model inventory returned ${res.status}`);
      const data = await res.json();
      embeddingModels = data.embeddings.map((model: { id: string; downloaded: boolean; config: Omit<ModelInfo, 'id' | 'downloaded'> }) => ({ ...model.config, id: model.id, downloaded: model.downloaded }));
      llmModels = data.llm.map((model: { id: string; downloaded: boolean; config: Omit<ModelInfo, 'id' | 'downloaded'> }) => ({ ...model.config, id: model.id, downloaded: model.downloaded }));
    } catch (err) {
      embeddingModels = []; llmModels = [];
      error = err instanceof Error ? err.message : 'Could not load local model inventory';
      console.error('[LocalModelsSettings] Error loading models:', err);
    }
  }

  async function downloadModel(type: 'embeddings' | 'llm', modelId: string) {
    downloading[modelId] = true;
    downloadNotice = null;
    error = null;

    try {
      const res = await apiFetch('/api/local-models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, model: modelId }),
      });

      if (!res.ok) {
        const data = await res.json();
        error = data.error || 'Failed to start download';
      } else {
        downloadNotice = 'Download request accepted. Refresh model status to check completion.';
      }
    } catch (err) {
      error = 'Failed to start download';
    } finally { downloading[modelId] = false; }
  }

  async function saveConfig() {
    saving = true;
    error = null;

    try {
      const res = await apiFetch('/api/local-models/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localModels: {
            downloadOnWifiOnly: wifiOnlyDownload,
            autoStart: autoStart,
            embeddings: {
              model: selectedEmbeddingModel,
              preloadAtStartup: true,
            },
            llm: {
              model: selectedLLMModel,
              preloadAtStartup: false,
            },
          },
        }),
      });

      if (res.ok) {
        await loadConfig();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to save config';
      }
    } catch (err) {
      error = 'Failed to save config';
    } finally {
      saving = false;
    }
  }

  async function loadModel(type: 'embeddings' | 'llm', modelId: string) {
    error = null;

    try {
      const res = await apiFetch('/api/local-models/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, model: modelId }),
      });

      if (res.ok) {
        await loadStatus();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to load model';
      }
    } catch (err) {
      error = 'Failed to load model';
    }
  }

  function formatSize(size: string): string {
    return size;
  }

</script>

<div>
  <h3 class="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-100">Local Model Service</h3>
  <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">
    Lightweight embedding and LLM models that run locally without Ollama.
    Works on both desktop and mobile devices.
  </p>

  {#if error}
    <div class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>
  {/if}

  <button class="btn-secondary mb-4" on:click={refreshModels} disabled={loading}>Refresh model status</button>
  {#if downloadNotice}<p class="text-sm mb-4">{downloadNotice}</p>{/if}

  {#if loading}
    <div class="text-center py-8 text-gray-500">Loading local models status...</div>
  {:else}
    <!-- Service Status -->
    <div class="rounded-xl p-4 mb-6 {status?.running ? 'bg-green-50 dark:bg-green-500/10 border border-green-300 dark:border-green-500/30' : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30'}">
      <div class="flex items-center gap-2">
        <span class="text-sm">{status?.running ? '🟢' : '🔴'}</span>
        <span class="font-semibold text-gray-700 dark:text-gray-200">
          {!status ? 'Service status unavailable' : status.running ? 'Service Running' : 'Service Stopped'}
        </span>
        {#if status?.endpoint}
          <span class="text-xs font-mono text-gray-500 dark:text-gray-400 ml-auto">{status.endpoint}</span>
        {/if}
      </div>

      {#if status?.running && status.loadedModels}
        <div class="mt-3 flex flex-col gap-1.5">
          <div class="flex items-center gap-2 text-sm">
            <span class="font-medium text-gray-500 dark:text-gray-400 min-w-[80px]">Embeddings:</span>
            {#if status.loadedModels.embedder.loaded}
              <span class="font-mono text-gray-700 dark:text-gray-200">{status.loadedModels.embedder.model}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400">({status.loadedModels.embedder.dimensions} dims)</span>
            {:else}
              <span class="italic text-gray-400">Not loaded</span>
            {/if}
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="font-medium text-gray-500 dark:text-gray-400 min-w-[80px]">LLM:</span>
            {#if status.loadedModels.generator.loaded}
              <span class="font-mono text-gray-700 dark:text-gray-200">{status.loadedModels.generator.model}</span>
            {:else}
              <span class="italic text-gray-400">Not loaded</span>
            {/if}
          </div>
        </div>
      {:else if status?.running}
        <p class="text-sm mt-3">Loaded model information is unavailable.</p>
      {/if}
    </div>

    <!-- Download Settings -->
    <div class="mb-6">
      <h4 class="text-base font-semibold mb-2 text-gray-700 dark:text-gray-200">Download Settings</h4>

      <div class="mb-3 flex flex-col gap-1">
        <label class="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
          <input type="checkbox" bind:checked={wifiOnlyDownload} class="w-4 h-4 accent-violet-500 cursor-pointer" />
          <span>Download on WiFi only</span>
        </label>
        <span class="text-xs text-gray-500 dark:text-gray-400 ml-6">
          Prevents large downloads over mobile data
        </span>
      </div>

      <div class="mb-3 flex flex-col gap-1">
        <label class="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
          <input type="checkbox" bind:checked={autoStart} class="w-4 h-4 accent-violet-500 cursor-pointer" />
          <span>Auto-start service on boot</span>
        </label>
        <span class="text-xs text-gray-500 dark:text-gray-400 ml-6">
          Starts the local model service when the app launches
        </span>
      </div>
    </div>

    <!-- Embedding Models -->
    <div class="mb-6">
      <h4 class="text-base font-semibold mb-2 text-gray-700 dark:text-gray-200">Embedding Models</h4>
      <p class="text-[0.8125rem] text-gray-500 dark:text-gray-400 mb-4">
        Used for semantic memory search. Qwen3-Embedding is state-of-the-art.
      </p>

      <div class="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
        {#each embeddingModels as model}
          <div class="p-4 rounded-xl transition-all border-2 {model.downloaded ? 'border-green-300 dark:border-green-500/50' : 'border-gray-200 dark:border-gray-700'} {selectedEmbeddingModel === model.id ? 'border-violet-500 dark:border-violet-400 ring-4 ring-violet-500/10 dark:ring-violet-400/10' : ''} bg-gray-50 dark:bg-gray-800">
            <div class="flex items-center justify-between mb-2">
              <span class="font-semibold text-gray-800 dark:text-gray-100">{model.id}</span>
              {#if model.downloaded}
                <span class="bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded-full">Downloaded</span>
              {/if}
            </div>

            <div class="flex gap-2 mb-2">
              <span class="text-[0.8125rem] font-medium text-gray-500 dark:text-gray-400">{formatSize(model.size)}</span>
              {#if model.dimensions}
                <span class="text-xs text-gray-500 dark:text-gray-400">{model.dimensions} dims</span>
              {/if}
            </div>

            {#if model.description}
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-snug">{model.description}</p>
            {/if}

            <div class="flex gap-2">
              {#if downloading[model.id]}
                <span class="text-sm">Requesting download…</span>
              {:else if model.downloaded}
                <button
                  class="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium cursor-pointer transition-colors border {selectedEmbeddingModel === model.id ? 'bg-violet-500 text-white border-violet-500' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'}"
                  on:click={() => { selectedEmbeddingModel = model.id; }}
                >
                  {selectedEmbeddingModel === model.id ? '✓ Selected' : 'Select'}
                </button>
                {#if status?.running && status.loadedModels && (!status.loadedModels.embedder.loaded || status.loadedModels.embedder.model !== model.id)}
                  <button
                    class="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium cursor-pointer transition-colors bg-green-500 text-white border-none hover:bg-green-600"
                    on:click={() => loadModel('embeddings', model.id)}
                  >
                    Load
                  </button>
                {/if}
              {:else}
                <button
                  class="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium cursor-pointer transition-colors bg-blue-500 text-white border-none hover:bg-blue-600"
                  on:click={() => downloadModel('embeddings', model.id)}
                >
                  Download
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- LLM Models -->
    <div class="mb-6">
      <h4 class="text-base font-semibold mb-2 text-gray-700 dark:text-gray-200">Small LLM Models</h4>
      <p class="text-[0.8125rem] text-gray-500 dark:text-gray-400 mb-4">
        Lightweight language models for on-device inference. Choose based on your device memory.
      </p>

      <div class="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
        {#each llmModels as model}
          <div class="p-4 rounded-xl transition-all border-2 {model.downloaded ? 'border-green-300 dark:border-green-500/50' : 'border-gray-200 dark:border-gray-700'} {selectedLLMModel === model.id ? 'border-violet-500 dark:border-violet-400 ring-4 ring-violet-500/10 dark:ring-violet-400/10' : ''} bg-gray-50 dark:bg-gray-800">
            <div class="flex items-center justify-between mb-2">
              <span class="font-semibold text-gray-800 dark:text-gray-100">{model.id}</span>
              {#if model.downloaded}
                <span class="bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded-full">Downloaded</span>
              {/if}
            </div>

            <div class="flex gap-2 mb-2">
              <span class="text-[0.8125rem] font-medium text-gray-500 dark:text-gray-400">{formatSize(model.size)}</span>
            </div>

            {#if model.description}
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-snug">{model.description}</p>
            {/if}

            <div class="flex gap-2">
              {#if downloading[model.id]}
                <span class="text-sm">Requesting download…</span>
              {:else if model.downloaded}
                <button
                  class="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium cursor-pointer transition-colors border {selectedLLMModel === model.id ? 'bg-violet-500 text-white border-violet-500' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'}"
                  on:click={() => { selectedLLMModel = model.id; }}
                >
                  {selectedLLMModel === model.id ? '✓ Selected' : 'Select'}
                </button>
                {#if status?.running && status.loadedModels && (!status.loadedModels.generator.loaded || status.loadedModels.generator.model !== model.id)}
                  <button
                    class="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium cursor-pointer transition-colors bg-green-500 text-white border-none hover:bg-green-600"
                    on:click={() => loadModel('llm', model.id)}
                  >
                    Load
                  </button>
                {/if}
              {:else}
                <button
                  class="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium cursor-pointer transition-colors bg-blue-500 text-white border-none hover:bg-blue-600"
                  on:click={() => downloadModel('llm', model.id)}
                >
                  Download
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Save Button -->
    <div class="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
      <button
        class="bg-violet-500 text-white border-none px-5 py-2.5 rounded-lg font-semibold cursor-pointer transition-colors hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed"
        on:click={saveConfig}
        disabled={saving}
      >
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>
    </div>
  {/if}
</div>


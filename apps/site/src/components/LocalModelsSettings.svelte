<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
    embedder: {
      model: string | null;
      loaded: boolean;
      dimensions?: number;
    };
    generator: {
      model: string | null;
      loaded: boolean;
    };
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
  let downloadProgress: Record<string, number> = {};

  // Config changes
  let selectedEmbeddingModel = '';
  let selectedLLMModel = '';
  let wifiOnlyDownload = true;
  let autoStart = true;
  let saving = false;

  // Event source for progress updates
  let eventSource: EventSource | null = null;

  onMount(() => {
    loadStatus();
    loadConfig();
    loadModels();
    connectProgressStream();
  });

  onDestroy(() => {
    if (eventSource) {
      eventSource.close();
    }
  });

  async function loadStatus() {
    try {
      const res = await apiFetch('/api/local-models/status');
      if (res.ok) {
        status = await res.json();
      }
    } catch (err) {
      console.error('[LocalModelsSettings] Error loading status:', err);
    }
  }

  async function loadConfig() {
    try {
      const res = await apiFetch('/api/local-models/config');
      if (res.ok) {
        const data = await res.json();
        config = data.localModels || data;
        selectedEmbeddingModel = config?.embeddings?.model || 'qwen3-embedding-0.6b';
        selectedLLMModel = config?.llm?.model || 'qwen3-1.7b';
        wifiOnlyDownload = config?.downloadOnWifiOnly ?? true;
        autoStart = config?.autoStart ?? true;
      }
    } catch (err) {
      console.error('[LocalModelsSettings] Error loading config:', err);
    } finally {
      loading = false;
    }
  }

  async function loadModels() {
    try {
      const res = await apiFetch('/api/local-models/models');
      if (res.ok) {
        const data = await res.json();
        embeddingModels = data.embeddings || [];
        llmModels = data.llm || [];
      }
    } catch (err) {
      console.error('[LocalModelsSettings] Error loading models:', err);
    }
  }

  function connectProgressStream() {
    try {
      eventSource = new EventSource('/api/local-models/events');

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.model) {
            downloadProgress[data.model] = data.progress || 0;

            if (data.status === 'complete' || data.status === 'error') {
              downloading[data.model] = false;
              loadModels(); // Refresh model list
              loadStatus(); // Refresh status
            }
          }
        } catch (e) {
          console.error('[LocalModelsSettings] Error parsing progress event:', e);
        }
      };

      eventSource.onerror = () => {
        console.warn('[LocalModelsSettings] Progress stream disconnected, reconnecting...');
        setTimeout(connectProgressStream, 5000);
      };
    } catch (err) {
      console.error('[LocalModelsSettings] Error connecting to progress stream:', err);
    }
  }

  async function downloadModel(type: 'embeddings' | 'llm', modelId: string) {
    downloading[modelId] = true;
    downloadProgress[modelId] = 0;
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
        downloading[modelId] = false;
      }
    } catch (err) {
      error = 'Failed to start download';
      downloading[modelId] = false;
    }
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

  function getProgressPercent(modelId: string): number {
    return Math.round((downloadProgress[modelId] || 0) * 100);
  }
</script>

<div>
  <h3 class="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-100">Local Models (Transformers.js)</h3>
  <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">
    Lightweight embedding and LLM models that run locally without Ollama.
    Works on both desktop and mobile devices.
  </p>

  {#if error}
    <div class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="text-center py-8 text-gray-500">Loading local models status...</div>
  {:else}
    <!-- Service Status -->
    <div class="rounded-xl p-4 mb-6 {status?.running ? 'bg-green-50 dark:bg-green-500/10 border border-green-300 dark:border-green-500/30' : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30'}">
      <div class="flex items-center gap-2">
        <span class="text-sm">{status?.running ? '🟢' : '🔴'}</span>
        <span class="font-semibold text-gray-700 dark:text-gray-200">
          {status?.running ? 'Service Running' : 'Service Stopped'}
        </span>
        {#if status?.endpoint}
          <span class="text-xs font-mono text-gray-500 dark:text-gray-400 ml-auto">{status.endpoint}</span>
        {/if}
      </div>

      {#if status?.running}
        <div class="mt-3 flex flex-col gap-1.5">
          <div class="flex items-center gap-2 text-sm">
            <span class="font-medium text-gray-500 dark:text-gray-400 min-w-[80px]">Embeddings:</span>
            {#if status.embedder.loaded}
              <span class="font-mono text-gray-700 dark:text-gray-200">{status.embedder.model}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400">({status.embedder.dimensions} dims)</span>
            {:else}
              <span class="italic text-gray-400">Not loaded</span>
            {/if}
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="font-medium text-gray-500 dark:text-gray-400 min-w-[80px]">LLM:</span>
            {#if status.generator.loaded}
              <span class="font-mono text-gray-700 dark:text-gray-200">{status.generator.model}</span>
            {:else}
              <span class="italic text-gray-400">Not loaded</span>
            {/if}
          </div>
        </div>
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
                <div class="flex-1 h-6 bg-gray-200 dark:bg-gray-700 rounded-md relative overflow-hidden">
                  <div class="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-md transition-all duration-300" style="width: {getProgressPercent(model.id)}%"></div>
                  <span class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-semibold text-gray-700 dark:text-gray-200">{getProgressPercent(model.id)}%</span>
                </div>
              {:else if model.downloaded}
                <button
                  class="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium cursor-pointer transition-colors border {selectedEmbeddingModel === model.id ? 'bg-violet-500 text-white border-violet-500' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'}"
                  on:click={() => { selectedEmbeddingModel = model.id; }}
                >
                  {selectedEmbeddingModel === model.id ? '✓ Selected' : 'Select'}
                </button>
                {#if status?.running && (!status.embedder.loaded || status.embedder.model !== model.id)}
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
                <div class="flex-1 h-6 bg-gray-200 dark:bg-gray-700 rounded-md relative overflow-hidden">
                  <div class="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-md transition-all duration-300" style="width: {getProgressPercent(model.id)}%"></div>
                  <span class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-semibold text-gray-700 dark:text-gray-200">{getProgressPercent(model.id)}%</span>
                </div>
              {:else if model.downloaded}
                <button
                  class="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium cursor-pointer transition-colors border {selectedLLMModel === model.id ? 'bg-violet-500 text-white border-violet-500' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'}"
                  on:click={() => { selectedLLMModel = model.id; }}
                >
                  {selectedLLMModel === model.id ? '✓ Selected' : 'Select'}
                </button>
                {#if status?.running && (!status.generator.loaded || status.generator.model !== model.id)}
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


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

<div class="local-models-settings">
  <h3>Local Models (Transformers.js)</h3>
  <p class="description">
    Lightweight embedding and LLM models that run locally without Ollama.
    Works on both desktop and mobile devices.
  </p>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading local models status...</div>
  {:else}
    <!-- Service Status -->
    <div class="status-card" class:running={status?.running}>
      <div class="status-header">
        <span class="status-icon">{status?.running ? '🟢' : '🔴'}</span>
        <span class="status-text">
          {status?.running ? 'Service Running' : 'Service Stopped'}
        </span>
        {#if status?.endpoint}
          <span class="endpoint">{status.endpoint}</span>
        {/if}
      </div>

      {#if status?.running}
        <div class="loaded-models">
          <div class="loaded-model">
            <span class="model-type">Embeddings:</span>
            {#if status.embedder.loaded}
              <span class="model-name">{status.embedder.model}</span>
              <span class="model-dims">({status.embedder.dimensions} dims)</span>
            {:else}
              <span class="not-loaded">Not loaded</span>
            {/if}
          </div>
          <div class="loaded-model">
            <span class="model-type">LLM:</span>
            {#if status.generator.loaded}
              <span class="model-name">{status.generator.model}</span>
            {:else}
              <span class="not-loaded">Not loaded</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- Download Settings -->
    <div class="config-section">
      <h4>Download Settings</h4>

      <div class="config-row checkbox-row">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={wifiOnlyDownload} />
          <span>Download on WiFi only</span>
        </label>
        <span class="config-hint">
          Prevents large downloads over mobile data
        </span>
      </div>

      <div class="config-row checkbox-row">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={autoStart} />
          <span>Auto-start service on boot</span>
        </label>
        <span class="config-hint">
          Starts the local model service when the app launches
        </span>
      </div>
    </div>

    <!-- Embedding Models -->
    <div class="models-section">
      <h4>Embedding Models</h4>
      <p class="section-desc">
        Used for semantic memory search. Qwen3-Embedding is state-of-the-art.
      </p>

      <div class="models-grid">
        {#each embeddingModels as model}
          <div class="model-card" class:downloaded={model.downloaded} class:selected={selectedEmbeddingModel === model.id}>
            <div class="model-header">
              <span class="model-id">{model.id}</span>
              {#if model.downloaded}
                <span class="downloaded-badge">Downloaded</span>
              {/if}
            </div>

            <div class="model-info">
              <span class="model-size">{formatSize(model.size)}</span>
              {#if model.dimensions}
                <span class="model-dims">{model.dimensions} dims</span>
              {/if}
            </div>

            {#if model.description}
              <p class="model-desc">{model.description}</p>
            {/if}

            <div class="model-actions">
              {#if downloading[model.id]}
                <div class="progress-bar">
                  <div class="progress-fill" style="width: {getProgressPercent(model.id)}%"></div>
                  <span class="progress-text">{getProgressPercent(model.id)}%</span>
                </div>
              {:else if model.downloaded}
                <button
                  class="select-btn"
                  class:active={selectedEmbeddingModel === model.id}
                  on:click={() => { selectedEmbeddingModel = model.id; }}
                >
                  {selectedEmbeddingModel === model.id ? '✓ Selected' : 'Select'}
                </button>
                {#if status?.running && (!status.embedder.loaded || status.embedder.model !== model.id)}
                  <button
                    class="load-btn"
                    on:click={() => loadModel('embeddings', model.id)}
                  >
                    Load
                  </button>
                {/if}
              {:else}
                <button
                  class="download-btn"
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
    <div class="models-section">
      <h4>Small LLM Models</h4>
      <p class="section-desc">
        Lightweight language models for on-device inference. Choose based on your device memory.
      </p>

      <div class="models-grid">
        {#each llmModels as model}
          <div class="model-card" class:downloaded={model.downloaded} class:selected={selectedLLMModel === model.id}>
            <div class="model-header">
              <span class="model-id">{model.id}</span>
              {#if model.downloaded}
                <span class="downloaded-badge">Downloaded</span>
              {/if}
            </div>

            <div class="model-info">
              <span class="model-size">{formatSize(model.size)}</span>
            </div>

            {#if model.description}
              <p class="model-desc">{model.description}</p>
            {/if}

            <div class="model-actions">
              {#if downloading[model.id]}
                <div class="progress-bar">
                  <div class="progress-fill" style="width: {getProgressPercent(model.id)}%"></div>
                  <span class="progress-text">{getProgressPercent(model.id)}%</span>
                </div>
              {:else if model.downloaded}
                <button
                  class="select-btn"
                  class:active={selectedLLMModel === model.id}
                  on:click={() => { selectedLLMModel = model.id; }}
                >
                  {selectedLLMModel === model.id ? '✓ Selected' : 'Select'}
                </button>
                {#if status?.running && (!status.generator.loaded || status.generator.model !== model.id)}
                  <button
                    class="load-btn"
                    on:click={() => loadModel('llm', model.id)}
                  >
                    Load
                  </button>
                {/if}
              {:else}
                <button
                  class="download-btn"
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
    <div class="save-section">
      <button
        class="save-btn"
        on:click={saveConfig}
        disabled={saving}
      >
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>
    </div>
  {/if}
</div>

<style>
  .local-models-settings {
    padding: 0;
  }

  h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: #1f2937;
  }

  :global(.dark) h3 {
    color: #f3f4f6;
  }

  h4 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: #374151;
  }

  :global(.dark) h4 {
    color: #e5e7eb;
  }

  .description {
    font-size: 0.875rem;
    color: #6b7280;
    margin: 0 0 1.25rem 0;
  }

  :global(.dark) .description {
    color: #9ca3af;
  }

  .error-banner {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  :global(.dark) .error-banner {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
  }

  /* Status Card */
  .status-card {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 0.75rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .status-card.running {
    background: #f0fdf4;
    border-color: #86efac;
  }

  :global(.dark) .status-card {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
  }

  :global(.dark) .status-card.running {
    background: rgba(34, 197, 94, 0.1);
    border-color: rgba(34, 197, 94, 0.3);
  }

  .status-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status-icon {
    font-size: 0.875rem;
  }

  .status-text {
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .status-text {
    color: #e5e7eb;
  }

  .endpoint {
    font-size: 0.75rem;
    font-family: monospace;
    color: #6b7280;
    margin-left: auto;
  }

  :global(.dark) .endpoint {
    color: #9ca3af;
  }

  .loaded-models {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .loaded-model {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .model-type {
    font-weight: 500;
    color: #6b7280;
    min-width: 80px;
  }

  :global(.dark) .model-type {
    color: #9ca3af;
  }

  .model-name {
    font-family: monospace;
    color: #374151;
  }

  :global(.dark) .model-name {
    color: #e5e7eb;
  }

  .model-dims {
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .model-dims {
    color: #9ca3af;
  }

  .not-loaded {
    font-style: italic;
    color: #9ca3af;
  }

  /* Config Section */
  .config-section {
    margin-bottom: 1.5rem;
  }

  .config-row {
    margin-bottom: 0.75rem;
  }

  .checkbox-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
  }

  :global(.dark) .checkbox-label {
    color: #d1d5db;
  }

  .checkbox-label input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
    accent-color: #8b5cf6;
    cursor: pointer;
  }

  .config-hint {
    font-size: 0.75rem;
    color: #6b7280;
    margin-left: 1.5rem;
  }

  :global(.dark) .config-hint {
    color: #9ca3af;
  }

  /* Models Section */
  .models-section {
    margin-bottom: 1.5rem;
  }

  .section-desc {
    font-size: 0.8125rem;
    color: #6b7280;
    margin: 0 0 1rem 0;
  }

  :global(.dark) .section-desc {
    color: #9ca3af;
  }

  .models-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1rem;
  }

  .model-card {
    background: #f9fafb;
    border: 2px solid #e5e7eb;
    border-radius: 0.75rem;
    padding: 1rem;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  :global(.dark) .model-card {
    background: #1f2937;
    border-color: #374151;
  }

  .model-card.downloaded {
    border-color: #86efac;
  }

  :global(.dark) .model-card.downloaded {
    border-color: rgba(34, 197, 94, 0.5);
  }

  .model-card.selected {
    border-color: #8b5cf6;
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  }

  :global(.dark) .model-card.selected {
    border-color: #a78bfa;
    box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.1);
  }

  .model-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .model-id {
    font-weight: 600;
    color: #1f2937;
    font-size: 0.9375rem;
  }

  :global(.dark) .model-id {
    color: #f3f4f6;
  }

  .downloaded-badge {
    background: #dcfce7;
    color: #166534;
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.125rem 0.375rem;
    border-radius: 9999px;
  }

  :global(.dark) .downloaded-badge {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
  }

  .model-info {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .model-size {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #6b7280;
  }

  :global(.dark) .model-size {
    color: #9ca3af;
  }

  .model-desc {
    font-size: 0.75rem;
    color: #6b7280;
    margin: 0 0 0.75rem 0;
    line-height: 1.4;
  }

  :global(.dark) .model-desc {
    color: #9ca3af;
  }

  .model-actions {
    display: flex;
    gap: 0.5rem;
  }

  .download-btn, .select-btn, .load-btn {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    border: none;
  }

  .download-btn {
    background: #3b82f6;
    color: white;
  }

  .download-btn:hover {
    background: #2563eb;
  }

  .select-btn {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
  }

  :global(.dark) .select-btn {
    background: #374151;
    color: #e5e7eb;
    border-color: #4b5563;
  }

  .select-btn:hover {
    background: #e5e7eb;
  }

  :global(.dark) .select-btn:hover {
    background: #4b5563;
  }

  .select-btn.active {
    background: #8b5cf6;
    color: white;
    border-color: #8b5cf6;
  }

  .load-btn {
    background: #22c55e;
    color: white;
  }

  .load-btn:hover {
    background: #16a34a;
  }

  /* Progress Bar */
  .progress-bar {
    flex: 1;
    height: 24px;
    background: #e5e7eb;
    border-radius: 0.375rem;
    position: relative;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: #374151;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6);
    border-radius: 0.375rem;
    transition: width 0.3s ease;
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 0.75rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .progress-text {
    color: #e5e7eb;
  }

  /* Save Section */
  .save-section {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .save-section {
    border-color: #374151;
  }

  .save-btn {
    background: #8b5cf6;
    color: white;
    border: none;
    padding: 0.625rem 1.25rem;
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }

  .save-btn:hover:not(:disabled) {
    background: #7c3aed;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
    .models-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

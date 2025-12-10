<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { isCapacitorNative } from '../lib/client/api-config';

  // Dynamic import for NativeLLM to avoid @capacitor/core bundle issues on web
  async function getNativeLLM() {
    const { NativeLLM } = await import('../lib/client/plugins/native-llm');
    return NativeLLM;
  }

  interface LocalModel {
    name: string;
    path: string;
    sizeMB: number;
    quantization: string;
  }

  interface DownloadableModel {
    name: string;
    displayName: string;
    description: string;
    sizeMB: number;
    url: string;
    quantization: string;
  }

  // Pre-configured models available for download
  const AVAILABLE_MODELS: DownloadableModel[] = [
    {
      name: 'qwen3-1.7b-q4_k_m',
      displayName: 'Qwen3 1.7B',
      description: 'Fast, efficient model for basic chat. Good for low-power devices.',
      sizeMB: 1100,
      url: 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/qwen3-1.7b-q4_k_m.gguf',
      quantization: 'Q4_K_M',
    },
    {
      name: 'qwen3-4b-q4_k_m',
      displayName: 'Qwen3 4B',
      description: 'Balanced model with good quality and speed.',
      sizeMB: 2500,
      url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/qwen3-4b-q4_k_m.gguf',
      quantization: 'Q4_K_M',
    },
  ];

  let localModels: LocalModel[] = [];
  let loadedModel: string | null = null;
  let loading = true;
  let downloading = false;
  let downloadProgress = 0;
  let downloadingModel: string | null = null;
  let loadingModel: string | null = null;
  let error: string | null = null;
  let isMobile = false;

  let removeListener: (() => void) | null = null;

  onMount(async () => {
    isMobile = isCapacitorNative();

    if (!isMobile) {
      loading = false;
      return;
    }

    await refreshModels();

    // Listen for download progress
    const NativeLLM = await getNativeLLM();
    const listener = await NativeLLM.addListener('downloadProgress', (event) => {
      downloadProgress = event.progress;
    });
    removeListener = listener.remove;

    loading = false;
  });

  onDestroy(() => {
    if (removeListener) {
      removeListener();
    }
  });

  async function refreshModels() {
    try {
      const NativeLLM = await getNativeLLM();
      const result = await NativeLLM.listModels();
      localModels = result.models;

      const status = await NativeLLM.isModelLoaded();
      loadedModel = status.loaded ? status.modelName || null : null;
    } catch (e) {
      console.error('Failed to list models:', e);
      error = e instanceof Error ? e.message : 'Failed to list models';
    }
  }

  async function downloadModel(model: DownloadableModel) {
    if (downloading) return;

    downloading = true;
    downloadingModel = model.name;
    downloadProgress = 0;
    error = null;

    try {
      const NativeLLM = await getNativeLLM();
      const result = await NativeLLM.downloadModel({
        url: model.url,
        filename: `${model.name}.gguf`,
      });

      if (result.success) {
        await refreshModels();
      } else {
        error = result.error || 'Download failed';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Download failed';
    } finally {
      downloading = false;
      downloadingModel = null;
    }
  }

  async function loadModel(model: LocalModel) {
    if (loadingModel) return;

    loadingModel = model.name;
    error = null;

    try {
      const NativeLLM = await getNativeLLM();
      const result = await NativeLLM.loadModel({
        modelPath: model.path,
        contextSize: 2048,
      });

      if (result.success) {
        loadedModel = model.name;
      } else {
        error = result.error || 'Failed to load model';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load model';
    } finally {
      loadingModel = null;
    }
  }

  async function unloadModel() {
    try {
      const NativeLLM = await getNativeLLM();
      await NativeLLM.unloadModel();
      loadedModel = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to unload model';
    }
  }

  function formatSize(mb: number): string {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb} MB`;
  }

  function isModelDownloaded(name: string): boolean {
    return localModels.some(m => m.name.includes(name));
  }
</script>

<div class="model-manager">
  <div class="section-header">
    <h3>On-Device Models</h3>
    <button class="refresh-btn" on:click={refreshModels} disabled={loading}>
      {#if loading}
        <span class="spinner">↻</span>
      {:else}
        ↻ Refresh
      {/if}
    </button>
  </div>

  {#if !isMobile}
    <div class="info-box">
      <p>On-device models are only available in the mobile app.</p>
      <p>Download the MetaHuman app to use offline AI features.</p>
    </div>
  {:else if loading}
    <div class="loading">Loading models...</div>
  {:else}
    <!-- Currently Loaded Model -->
    {#if loadedModel}
      <div class="loaded-model">
        <div class="loaded-header">
          <span class="loaded-icon">✓</span>
          <span class="loaded-name">{loadedModel}</span>
        </div>
        <button class="btn-unload" on:click={unloadModel}>Unload</button>
      </div>
    {:else}
      <div class="no-model">
        No model loaded. Select a model below to enable offline AI.
      </div>
    {/if}

    <!-- Downloaded Models -->
    <div class="model-section">
      <h4>Downloaded Models</h4>
      {#if localModels.length === 0}
        <p class="empty-message">No models downloaded yet. Download one below.</p>
      {:else}
        <div class="model-list">
          {#each localModels as model}
            <div class="model-card" class:loaded={loadedModel === model.name}>
              <div class="model-info">
                <span class="model-name">{model.name}</span>
                <span class="model-size">{formatSize(model.sizeMB)}</span>
                <span class="model-quant">{model.quantization}</span>
              </div>
              <div class="model-actions">
                {#if loadedModel === model.name}
                  <span class="loaded-badge">Loaded</span>
                {:else}
                  <button
                    class="btn-load"
                    on:click={() => loadModel(model)}
                    disabled={loadingModel !== null}
                  >
                    {loadingModel === model.name ? 'Loading...' : 'Load'}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Available for Download -->
    <div class="model-section">
      <h4>Available for Download</h4>
      <div class="model-list">
        {#each AVAILABLE_MODELS as model}
          {@const downloaded = isModelDownloaded(model.name)}
          <div class="model-card" class:downloaded>
            <div class="model-info">
              <span class="model-name">{model.displayName}</span>
              <span class="model-size">{formatSize(model.sizeMB)}</span>
              <span class="model-quant">{model.quantization}</span>
            </div>
            <p class="model-desc">{model.description}</p>
            <div class="model-actions">
              {#if downloaded}
                <span class="downloaded-badge">Downloaded</span>
              {:else if downloadingModel === model.name}
                <div class="download-progress">
                  <div class="progress-bar" style="width: {downloadProgress}%"></div>
                  <span class="progress-text">{downloadProgress}%</span>
                </div>
              {:else}
                <button
                  class="btn-download"
                  on:click={() => downloadModel(model)}
                  disabled={downloading}
                >
                  Download
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    {#if error}
      <div class="error-message">{error}</div>
    {/if}
  {/if}
</div>

<style>
  .model-manager {
    padding: 1rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .section-header h3 {
    color: #e5e7eb;
  }

  .refresh-btn {
    padding: 0.25rem 0.5rem;
    border: 1px solid #d1d5db;
    background: white;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  :global(.dark) .refresh-btn {
    background: #374151;
    border-color: #4b5563;
    color: #e5e7eb;
  }

  .refresh-btn:disabled {
    opacity: 0.5;
  }

  .spinner {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .info-box {
    padding: 1rem;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 0.5rem;
  }

  :global(.dark) .info-box {
    background: #1e3a8a;
    border-color: #3b82f6;
  }

  .info-box p {
    margin: 0 0 0.5rem 0;
    color: #1e40af;
    font-size: 0.875rem;
  }

  :global(.dark) .info-box p {
    color: #bfdbfe;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
  }

  .loaded-model {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: #ecfdf5;
    border: 1px solid #10b981;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .loaded-model {
    background: #064e3b;
    border-color: #059669;
  }

  .loaded-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .loaded-icon {
    color: #10b981;
    font-weight: bold;
  }

  .loaded-name {
    font-weight: 600;
    color: #065f46;
  }

  :global(.dark) .loaded-name {
    color: #a7f3d0;
  }

  .btn-unload {
    padding: 0.25rem 0.75rem;
    border: 1px solid #dc2626;
    background: white;
    color: #dc2626;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .btn-unload:hover {
    background: #fef2f2;
  }

  .no-model {
    padding: 1rem;
    background: #fef3c7;
    border: 1px solid #f59e0b;
    border-radius: 0.5rem;
    color: #92400e;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .no-model {
    background: #78350f;
    border-color: #d97706;
    color: #fef3c7;
  }

  .model-section {
    margin-bottom: 1.5rem;
  }

  .model-section h4 {
    font-size: 0.875rem;
    font-weight: 600;
    color: #374151;
    margin-bottom: 0.75rem;
  }

  :global(.dark) .model-section h4 {
    color: #d1d5db;
  }

  .empty-message {
    color: #6b7280;
    font-size: 0.875rem;
    font-style: italic;
  }

  .model-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .model-card {
    padding: 0.75rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
  }

  :global(.dark) .model-card {
    background: #1f2937;
    border-color: #374151;
  }

  .model-card.loaded {
    border-color: #10b981;
    background: #f0fdf4;
  }

  :global(.dark) .model-card.loaded {
    background: #022c22;
    border-color: #059669;
  }

  .model-card.downloaded {
    opacity: 0.7;
  }

  .model-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.25rem;
  }

  .model-name {
    font-weight: 600;
    color: #111827;
  }

  :global(.dark) .model-name {
    color: #f9fafb;
  }

  .model-size {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .model-quant {
    font-size: 0.625rem;
    padding: 0.125rem 0.375rem;
    background: #e5e7eb;
    border-radius: 0.25rem;
    color: #374151;
  }

  :global(.dark) .model-quant {
    background: #374151;
    color: #d1d5db;
  }

  .model-desc {
    font-size: 0.75rem;
    color: #6b7280;
    margin: 0.25rem 0 0.5rem 0;
  }

  .model-actions {
    display: flex;
    justify-content: flex-end;
  }

  .btn-load, .btn-download {
    padding: 0.375rem 0.75rem;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-load {
    background: #3b82f6;
    color: white;
  }

  .btn-load:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-download {
    background: #10b981;
    color: white;
  }

  .btn-download:hover:not(:disabled) {
    background: #059669;
  }

  .btn-load:disabled, .btn-download:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loaded-badge, .downloaded-badge {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
  }

  .loaded-badge {
    background: #10b981;
    color: white;
  }

  .downloaded-badge {
    background: #6b7280;
    color: white;
  }

  .download-progress {
    position: relative;
    width: 100px;
    height: 24px;
    background: #e5e7eb;
    border-radius: 0.375rem;
    overflow: hidden;
  }

  :global(.dark) .download-progress {
    background: #374151;
  }

  .progress-bar {
    height: 100%;
    background: #10b981;
    transition: width 0.3s;
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 0.625rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .progress-text {
    color: #e5e7eb;
  }

  .error-message {
    margin-top: 1rem;
    padding: 0.75rem;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 0.5rem;
    color: #991b1b;
    font-size: 0.875rem;
  }

  :global(.dark) .error-message {
    background: #450a0a;
    border-color: #dc2626;
    color: #fecaca;
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import GPUMonitor from './GPUMonitor.svelte';
  import ActiveOperatorSettings from './ActiveOperatorSettings.svelte';
  import { apiFetch } from '../lib/client/api-config';

  // Welcome modal toggle
  let showWelcomeModal = false;

  // Model info
  let modelInfo: any = null;

  // LoRA state
  let loraEnabled = false;
  let loraToggling = false;
  let loraDatasets: any[] = [];
  let dualAvailable = false;
  let dualEnabled = false;
  let selecting = false;

  // Logging config
  let logLevel = 'info';
  let slowRequestThresholdMs = 1000;
  let suppressPatterns = '';
  let logColorize = true;
  let logTimestamp = true;
  let logSlowRequests = true;
  let savingLogging = false;

  // Audit logging control
  let auditLoggingEnabled = false;
  let auditLoggingLoading = false;
  let auditLoggingSaving = false;

  // Node pipeline state
  let nodePipelineEnabled = false;
  let nodePipelineLocked = false;
  let nodePipelineLoading = false;
  let nodePipelineSaving = false;

  // Embedding model control
  let embeddingEnabled = true;
  let embeddingModel = 'nomic-embed-text';
  let embeddingPreload = true;
  let embeddingLoading = false;
  let embeddingSaving = false;

  // Storage status
  let storageStatus: {
    authenticated: boolean;
    username?: string;
    status?: {
      configured: boolean;
      available: boolean;
      path?: string;
      type?: 'internal' | 'external' | 'network';
      error?: string;
    };
    paths?: Record<string, { path?: string; available: boolean }>;
  } | null = null;
  let storageLoading = false;

  // Reflector content mode
  type ContentMode = 'all' | 'user' | 'agent';
  let reflectorContentMode: ContentMode = 'user';
  let reflectorContentModeLoading = false;
  let reflectorContentModeSaving = false;
  const contentModeOptions: Record<ContentMode, string> = {
    all: 'All content - includes both user messages and AI responses',
    user: 'User only - reflects on user inputs, excluding verbose AI responses (recommended)',
    agent: 'Agent only - reflects on AI responses, dreams, and system outputs'
  };

  // Index content mode (what gets embedded for semantic search)
  let indexContentMode: ContentMode = 'user';
  let indexContentModeLoading = false;
  let indexContentModeSaving = false;
  const indexContentModeOptions: Record<ContentMode, string> = {
    user: 'User only - indexes only user inputs (recommended, prevents LLM hallucinations in search)',
    all: 'All content - indexes both user messages and AI responses',
    agent: 'Agent only - indexes AI responses, dreams, and system outputs'
  };

  onMount(async () => {
    loadWelcomeModalSetting();
    loadModelInfo();
    loadLoraState();
    loadLoggingConfig();
    loadAuditLoggingState();
    loadNodePipelineState();
    loadEmbeddingConfig();
    loadStorageStatus();
    loadReflectorContentMode();
    loadIndexContentMode();
  });

  async function loadNodePipelineState() {
    nodePipelineLoading = true;
    try {
      const res = await apiFetch('/api/node-pipeline');
      if (res.ok) {
        const data = await res.json();
        nodePipelineEnabled = !!data.enabled;
        nodePipelineLocked = !!data.locked;
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading node pipeline state:', err);
    } finally {
      nodePipelineLoading = false;
    }
  }

  async function handleNodePipelineToggle(event: Event) {
    if (nodePipelineLocked || nodePipelineSaving) {
      event?.preventDefault();
      return;
    }
    const target = event.currentTarget as HTMLInputElement | null;
    const desired = target?.checked ?? !nodePipelineEnabled;
    nodePipelineSaving = true;
    try {
      const res = await apiFetch('/api/node-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: desired })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to update node pipeline state');
      }
      const data = await res.json();
      nodePipelineEnabled = !!data.enabled;
      nodePipelineLocked = !!data.locked;
    } catch (err) {
      console.error('[SystemSettings] Error updating node pipeline state:', err);
      nodePipelineEnabled = !desired;
      alert(`Failed to update node pipeline state: ${(err as Error).message}`);
    } finally {
      nodePipelineSaving = false;
    }
  }

  async function loadAuditLoggingState() {
    auditLoggingLoading = true;
    try {
      const res = await apiFetch('/api/audit-control');
      if (res.ok) {
        const data = await res.json();
        auditLoggingEnabled = !!data.enabled;
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading audit logging state:', err);
    } finally {
      auditLoggingLoading = false;
    }
  }

  async function handleAuditLoggingToggle(event: Event) {
    if (auditLoggingSaving) {
      event?.preventDefault();
      return;
    }
    const target = event.currentTarget as HTMLInputElement | null;
    const desired = target?.checked ?? !auditLoggingEnabled;
    auditLoggingSaving = true;
    try {
      const res = await apiFetch('/api/audit-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: desired })
      });
      if (!res.ok) {
        throw new Error('Failed to update audit logging state');
      }
      const data = await res.json();
      auditLoggingEnabled = !!data.enabled;
    } catch (err) {
      console.error('[SystemSettings] Error updating audit logging state:', err);
      auditLoggingEnabled = !desired;
      alert(`Failed to update audit logging: ${(err as Error).message}`);
    } finally {
      auditLoggingSaving = false;
    }
  }

  async function purgeOldAuditLogs() {
    if (!confirm('Purge audit logs older than 7 days? This cannot be undone.')) {
      return;
    }
    try {
      const res = await apiFetch('/api/audit-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purgeOld: true })
      });
      if (!res.ok) {
        throw new Error('Failed to purge old logs');
      }
      alert('Old audit logs have been purged successfully');
    } catch (err) {
      console.error('[SystemSettings] Error purging logs:', err);
      alert(`Failed to purge logs: ${(err as Error).message}`);
    }
  }

  async function loadEmbeddingConfig() {
    embeddingLoading = true;
    try {
      const res = await apiFetch('/api/embeddings-control');
      if (res.ok) {
        const data = await res.json();
        embeddingEnabled = !!data.enabled;
        embeddingModel = data.model || 'nomic-embed-text';
        embeddingPreload = !!data.preloadAtStartup;
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading embedding config:', err);
    } finally {
      embeddingLoading = false;
    }
  }

  async function handleEmbeddingToggle(event: Event) {
    if (embeddingSaving) {
      event?.preventDefault();
      return;
    }
    const target = event.currentTarget as HTMLInputElement | null;
    const desired = target?.checked ?? !embeddingEnabled;
    embeddingSaving = true;
    try {
      const res = await apiFetch('/api/embeddings-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: desired })
      });
      if (!res.ok) {
        throw new Error('Failed to update embedding state');
      }
      const data = await res.json();
      embeddingEnabled = !!data.config.enabled;
    } catch (err) {
      console.error('[SystemSettings] Error updating embedding state:', err);
      embeddingEnabled = !desired;
      alert(`Failed to update embedding: ${(err as Error).message}`);
    } finally {
      embeddingSaving = false;
    }
  }

  async function handleEmbeddingPreloadToggle(event: Event) {
    if (embeddingSaving) {
      event?.preventDefault();
      return;
    }
    const target = event.currentTarget as HTMLInputElement | null;
    const desired = target?.checked ?? !embeddingPreload;
    embeddingSaving = true;
    try {
      const res = await apiFetch('/api/embeddings-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preloadAtStartup: desired })
      });
      if (!res.ok) {
        throw new Error('Failed to update preload state');
      }
      const data = await res.json();
      embeddingPreload = !!data.config.preloadAtStartup;
    } catch (err) {
      console.error('[SystemSettings] Error updating preload state:', err);
      embeddingPreload = !desired;
      alert(`Failed to update preload: ${(err as Error).message}`);
    } finally {
      embeddingSaving = false;
    }
  }

  async function preloadEmbeddingNow() {
    if (!embeddingEnabled) {
      alert('Enable embeddings first before preloading');
      return;
    }
    embeddingSaving = true;
    try {
      const res = await apiFetch('/api/embeddings-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preloadNow: true })
      });
      if (!res.ok) {
        throw new Error('Failed to preload model');
      }
      alert('Embedding model is being preloaded in the background');
    } catch (err) {
      console.error('[SystemSettings] Error preloading model:', err);
      alert(`Failed to preload: ${(err as Error).message}`);
    } finally {
      embeddingSaving = false;
    }
  }

  function loadWelcomeModalSetting() {
    const stored = localStorage.getItem('showWelcomeModal');
    showWelcomeModal = stored === null ? true : stored === 'true';
  }

  function toggleWelcomeModal() {
    localStorage.setItem('showWelcomeModal', String(showWelcomeModal));
  }

  async function loadModelInfo() {
    try {
      const res = await apiFetch('/api/model-info');
      if (res.ok) {
        modelInfo = await res.json();
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading model info:', err);
    }
  }

  async function loadLoraState() {
    try {
      const res = await apiFetch('/api/lora-state');
      if (res.ok) {
        const data = await res.json();
        loraEnabled = data.enabled;
        loraDatasets = data.datasets || [];
        dualAvailable = data.dualAvailable || false;
        dualEnabled = data.dualEnabled || false;
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading LoRA state:', err);
    }
  }

  async function toggleLora() {
    if (loraToggling) return;
    loraToggling = true;
    try {
      const res = await apiFetch('/api/lora-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: loraEnabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle LoRA');
      await loadModelInfo();
    } catch (err) {
      console.error('[SystemSettings] Error toggling LoRA:', err);
      loraEnabled = !loraEnabled;
    } finally {
      loraToggling = false;
    }
  }

  async function handleLoraSelect(e: Event) {
    const target = e.target as HTMLSelectElement;
    const date = target.value;
    if (!date || selecting) return;

    selecting = true;
    try {
      const res = await apiFetch('/api/lora-select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, dualEnabled }),
      });
      if (!res.ok) throw new Error('Failed to select adapter');
      await loadModelInfo();
      target.value = '';
    } catch (err) {
      console.error('[SystemSettings] Error selecting adapter:', err);
    } finally {
      selecting = false;
    }
  }

  function loadLoggingConfig() {
    logLevel = localStorage.getItem('logLevel') || 'info';
    slowRequestThresholdMs = parseInt(localStorage.getItem('slowRequestThresholdMs') || '1000', 10);
    suppressPatterns = localStorage.getItem('suppressPatterns') || '';
    logColorize = localStorage.getItem('logColorize') !== 'false';
    logTimestamp = localStorage.getItem('logTimestamp') !== 'false';
    logSlowRequests = localStorage.getItem('logSlowRequests') !== 'false';
  }

  async function saveLoggingConfig() {
    if (savingLogging) return;
    savingLogging = true;
    try {
      localStorage.setItem('logLevel', logLevel);
      localStorage.setItem('slowRequestThresholdMs', String(slowRequestThresholdMs));
      localStorage.setItem('suppressPatterns', suppressPatterns);
      localStorage.setItem('logColorize', String(logColorize));
      localStorage.setItem('logTimestamp', String(logTimestamp));
      localStorage.setItem('logSlowRequests', String(logSlowRequests));

      const res = await apiFetch('/api/logging-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: logLevel,
          slowRequestThresholdMs,
          suppressPatterns: suppressPatterns.split(',').map(s => s.trim()).filter(Boolean),
          colorize: logColorize,
          timestamp: logTimestamp,
          logSlowRequests,
        }),
      });
      if (!res.ok) throw new Error('Failed to save logging config');
    } catch (err) {
      console.error('[SystemSettings] Error saving logging config:', err);
    } finally {
      savingLogging = false;
    }
  }

  async function loadStorageStatus() {
    storageLoading = true;
    try {
      const res = await apiFetch('/api/storage-status');
      if (res.ok) {
        storageStatus = await res.json();
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading storage status:', err);
    } finally {
      storageLoading = false;
    }
  }

  function refreshStorageStatus() {
    loadStorageStatus();
  }

  async function loadReflectorContentMode() {
    reflectorContentModeLoading = true;
    try {
      const res = await apiFetch('/api/scheduler-config');
      if (res.ok) {
        const data = await res.json();
        const mode = data.globalSettings?.memoryContentMode
          || data.agents?.reflector?.contentMode;
        if (mode && ['all', 'user', 'agent'].includes(mode)) {
          reflectorContentMode = mode as ContentMode;
        }
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading memory content mode:', err);
    } finally {
      reflectorContentModeLoading = false;
    }
  }

  async function handleReflectorContentModeChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const newMode = target.value as ContentMode;

    if (reflectorContentModeSaving) return;
    reflectorContentModeSaving = true;

    try {
      const res = await apiFetch('/api/scheduler-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalSettings: {
            memoryContentMode: newMode
          }
        })
      });

      if (!res.ok) {
        throw new Error('Failed to update memory content mode');
      }

      reflectorContentMode = newMode;
    } catch (err) {
      console.error('[SystemSettings] Error updating memory content mode:', err);
      target.value = reflectorContentMode;
      alert(`Failed to update memory content mode: ${(err as Error).message}`);
    } finally {
      reflectorContentModeSaving = false;
    }
  }

  async function loadIndexContentMode() {
    indexContentModeLoading = true;
    try {
      const res = await apiFetch('/api/embeddings');
      if (res.ok) {
        const data = await res.json();
        const mode = data.indexContentMode;
        if (mode && ['all', 'user', 'agent'].includes(mode)) {
          indexContentMode = mode as ContentMode;
        }
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading index content mode:', err);
    } finally {
      indexContentModeLoading = false;
    }
  }

  async function handleIndexContentModeChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const newMode = target.value as ContentMode;

    if (indexContentModeSaving) return;
    indexContentModeSaving = true;

    try {
      const res = await apiFetch('/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indexContentMode: newMode
        })
      });

      if (!res.ok) {
        throw new Error('Failed to update index content mode');
      }

      indexContentMode = newMode;
    } catch (err) {
      console.error('[SystemSettings] Error updating index content mode:', err);
      target.value = indexContentMode;
      alert(`Failed to update index content mode: ${(err as Error).message}`);
    } finally {
      indexContentModeSaving = false;
    }
  }
</script>

<div class="w-full">
  <!-- Welcome Modal Toggle -->
  <div class="setting-group">
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="setting-label">Welcome Screen</span>
        <label class="toggle-switch" for="welcome-modal-toggle" aria-label="Show welcome modal on startup">
          <input
            id="welcome-modal-toggle"
            type="checkbox"
            bind:checked={showWelcomeModal}
            on:change={toggleWelcomeModal}
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0">
        {showWelcomeModal ? 'Welcome screen will appear on next startup' : 'Welcome screen disabled'}
      </p>
    </div>
  </div>

  <!-- Resources Section -->
  <div class="setting-group">
    <label class="setting-label">Resources</label>
    <div class="flex flex-col gap-3">
      <a href="/user-guide" class="flex items-center gap-3 p-3.5 rounded-lg bg-violet-500/5 dark:bg-violet-400/10 border border-violet-500/15 dark:border-violet-400/20 no-underline text-inherit transition-all hover:bg-violet-500/10 dark:hover:bg-violet-400/15 hover:border-violet-500/30 dark:hover:border-violet-400/35 hover:translate-x-0.5">
        <span class="text-2xl shrink-0">📖</span>
        <div class="flex flex-col gap-0.5 flex-1">
          <span class="text-[0.9375rem] font-semibold text-gray-800 dark:text-gray-100">User Guide</span>
          <span class="text-xs text-gray-500 dark:text-gray-400">Complete documentation and manual</span>
        </div>
      </a>
      <a href="https://github.com/gregjacobs/metahuman" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-3.5 rounded-lg bg-violet-500/5 dark:bg-violet-400/10 border border-violet-500/15 dark:border-violet-400/20 no-underline text-inherit transition-all hover:bg-violet-500/10 dark:hover:bg-violet-400/15 hover:border-violet-500/30 dark:hover:border-violet-400/35 hover:translate-x-0.5">
        <span class="text-2xl shrink-0">🔗</span>
        <div class="flex flex-col gap-0.5 flex-1">
          <span class="text-[0.9375rem] font-semibold text-gray-800 dark:text-gray-100">GitHub Repository</span>
          <span class="text-xs text-gray-500 dark:text-gray-400">Source code and development</span>
        </div>
      </a>
    </div>
  </div>

  <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-100 mt-8 mb-4">Agent Settings</h3>

  <!-- Reflector Content Mode -->
  <div class="setting-group">
    <label class="setting-label">Idle Thoughts Content</label>
    <div class="flex flex-col gap-2">
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0 mb-3">
        Controls what content agents (reflector, curiosity, etc.) reflect on when generating idle thoughts and inner dialogue.
      </p>
      <select
        class="select-field"
        bind:value={reflectorContentMode}
        on:change={handleReflectorContentModeChange}
        disabled={reflectorContentModeLoading || reflectorContentModeSaving}
      >
        {#each Object.entries(contentModeOptions) as [mode, description]}
          <option value={mode}>{mode === 'user' ? '👤' : mode === 'agent' ? '🤖' : '📄'} {mode.charAt(0).toUpperCase() + mode.slice(1)}</option>
        {/each}
      </select>
      <p class="text-[0.8125rem] text-gray-500 dark:text-gray-400 m-0 mt-2 p-2 bg-violet-500/5 dark:bg-violet-400/10 rounded border-l-[3px] border-violet-600 dark:border-violet-400">
        {contentModeOptions[reflectorContentMode]}
      </p>
      {#if reflectorContentModeSaving}
        <p class="text-xs text-violet-600 dark:text-violet-400 m-0 mt-2 italic">Saving...</p>
      {/if}
    </div>
  </div>

  <!-- Index Content Mode -->
  <div class="setting-group">
    <label class="setting-label">Memory Search Index</label>
    <div class="flex flex-col gap-2">
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0 mb-3">
        Controls what content is included in the semantic search index. Affects what memories can be found when searching.
      </p>
      <select
        class="select-field"
        bind:value={indexContentMode}
        on:change={handleIndexContentModeChange}
        disabled={indexContentModeLoading || indexContentModeSaving}
      >
        {#each Object.entries(indexContentModeOptions) as [mode, description]}
          <option value={mode}>{mode === 'user' ? '👤' : mode === 'agent' ? '🤖' : '📄'} {mode.charAt(0).toUpperCase() + mode.slice(1)}</option>
        {/each}
      </select>
      <p class="text-[0.8125rem] text-gray-500 dark:text-gray-400 m-0 mt-2 p-2 bg-violet-500/5 dark:bg-violet-400/10 rounded border-l-[3px] border-violet-600 dark:border-violet-400">
        {indexContentModeOptions[indexContentMode]}
      </p>
      {#if indexContentModeSaving}
        <p class="text-xs text-violet-600 dark:text-violet-400 m-0 mt-2 italic">Saving...</p>
      {/if}
      <p class="text-xs text-gray-400 dark:text-gray-500 m-0 mt-2 italic">
        Note: Changes require rebuilding the index to take effect.
      </p>
    </div>
  </div>

  <!-- Active Operator Settings -->
  <ActiveOperatorSettings />

  <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-100 mt-8 mb-4">Developer Settings</h3>

  <!-- Node Pipeline Toggle -->
  <div class="setting-group">
    <label class="setting-label">Node Pipeline</label>
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="setting-label">
          {#if nodePipelineLocked}
            Locked by environment
          {:else}
            Toggle graph executor
          {/if}
        </span>
        <label
          class="toggle-switch"
          for="node-pipeline-toggle"
          aria-label="Toggle cognitive node pipeline"
        >
          <input
            id="node-pipeline-toggle"
            type="checkbox"
            bind:checked={nodePipelineEnabled}
            disabled={nodePipelineLocked || nodePipelineLoading || nodePipelineSaving}
            on:change={handleNodePipelineToggle}
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0">
        {#if nodePipelineLocked}
          Node pipeline controlled by server environment. Contact an administrator to change it.
        {:else if nodePipelineEnabled}
          Node pipeline preference is enabled. Current chat flow uses cognitive graphs.
        {:else}
          Node pipeline preference is disabled. Current chat flow still uses cognitive graphs.
        {/if}
      </p>
    </div>
  </div>

  <!-- Audit Logging Control -->
  <div class="setting-group mt-6">
    <label class="setting-label">Audit Logging</label>
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="setting-label">Enable detailed activity logs</span>
        <label
          class="toggle-switch"
          for="audit-logging-toggle"
          aria-label="Toggle audit logging"
        >
          <input
            id="audit-logging-toggle"
            type="checkbox"
            bind:checked={auditLoggingEnabled}
            disabled={auditLoggingLoading || auditLoggingSaving}
            on:change={handleAuditLoggingToggle}
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0">
        {#if auditLoggingEnabled}
          ⚠️ Audit logging is ON. This creates large log files (24MB+/day) and causes 100% CPU when viewing Agent Monitor. Disable for better performance.
        {:else}
          ✓ Audit logging is OFF. System runs smoothly. Enable only when debugging issues.
        {/if}
      </p>
      <div class="mt-2">
        <button
          class="btn-secondary btn-sm"
          on:click={purgeOldAuditLogs}
          disabled={auditLoggingSaving}
        >
          🗑️ Purge Logs Older Than 7 Days
        </button>
      </div>
    </div>
  </div>

  <!-- Embedding Model Control -->
  <div class="setting-group mt-6">
    <label class="setting-label">Embedding Model (Semantic Memory)</label>
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="setting-label">Enable semantic memory search</span>
        <label
          class="toggle-switch"
          for="embedding-toggle"
          aria-label="Toggle embedding model"
        >
          <input
            id="embedding-toggle"
            type="checkbox"
            bind:checked={embeddingEnabled}
            disabled={embeddingLoading || embeddingSaving}
            on:change={handleEmbeddingToggle}
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0">
        {#if embeddingEnabled}
          ✓ Semantic search is ON. The "{embeddingModel}" model enables memory-based conversations.
        {:else}
          ⚠️ Semantic search is OFF. Conversations will use basic keyword search only.
        {/if}
      </p>

      {#if embeddingEnabled}
        <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div class="flex items-center justify-between">
            <span class="setting-label">Preload model at startup</span>
            <label
              class="toggle-switch"
              for="embedding-preload-toggle"
              aria-label="Toggle preload at startup"
            >
              <input
                id="embedding-preload-toggle"
                type="checkbox"
                bind:checked={embeddingPreload}
                disabled={embeddingLoading || embeddingSaving}
                on:change={handleEmbeddingPreloadToggle}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <p class="text-[0.85rem] text-gray-500 dark:text-gray-400 m-0 mt-2">
            {#if embeddingPreload}
              ✓ Model will load automatically on system startup (keeps it in memory)
            {:else}
              Model will load on-demand when needed (may cause delays on first use)
            {/if}
          </p>
        </div>

        <div class="mt-3">
          <button
            class="btn-secondary btn-sm"
            on:click={preloadEmbeddingNow}
            disabled={embeddingSaving}
          >
            🔄 Load Model Now
          </button>
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Current model: <strong>{embeddingModel}</strong> (~791MB VRAM)
          </p>
        </div>
      {/if}
    </div>
  </div>

  <!-- Active Model Info -->
  {#if modelInfo}
    <div class="setting-group">
      <label class="setting-label">Active Model Info</label>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-key">Base Model:</span>
          <span class="info-value font-mono">{modelInfo.activeModel}</span>
        </div>
        {#if modelInfo.adapter2}
          <div class="info-item">
            <span class="info-key">📚 Historical:</span>
            <span class="info-value text-violet-600 dark:text-violet-400 font-semibold">history-merged</span>
          </div>
          <div class="info-item">
            <span class="info-key">🆕 Recent:</span>
            <span class="info-value text-violet-600 dark:text-violet-400 font-semibold">
              {modelInfo.adapter.dataset}
              {#if modelInfo.adapter.evalScore}
                <span class="text-xs text-emerald-500 dark:text-emerald-400 ml-1">({(modelInfo.adapter.evalScore * 100).toFixed(0)}%)</span>
              {/if}
            </span>
          </div>
        {:else if modelInfo.adapter}
          <div class="info-item">
            <span class="info-key">LoRA Adapter:</span>
            <span class="info-value text-violet-600 dark:text-violet-400 font-semibold">
              {modelInfo.adapter.dataset}
              {#if modelInfo.adapter.evalScore}
                <span class="text-xs text-emerald-500 dark:text-emerald-400 ml-1">({(modelInfo.adapter.evalScore * 100).toFixed(0)}%)</span>
              {/if}
            </span>
          </div>
        {:else}
          <div class="info-item">
            <span class="info-key">LoRA Adapter:</span>
            <span class="info-value text-gray-400 dark:text-gray-500">None</span>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="setting-group">
      <label class="setting-label">Active Model Info</label>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-key">Status:</span>
          <span class="info-value text-gray-400 dark:text-gray-500">Unavailable</span>
        </div>
      </div>
    </div>
  {/if}

  <!-- LoRA Enable/Disable Toggle -->
  <div class="setting-group">
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="setting-label">LoRA Adapters</span>
        <label class="toggle-switch" for="lora-toggle-input" aria-label="Enable LoRA Adapters">
          <input
            id="lora-toggle-input"
            type="checkbox"
            bind:checked={loraEnabled}
            on:change={toggleLora}
            disabled={loraToggling}
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0">
        {loraEnabled ? 'LoRA adapters enabled - personalized responses active' : 'LoRA adapters disabled - using base model only'}
      </p>
    </div>
  </div>

  <!-- Adapter Selector -->
  {#if loraDatasets.length > 0 && loraEnabled}
    <div class="setting-group">
      <label class="setting-label" for="adapter-selector">Switch Adapter</label>
      <div id="adapter-selector" class="flex gap-2 items-center flex-wrap">
        <select class="select-field flex-1 min-w-[200px]" on:change={handleLoraSelect} disabled={selecting}>
          <option value="">Select adapter to load...</option>
          {#each loraDatasets as d}
            <option value={d.date}>{d.date} {d.evalScore ? `(${(d.evalScore * 100).toFixed(0)}%)` : ''}</option>
          {/each}
        </select>
        {#if dualAvailable}
          <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer" for="dual-mode-checkbox">
            <input id="dual-mode-checkbox" type="checkbox" bind:checked={dualEnabled} class="cursor-pointer accent-violet-600" />
            <span>Dual Mode</span>
          </label>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Logging Configuration -->
  <div class="setting-group">
    <label class="setting-label">Logging Configuration</label>
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label for="log-level-select" class="text-sm font-medium text-gray-600 dark:text-gray-400">Log Level</label>
        <select id="log-level-select" bind:value={logLevel} class="select-field">
          <option value="error">Error</option>
          <option value="warn">Warning</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label for="slow-threshold-input" class="text-sm font-medium text-gray-600 dark:text-gray-400">Slow Request Threshold (ms)</label>
        <input id="slow-threshold-input" type="number" min="100" max="10000" step="100" bind:value={slowRequestThresholdMs} class="input-field" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="suppress-patterns-input" class="text-sm font-medium text-gray-600 dark:text-gray-400">Suppress Patterns (comma-separated)</label>
        <input id="suppress-patterns-input" type="text" bind:value={suppressPatterns} placeholder="/api/status, /api/monitor" class="input-field" />
      </div>

      <div class="flex flex-col gap-2">
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" bind:checked={logColorize} class="cursor-pointer accent-violet-600" />
          <span>Colorize output</span>
        </label>
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" bind:checked={logTimestamp} class="cursor-pointer accent-violet-600" />
          <span>Show timestamps</span>
        </label>
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" bind:checked={logSlowRequests} class="cursor-pointer accent-violet-600" />
          <span>Log slow requests</span>
        </label>
      </div>

      <button class="btn-primary" on:click={saveLoggingConfig} disabled={savingLogging}>
        {savingLogging ? 'Saving...' : 'Save Logging Config'}
      </button>
    </div>
  </div>

  <!-- GPU Monitoring -->
  <div class="setting-group">
    <label class="setting-label">GPU Memory Status</label>
    <GPUMonitor />
  </div>

  <!-- File Path Manager -->
  <div class="setting-group mt-6">
    <div class="flex items-center justify-between mb-3">
      <label class="setting-label">File Path Manager</label>
      <button
        class="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-pointer text-base transition-all hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        on:click={refreshStorageStatus}
        disabled={storageLoading}
        title="Refresh storage status"
      >
        {storageLoading ? '...' : '↻'}
      </button>
    </div>

    {#if storageLoading && !storageStatus}
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0">Loading storage status...</p>
    {:else if storageStatus && !storageStatus.authenticated}
      <div class="flex items-center gap-2 p-3 rounded-md mb-3 bg-amber-500/10 dark:bg-amber-400/10 border border-amber-500/30 dark:border-amber-400/25 text-amber-600 dark:text-amber-400">
        <span>⚠️</span>
        <span>Login required to view storage paths</span>
      </div>
    {:else if storageStatus}
      <!-- Storage Status Summary -->
      <div class="flex gap-2 flex-wrap mb-4">
        <div class="inline-flex items-center px-2 py-1 rounded text-xs font-medium {storageStatus.status?.available ? 'bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 dark:bg-red-400/15 text-red-600 dark:text-red-400'}">
          {storageStatus.status?.available ? '✓ Available' : '✗ Unavailable'}
        </div>
        <div class="inline-flex items-center px-2 py-1 rounded text-xs bg-violet-500/10 dark:bg-violet-400/15 text-violet-700 dark:text-violet-400">
          {#if storageStatus.status?.type === 'external'}
            💾 External
          {:else if storageStatus.status?.type === 'network'}
            🌐 Network
          {:else}
            📁 Internal
          {/if}
        </div>
        {#if storageStatus.status?.configured}
          <span class="inline-flex items-center px-2 py-1 rounded text-xs bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-400">Custom</span>
        {:else}
          <span class="inline-flex items-center px-2 py-1 rounded text-xs bg-gray-500/10 dark:bg-gray-400/15 text-gray-600 dark:text-gray-400">Default</span>
        {/if}
      </div>

      {#if storageStatus.status?.error}
        <div class="flex items-center gap-2 p-3 rounded-md mb-3 bg-red-500/10 dark:bg-red-400/10 border border-red-500/30 dark:border-red-400/25 text-red-600 dark:text-red-400 text-sm">
          <span>⚠️</span>
          <span>{storageStatus.status.error}</span>
        </div>
      {/if}

      <!-- Profile Root -->
      <div class="flex flex-col gap-1 mb-4 p-3 bg-violet-500/5 dark:bg-violet-400/10 rounded-md border border-violet-500/15 dark:border-violet-400/20">
        <span class="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">Profile Root</span>
        <code class="font-mono text-[0.8125rem] text-gray-700 dark:text-gray-200 break-all">{storageStatus.status?.path || 'Not configured'}</code>
      </div>

      <!-- Storage Paths by Category -->
      {#if storageStatus.paths}
        <div class="grid grid-cols-[auto_1fr] gap-3 gap-x-4 mb-4">
          <div class="flex items-start gap-1.5 pt-1">
            <span class="text-base">🧠</span>
            <span class="text-[0.8125rem] font-semibold text-gray-700 dark:text-gray-300">Memory</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-gray-500 dark:text-gray-400">Episodic:</span>
              <code class="font-mono text-xs text-gray-600 dark:text-gray-300 break-all bg-black/5 dark:bg-white/5 px-1.5 py-1 rounded {!storageStatus.paths.episodic?.available ? 'text-gray-400 dark:text-gray-500 bg-red-500/5 dark:bg-red-400/5' : ''}">{storageStatus.paths.episodic?.path || 'N/A'}</code>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-gray-500 dark:text-gray-400">Procedural:</span>
              <code class="font-mono text-xs text-gray-600 dark:text-gray-300 break-all bg-black/5 dark:bg-white/5 px-1.5 py-1 rounded {!storageStatus.paths.procedural?.available ? 'text-gray-400 dark:text-gray-500 bg-red-500/5 dark:bg-red-400/5' : ''}">{storageStatus.paths.procedural?.path || 'N/A'}</code>
            </div>
          </div>

          <div class="flex items-start gap-1.5 pt-1">
            <span class="text-base">⚙️</span>
            <span class="text-[0.8125rem] font-semibold text-gray-700 dark:text-gray-300">Config</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-gray-500 dark:text-gray-400">Persona:</span>
              <code class="font-mono text-xs text-gray-600 dark:text-gray-300 break-all bg-black/5 dark:bg-white/5 px-1.5 py-1 rounded {!storageStatus.paths.persona?.available ? 'text-gray-400 dark:text-gray-500 bg-red-500/5 dark:bg-red-400/5' : ''}">{storageStatus.paths.persona?.path || 'N/A'}</code>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-gray-500 dark:text-gray-400">Settings:</span>
              <code class="font-mono text-xs text-gray-600 dark:text-gray-300 break-all bg-black/5 dark:bg-white/5 px-1.5 py-1 rounded {!storageStatus.paths.etc?.available ? 'text-gray-400 dark:text-gray-500 bg-red-500/5 dark:bg-red-400/5' : ''}">{storageStatus.paths.etc?.path || 'N/A'}</code>
            </div>
          </div>

          <div class="flex items-start gap-1.5 pt-1">
            <span class="text-base">🎤</span>
            <span class="text-[0.8125rem] font-semibold text-gray-700 dark:text-gray-300">Voice</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-gray-500 dark:text-gray-400">Training:</span>
              <code class="font-mono text-xs text-gray-600 dark:text-gray-300 break-all bg-black/5 dark:bg-white/5 px-1.5 py-1 rounded {!storageStatus.paths.voice?.available ? 'text-gray-400 dark:text-gray-500 bg-red-500/5 dark:bg-red-400/5' : ''}">{storageStatus.paths.voice?.path || 'N/A'}</code>
            </div>
          </div>

          <div class="flex items-start gap-1.5 pt-1">
            <span class="text-base">📊</span>
            <span class="text-[0.8125rem] font-semibold text-gray-700 dark:text-gray-300">Training</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-gray-500 dark:text-gray-400">Data:</span>
              <code class="font-mono text-xs text-gray-600 dark:text-gray-300 break-all bg-black/5 dark:bg-white/5 px-1.5 py-1 rounded {!storageStatus.paths.training?.available ? 'text-gray-400 dark:text-gray-500 bg-red-500/5 dark:bg-red-400/5' : ''}">{storageStatus.paths.training?.path || 'N/A'}</code>
            </div>
          </div>

          <div class="flex items-start gap-1.5 pt-1">
            <span class="text-base">📤</span>
            <span class="text-[0.8125rem] font-semibold text-gray-700 dark:text-gray-300">Output</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-gray-500 dark:text-gray-400">Artifacts:</span>
              <code class="font-mono text-xs text-gray-600 dark:text-gray-300 break-all bg-black/5 dark:bg-white/5 px-1.5 py-1 rounded {!storageStatus.paths.output?.available ? 'text-gray-400 dark:text-gray-500 bg-red-500/5 dark:bg-red-400/5' : ''}">{storageStatus.paths.output?.path || 'N/A'}</code>
            </div>
          </div>
        </div>
      {/if}

      <p class="text-[0.8125rem] text-gray-500 dark:text-gray-400 m-0">
        Configure custom storage locations in the <strong class="text-gray-600 dark:text-gray-300">Storage</strong> tab.
      </p>
    {:else}
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0">Unable to load storage status</p>
    {/if}
  </div>

  <!-- System Info -->
  <div class="setting-group">
    <label class="setting-label" for="system-info-grid">System Info</label>
    <div id="system-info-grid" class="info-grid">
      <div class="info-item">
        <span class="info-key">Phase:</span>
        <span class="info-value">1 (Intelligence & Autonomy)</span>
      </div>
      <div class="info-item">
        <span class="info-key">Version:</span>
        <span class="info-value">0.1.0</span>
      </div>
    </div>
  </div>
</div>

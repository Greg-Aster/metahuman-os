<script lang="ts">
  import { onMount } from 'svelte';
  import GPUMonitor from './GPUMonitor.svelte';
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

  onMount(async () => {
    loadWelcomeModalSetting();
    loadModelInfo();
    loadLoraState();
    loadLoggingConfig();
    loadAuditLoggingState();
    loadNodePipelineState();
    loadEmbeddingConfig();
    loadStorageStatus();
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
      loraEnabled = !loraEnabled; // Revert on error
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
</script>

<div class="system-settings">
  <!-- Welcome Modal Toggle -->
  <div class="setting-group">
    <div class="lora-toggle-container">
      <div class="lora-toggle-header">
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
      <p class="lora-toggle-description">
        {showWelcomeModal ? 'Welcome screen will appear on next startup' : 'Welcome screen disabled'}
      </p>
    </div>
  </div>

  <!-- Resources Section -->
  <div class="setting-group">
    <label class="setting-label">Resources</label>
    <div class="resources-container">
      <a href="/user-guide" class="resource-link">
        <span class="resource-icon">📖</span>
        <div class="resource-content">
          <span class="resource-title">User Guide</span>
          <span class="resource-description">Complete documentation and manual</span>
        </div>
      </a>
      <a href="https://github.com/gregjacobs/metahuman" target="_blank" rel="noopener noreferrer" class="resource-link">
        <span class="resource-icon">🔗</span>
        <div class="resource-content">
          <span class="resource-title">GitHub Repository</span>
          <span class="resource-description">Source code and development</span>
        </div>
      </a>
    </div>
  </div>

  <h3 class="section-title" style="margin-top: 2rem;">Developer Settings</h3>

  <!-- Node Pipeline Toggle -->
  <div class="setting-group">
    <label class="setting-label">Node Pipeline</label>
    <div class="lora-toggle-container">
      <div class="lora-toggle-header">
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
      <p class="lora-toggle-description">
        {#if nodePipelineLocked}
          Node pipeline controlled by server environment. Contact an administrator to change it.
        {:else if nodePipelineEnabled}
          Graph executor is active. Chats will use the node-based cognitive pipeline.
        {:else}
          Legacy pipeline is active. Enable to route chats through the node graph.
        {/if}
      </p>
    </div>
  </div>

  <!-- Audit Logging Control -->
  <div class="setting-group" style="margin-top: 1.5rem;">
    <label class="setting-label">Audit Logging</label>
    <div class="lora-toggle-container">
      <div class="lora-toggle-header">
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
      <p class="lora-toggle-description">
        {#if auditLoggingEnabled}
          ⚠️ Audit logging is ON. This creates large log files (24MB+/day) and causes 100% CPU when viewing Agent Monitor. Disable for better performance.
        {:else}
          ✓ Audit logging is OFF. System runs smoothly. Enable only when debugging issues.
        {/if}
      </p>
      <div style="margin-top: 0.5rem;">
        <button
          class="action-button"
          on:click={purgeOldAuditLogs}
          disabled={auditLoggingSaving}
          style="padding: 0.4rem 0.8rem; font-size: 0.85rem;"
        >
          🗑️ Purge Logs Older Than 7 Days
        </button>
      </div>
    </div>
  </div>

  <!-- Embedding Model Control -->
  <div class="setting-group" style="margin-top: 1.5rem;">
    <label class="setting-label">Embedding Model (Semantic Memory)</label>
    <div class="lora-toggle-container">
      <div class="lora-toggle-header">
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
      <p class="lora-toggle-description">
        {#if embeddingEnabled}
          ✓ Semantic search is ON. The "{embeddingModel}" model enables memory-based conversations.
        {:else}
          ⚠️ Semantic search is OFF. Conversations will use basic keyword search only.
        {/if}
      </p>

      {#if embeddingEnabled}
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color, #333);">
          <div class="lora-toggle-header">
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
          <p class="lora-toggle-description" style="font-size: 0.85rem; margin-top: 0.5rem;">
            {#if embeddingPreload}
              ✓ Model will load automatically on system startup (keeps it in memory)
            {:else}
              Model will load on-demand when needed (may cause delays on first use)
            {/if}
          </p>
        </div>

        <div style="margin-top: 0.75rem;">
          <button
            class="action-button"
            on:click={preloadEmbeddingNow}
            disabled={embeddingSaving}
            style="padding: 0.4rem 0.8rem; font-size: 0.85rem;"
          >
            🔄 Load Model Now
          </button>
          <p style="font-size: 0.8rem; color: var(--text-muted, #999); margin-top: 0.3rem;">
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
          <span class="info-value model-mono">{modelInfo.activeModel}</span>
        </div>
        {#if modelInfo.adapter2}
          <!-- Dual-adapter mode -->
          <div class="info-item">
            <span class="info-key">📚 Historical:</span>
            <span class="info-value adapter-highlight">history-merged</span>
          </div>
          <div class="info-item">
            <span class="info-key">🆕 Recent:</span>
            <span class="info-value adapter-highlight">
              {modelInfo.adapter.dataset}
              {#if modelInfo.adapter.evalScore}
                <span class="adapter-score">({(modelInfo.adapter.evalScore * 100).toFixed(0)}%)</span>
              {/if}
            </span>
          </div>
        {:else if modelInfo.adapter}
          <!-- Single adapter -->
          <div class="info-item">
            <span class="info-key">LoRA Adapter:</span>
            <span class="info-value adapter-highlight">
              {modelInfo.adapter.dataset}
              {#if modelInfo.adapter.evalScore}
                <span class="adapter-score">({(modelInfo.adapter.evalScore * 100).toFixed(0)}%)</span>
              {/if}
            </span>
          </div>
        {:else}
          <div class="info-item">
            <span class="info-key">LoRA Adapter:</span>
            <span class="info-value muted-value">None</span>
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
          <span class="info-value muted-value">Unavailable</span>
        </div>
      </div>
    </div>
  {/if}

  <!-- LoRA Enable/Disable Toggle -->
  <div class="setting-group">
    <div class="lora-toggle-container">
      <div class="lora-toggle-header">
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
      <p class="lora-toggle-description">
        {loraEnabled ? 'LoRA adapters enabled - personalized responses active' : 'LoRA adapters disabled - using base model only'}
      </p>
    </div>
  </div>

  <!-- Adapter Selector -->
  {#if loraDatasets.length > 0 && loraEnabled}
    <div class="setting-group">
      <label class="setting-label" for="adapter-selector">Switch Adapter</label>
      <div id="adapter-selector" class="adapter-controls">
        <select class="adapter-select" on:change={handleLoraSelect} disabled={selecting}>
          <option value="">Select adapter to load...</option>
          {#each loraDatasets as d}
            <option value={d.date}>{d.date} {d.evalScore ? `(${(d.evalScore * 100).toFixed(0)}%)` : ''}</option>
          {/each}
        </select>
        {#if dualAvailable}
          <label class="dual-toggle-label" for="dual-mode-checkbox">
            <input id="dual-mode-checkbox" type="checkbox" bind:checked={dualEnabled} class="dual-checkbox" />
            <span>Dual Mode</span>
          </label>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Logging Configuration -->
  <div class="setting-group">
    <label class="setting-label">Logging Configuration</label>
    <div class="logging-config-container">
      <div class="logging-field">
        <label for="log-level-select" class="field-label">Log Level</label>
        <select id="log-level-select" bind:value={logLevel} class="logging-select">
          <option value="error">Error</option>
          <option value="warn">Warning</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
      </div>

      <div class="logging-field">
        <label for="slow-threshold-input" class="field-label">Slow Request Threshold (ms)</label>
        <input id="slow-threshold-input" type="number" min="100" max="10000" step="100" bind:value={slowRequestThresholdMs} class="logging-input" />
      </div>

      <div class="logging-field">
        <label for="suppress-patterns-input" class="field-label">Suppress Patterns (comma-separated)</label>
        <input id="suppress-patterns-input" type="text" bind:value={suppressPatterns} placeholder="/api/status, /api/monitor" class="logging-input" />
      </div>

      <div class="logging-checkboxes">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={logColorize} />
          <span>Colorize output</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={logTimestamp} />
          <span>Show timestamps</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={logSlowRequests} />
          <span>Log slow requests</span>
        </label>
      </div>

      <button class="save-logging-button" on:click={saveLoggingConfig} disabled={savingLogging}>
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
  <div class="setting-group" style="margin-top: 1.5rem;">
    <div class="path-manager-header">
      <label class="setting-label">File Path Manager</label>
      <button
        class="refresh-button"
        on:click={refreshStorageStatus}
        disabled={storageLoading}
        title="Refresh storage status"
      >
        {storageLoading ? '...' : '↻'}
      </button>
    </div>

    {#if storageLoading && !storageStatus}
      <p class="lora-toggle-description">Loading storage status...</p>
    {:else if storageStatus && !storageStatus.authenticated}
      <div class="storage-warning">
        <span class="warning-icon">⚠️</span>
        <span>Login required to view storage paths</span>
      </div>
    {:else if storageStatus}
      <!-- Storage Status Summary -->
      <div class="storage-summary">
        <div class="storage-status-badge" class:available={storageStatus.status?.available} class:unavailable={!storageStatus.status?.available}>
          {storageStatus.status?.available ? '✓ Available' : '✗ Unavailable'}
        </div>
        <div class="storage-type-badge">
          {#if storageStatus.status?.type === 'external'}
            💾 External
          {:else if storageStatus.status?.type === 'network'}
            🌐 Network
          {:else}
            📁 Internal
          {/if}
        </div>
        {#if storageStatus.status?.configured}
          <span class="storage-configured-badge">Custom</span>
        {:else}
          <span class="storage-default-badge">Default</span>
        {/if}
      </div>

      {#if storageStatus.status?.error}
        <div class="storage-error">
          <span class="error-icon">⚠️</span>
          <span>{storageStatus.status.error}</span>
        </div>
      {/if}

      <!-- Profile Root -->
      <div class="path-item">
        <span class="path-label">Profile Root</span>
        <code class="path-value">{storageStatus.status?.path || 'Not configured'}</code>
      </div>

      <!-- Storage Paths by Category -->
      {#if storageStatus.paths}
        <div class="paths-grid">
          <div class="path-category">
            <span class="category-icon">🧠</span>
            <span class="category-label">Memory</span>
          </div>
          <div class="path-details">
            <div class="path-row">
              <span class="path-sublabel">Episodic:</span>
              <code class="path-code" class:unavailable={!storageStatus.paths.episodic?.available}>
                {storageStatus.paths.episodic?.path || 'N/A'}
              </code>
            </div>
            <div class="path-row">
              <span class="path-sublabel">Procedural:</span>
              <code class="path-code" class:unavailable={!storageStatus.paths.procedural?.available}>
                {storageStatus.paths.procedural?.path || 'N/A'}
              </code>
            </div>
          </div>

          <div class="path-category">
            <span class="category-icon">⚙️</span>
            <span class="category-label">Config</span>
          </div>
          <div class="path-details">
            <div class="path-row">
              <span class="path-sublabel">Persona:</span>
              <code class="path-code" class:unavailable={!storageStatus.paths.persona?.available}>
                {storageStatus.paths.persona?.path || 'N/A'}
              </code>
            </div>
            <div class="path-row">
              <span class="path-sublabel">Settings:</span>
              <code class="path-code" class:unavailable={!storageStatus.paths.etc?.available}>
                {storageStatus.paths.etc?.path || 'N/A'}
              </code>
            </div>
          </div>

          <div class="path-category">
            <span class="category-icon">🎤</span>
            <span class="category-label">Voice</span>
          </div>
          <div class="path-details">
            <div class="path-row">
              <span class="path-sublabel">Training:</span>
              <code class="path-code" class:unavailable={!storageStatus.paths.voice?.available}>
                {storageStatus.paths.voice?.path || 'N/A'}
              </code>
            </div>
          </div>

          <div class="path-category">
            <span class="category-icon">📊</span>
            <span class="category-label">Training</span>
          </div>
          <div class="path-details">
            <div class="path-row">
              <span class="path-sublabel">Data:</span>
              <code class="path-code" class:unavailable={!storageStatus.paths.training?.available}>
                {storageStatus.paths.training?.path || 'N/A'}
              </code>
            </div>
          </div>

          <div class="path-category">
            <span class="category-icon">📤</span>
            <span class="category-label">Output</span>
          </div>
          <div class="path-details">
            <div class="path-row">
              <span class="path-sublabel">Artifacts:</span>
              <code class="path-code" class:unavailable={!storageStatus.paths.output?.available}>
                {storageStatus.paths.output?.path || 'N/A'}
              </code>
            </div>
          </div>
        </div>
      {/if}

      <p class="storage-hint">
        Configure custom storage locations in the <strong>Storage</strong> tab.
      </p>
    {:else}
      <p class="lora-toggle-description">Unable to load storage status</p>
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

<style>
  .system-settings {
    width: 100%;
  }

  .section-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #1f2937;
    margin: 0 0 1rem 0;
  }

  :global(.dark) .section-title {
    color: #f3f4f6;
  }

  .lora-toggle-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .lora-toggle-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .lora-toggle-description {
    font-size: 0.875rem;
    color: #6b7280;
    margin: 0;
  }

  :global(.dark) .lora-toggle-description {
    color: #9ca3af;
  }

  .model-mono {
    font-family: monospace;
  }

  .adapter-highlight {
    color: #7c3aed;
    font-weight: 600;
  }

  :global(.dark) .adapter-highlight {
    color: #a78bfa;
  }

  .adapter-score {
    font-size: 0.75rem;
    color: #10b981;
    margin-left: 0.25rem;
  }

  :global(.dark) .adapter-score {
    color: #34d399;
  }

  .muted-value {
    color: #9ca3af;
  }

  :global(.dark) .muted-value {
    color: #6b7280;
  }

  .adapter-controls {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .adapter-select {
    flex: 1;
    min-width: 200px;
    padding: 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
  }

  :global(.dark) .adapter-select {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  .adapter-select:focus {
    outline: none;
    border-color: #7c3aed;
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }

  .dual-toggle-label {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
    color: #374151;
    cursor: pointer;
  }

  :global(.dark) .dual-toggle-label {
    color: #d1d5db;
  }

  .dual-checkbox {
    cursor: pointer;
  }

  .opt-input {
    width: 100%;
    padding: 0.375rem 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.25rem;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
  }

  :global(.dark) .opt-input {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  .opt-input:focus {
    outline: none;
    border-color: #7c3aed;
    box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.1);
  }

  .logging-config-container {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .logging-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #4b5563;
  }

  :global(.dark) .field-label {
    color: #9ca3af;
  }

  .logging-select,
  .logging-input {
    padding: 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
  }

  :global(.dark) .logging-select,
  :global(.dark) .logging-input {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  .logging-select:focus,
  .logging-input:focus {
    outline: none;
    border-color: #7c3aed;
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }

  .logging-checkboxes {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: #374151;
    cursor: pointer;
  }

  :global(.dark) .checkbox-label {
    color: #d1d5db;
  }

  .checkbox-label input[type="checkbox"] {
    cursor: pointer;
    accent-color: #7c3aed;
  }

  .save-logging-button {
    padding: 0.625rem 1rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    background: #7c3aed;
    color: white;
  }

  .save-logging-button:hover:not(:disabled) {
    background: #6d28d9;
  }

  .save-logging-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Resources Section */
  .resources-container {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .resource-link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem;
    border-radius: 0.5rem;
    background: rgba(124, 58, 237, 0.05);
    border: 1px solid rgba(124, 58, 237, 0.15);
    text-decoration: none;
    color: inherit;
    transition: all 0.2s;
  }

  :global(.dark) .resource-link {
    background: rgba(167, 139, 250, 0.08);
    border-color: rgba(167, 139, 250, 0.2);
  }

  .resource-link:hover {
    background: rgba(124, 58, 237, 0.1);
    border-color: rgba(124, 58, 237, 0.3);
    transform: translateX(2px);
  }

  :global(.dark) .resource-link:hover {
    background: rgba(167, 139, 250, 0.15);
    border-color: rgba(167, 139, 250, 0.35);
  }

  .resource-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .resource-content {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    flex: 1;
  }

  .resource-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: #1f2937;
  }

  :global(.dark) .resource-title {
    color: #f3f4f6;
  }

  .resource-description {
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .resource-description {
    color: #9ca3af;
  }

  /* File Path Manager styles */
  .path-manager-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .refresh-button {
    padding: 0.25rem 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.25rem;
    background: white;
    color: #4b5563;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
  }

  :global(.dark) .refresh-button {
    background: #374151;
    border-color: #4b5563;
    color: #d1d5db;
  }

  .refresh-button:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }

  :global(.dark) .refresh-button:hover:not(:disabled) {
    background: #4b5563;
  }

  .refresh-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .storage-summary {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }

  .storage-status-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .storage-status-badge.available {
    background: rgba(16, 185, 129, 0.1);
    color: #059669;
  }

  :global(.dark) .storage-status-badge.available {
    background: rgba(52, 211, 153, 0.15);
    color: #34d399;
  }

  .storage-status-badge.unavailable {
    background: rgba(239, 68, 68, 0.1);
    color: #dc2626;
  }

  :global(.dark) .storage-status-badge.unavailable {
    background: rgba(248, 113, 113, 0.15);
    color: #f87171;
  }

  .storage-type-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    background: rgba(124, 58, 237, 0.1);
    color: #6d28d9;
  }

  :global(.dark) .storage-type-badge {
    background: rgba(167, 139, 250, 0.15);
    color: #a78bfa;
  }

  .storage-configured-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    background: rgba(59, 130, 246, 0.1);
    color: #2563eb;
  }

  :global(.dark) .storage-configured-badge {
    background: rgba(96, 165, 250, 0.15);
    color: #60a5fa;
  }

  .storage-default-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    background: rgba(107, 114, 128, 0.1);
    color: #4b5563;
  }

  :global(.dark) .storage-default-badge {
    background: rgba(156, 163, 175, 0.15);
    color: #9ca3af;
  }

  .storage-warning,
  .storage-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 0.375rem;
    margin-bottom: 0.75rem;
  }

  .storage-warning {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: #d97706;
  }

  :global(.dark) .storage-warning {
    background: rgba(251, 191, 36, 0.1);
    border-color: rgba(251, 191, 36, 0.25);
    color: #fbbf24;
  }

  .storage-error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #dc2626;
    font-size: 0.875rem;
  }

  :global(.dark) .storage-error {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.25);
    color: #f87171;
  }

  .path-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: rgba(124, 58, 237, 0.05);
    border-radius: 0.375rem;
    border: 1px solid rgba(124, 58, 237, 0.15);
  }

  :global(.dark) .path-item {
    background: rgba(167, 139, 250, 0.08);
    border-color: rgba(167, 139, 250, 0.2);
  }

  .path-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6d28d9;
  }

  :global(.dark) .path-label {
    color: #a78bfa;
  }

  .path-value {
    font-family: monospace;
    font-size: 0.8125rem;
    color: #374151;
    word-break: break-all;
    background: transparent;
    padding: 0;
  }

  :global(.dark) .path-value {
    color: #e5e7eb;
  }

  .paths-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem 1rem;
    margin-bottom: 1rem;
  }

  .path-category {
    display: flex;
    align-items: flex-start;
    gap: 0.375rem;
    padding-top: 0.25rem;
  }

  .category-icon {
    font-size: 1rem;
  }

  .category-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .category-label {
    color: #d1d5db;
  }

  .path-details {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .path-row {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .path-sublabel {
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .path-sublabel {
    color: #9ca3af;
  }

  .path-code {
    font-family: monospace;
    font-size: 0.75rem;
    color: #4b5563;
    word-break: break-all;
    background: rgba(0, 0, 0, 0.03);
    padding: 0.25rem 0.375rem;
    border-radius: 0.25rem;
  }

  :global(.dark) .path-code {
    color: #d1d5db;
    background: rgba(255, 255, 255, 0.05);
  }

  .path-code.unavailable {
    color: #9ca3af;
    background: rgba(239, 68, 68, 0.05);
  }

  :global(.dark) .path-code.unavailable {
    color: #6b7280;
    background: rgba(248, 113, 113, 0.05);
  }

  .storage-hint {
    font-size: 0.8125rem;
    color: #6b7280;
    margin: 0;
  }

  :global(.dark) .storage-hint {
    color: #9ca3af;
  }

  .storage-hint strong {
    color: #4b5563;
  }

  :global(.dark) .storage-hint strong {
    color: #d1d5db;
  }
</style>

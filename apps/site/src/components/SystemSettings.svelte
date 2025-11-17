<script lang="ts">
  import { onMount } from 'svelte';
  import BoredomControl from './BoredomControl.svelte';
  import AddonsManager from './AddonsManager.svelte';
  import GPUMonitor from './GPUMonitor.svelte';

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

  // Factory reset
  let resettingFactory = false;

  // Curiosity config
  let curiosityLevel = 1;
  let curiosityResearchMode: 'off' | 'local' | 'web' = 'local';

  const curiosityLevelDescriptions = [
    'Curiosity disabled - no questions will be asked',
    'Gentle - Questions after 60 minutes of conversation inactivity',
    'Moderate - Questions after 30 minutes of conversation inactivity',
    'Active - Questions after 15 minutes of conversation inactivity',
    'Chatty - Questions after 5 minutes of conversation inactivity',
    'Very Active - Questions after 2 minutes of conversation inactivity',
    'Intense - Questions after 1 minute of conversation inactivity'
  ];

  // Map curiosity levels to intervals (in seconds)
  const curiosityIntervals = [
    0,     // Level 0: Off
    3600,  // Level 1: 60 minutes
    1800,  // Level 2: 30 minutes
    900,   // Level 3: 15 minutes
    300,   // Level 4: 5 minutes
    120,   // Level 5: 2 minutes
    60     // Level 6: 1 minute
  ];

  onMount(async () => {
    loadWelcomeModalSetting();
    loadModelInfo();
    loadLoraState();
    loadLoggingConfig();
    loadCuriositySettings();
  });

  function loadWelcomeModalSetting() {
    const stored = localStorage.getItem('showWelcomeModal');
    showWelcomeModal = stored === null ? true : stored === 'true';
  }

  function toggleWelcomeModal() {
    localStorage.setItem('showWelcomeModal', String(showWelcomeModal));
  }

  async function loadModelInfo() {
    try {
      const res = await fetch('/api/model-info');
      if (res.ok) {
        modelInfo = await res.json();
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading model info:', err);
    }
  }

  async function loadLoraState() {
    try {
      const res = await fetch('/api/lora-state');
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
      const res = await fetch('/api/lora-toggle', {
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
      const res = await fetch('/api/lora-select', {
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

      const res = await fetch('/api/logging-config', {
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

  async function loadCuriositySettings() {
    try {
      const res = await fetch('/api/curiosity-config');
      if (res.ok) {
        const data = await res.json();
        curiosityLevel = data.maxOpenQuestions;
        curiosityResearchMode = data.researchMode || 'local';
      }
    } catch (err) {
      console.error('[SystemSettings] Error loading curiosity config:', err);
    }
  }

  async function saveCuriositySettings() {
    try {
      const res = await fetch('/api/curiosity-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxOpenQuestions: curiosityLevel,
          researchMode: curiosityResearchMode,
          questionIntervalSeconds: curiosityIntervals[curiosityLevel]
        })
      });
      if (!res.ok) throw new Error('Failed to save curiosity settings');
    } catch (err) {
      console.error('[SystemSettings] Error saving curiosity config:', err);
    }
  }

  async function resetFactorySettings() {
    if (resettingFactory) return;
    const confirmed = window.confirm('This will erase all memories, logs, and conversations, and restore factory defaults. This action cannot be undone. Continue?');
    if (!confirmed) return;

    resettingFactory = true;
    try {
      const res = await fetch('/api/factory-reset', { method: 'POST' });
      if (!res.ok) throw new Error('Factory reset failed');
      alert('Factory reset complete. The page will now reload.');
      window.location.reload();
    } catch (err) {
      console.error('[SystemSettings] Factory reset error:', err);
      alert(`Factory reset failed: ${(err as Error).message}`);
    } finally {
      resettingFactory = false;
    }
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

  <!-- Mind Wandering Control -->
  <div class="setting-group">
    <label class="setting-label" for="mind-wandering-control">Mind Wandering</label>
    <div id="mind-wandering-control">
      <BoredomControl />
    </div>
  </div>

  <!-- Curiosity Level Control -->
  <div class="setting-group">
    <label class="setting-label">Curiosity Level</label>
    <div class="curiosity-control-container">
      <div class="curiosity-slider-wrapper">
        <input
          type="range"
          min="0"
          max="6"
          bind:value={curiosityLevel}
          on:change={saveCuriositySettings}
          class="curiosity-slider"
        />
        <div class="curiosity-labels">
          <span>Off</span>
          <span>Gentle</span>
          <span>Moderate</span>
          <span>Active</span>
          <span>Chatty</span>
          <span>Very</span>
          <span>Intense</span>
        </div>
      </div>
      <p class="curiosity-description">
        {curiosityLevelDescriptions[curiosityLevel]}
      </p>

      <!-- Research Mode Toggle -->
      {#if curiosityLevel > 0}
        <div class="research-mode-controls">
          <label class="field-label" for="research-mode-select">Research Mode</label>
          <select id="research-mode-select" bind:value={curiosityResearchMode} on:change={saveCuriositySettings} class="logging-select">
            <option value="off">Off - Questions only</option>
            <option value="local">Local - Use existing memories</option>
            <option value="web">Web - Allow web searches</option>
          </select>
        </div>
      {/if}
    </div>
  </div>

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

  <!-- Danger Zone -->
  <div class="setting-group danger-zone">
    <div class="setting-label">Danger Zone</div>
    <p class="danger-description">
      Delete all memories, conversations, and logs, and restore the default GPT‑OSS base model. This action is permanent.
    </p>
    <button class="danger-button" on:click={resetFactorySettings} disabled={resettingFactory}>
      {resettingFactory ? 'Resetting…' : 'Reset to Factory Settings'}
    </button>
  </div>

  <!-- GPU Monitoring -->
  <div class="setting-group">
    <label class="setting-label">GPU Memory Status</label>
    <GPUMonitor />
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

  <!-- Addons System -->
  <div class="setting-group">
    <h3>Addons</h3>
    <AddonsManager />
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

  .danger-description {
    font-size: 0.875rem;
    color: #6b7280;
    margin: 0 0 0.75rem 0;
  }

  :global(.dark) .danger-description {
    color: #9ca3af;
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

  /* Curiosity Controls */
  .curiosity-control-container {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .curiosity-slider-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .curiosity-slider {
    width: 100%;
    accent-color: #7c3aed;
    cursor: pointer;
  }

  .curiosity-labels {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    font-size: 0.7rem;
    color: #6b7280;
    padding: 0 0.25rem;
    text-align: center;
  }

  :global(.dark) .curiosity-labels {
    color: #9ca3af;
  }

  .curiosity-description {
    font-size: 0.875rem;
    color: #4b5563;
    margin: 0;
    padding: 0.75rem;
    background: rgba(124, 58, 237, 0.05);
    border-radius: 0.375rem;
    border-left: 3px solid #7c3aed;
  }

  :global(.dark) .curiosity-description {
    color: #9ca3af;
    background: rgba(167, 139, 250, 0.08);
    border-left-color: #a78bfa;
  }

  .research-mode-controls {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>

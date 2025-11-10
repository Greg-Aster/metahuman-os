<script lang="ts">
  import { onMount } from 'svelte';
  import LogStream from './LogStream.svelte';
  import AuditStreamEnhanced from './AuditStreamEnhanced.svelte';
  import ModelSelector from './ModelSelector.svelte';
  import BoredomControl from './BoredomControl.svelte';
  import AgentMonitor from './AgentMonitor.svelte';

  let activeTab = 'monitor';
  let useEnhancedAudit = true; // Toggle between old and new audit stream (default: grouped mode)

  // Load preference from localStorage
  onMount(() => {
    try {
      const saved = localStorage.getItem('mh_use_enhanced_audit');
      if (saved !== null) {
        useEnhancedAudit = saved === 'true';
      }
    } catch {}
  });

  // Save preference to localStorage
  $: if (typeof useEnhancedAudit !== 'undefined') {
    try {
      localStorage.setItem('mh_use_enhanced_audit', String(useEnhancedAudit));
    } catch {}
  }

  interface Tab {
    id: string;
    label: string;
    icon: string;
  }

  const tabs: Tab[] = [
    { id: 'audit', label: 'Audit Stream', icon: '📋' },
    { id: 'monitor', label: 'Agent Monitor', icon: '🤖' },
  ];

  // Ollama options (persisted)
  let llmNumCtx: number = 8192;
  let llmNumPredict: number = 512;

  // Model info and adapter controls
  let modelInfo: { baseModel: string; adapter: any; adapter2?: any; activeModel: string } | null = null;
  let loraDatasets: Array<{ date: string; status: string; evalScore?: number }> = []
  let dualAvailable = false
  let dualEnabled = false
  let selecting = false
  let loraEnabled = false
  let loraToggling = false
  let resettingFactory = false

  // Logging configuration
  type LogLevel = 'error' | 'warn' | 'info' | 'debug';
  let logLevel: LogLevel = 'info';
  let logColorize = true;
  let logTimestamp = true;
  let logSlowRequests = true;
  let slowRequestThresholdMs = 1000;
  let suppressPatterns = '/api/approvals, /api/status, /api/monitor, /api/sleep-status, /api/activity-ping';
  let savingLogging = false;

  async function fetchModelInfo() {
    try {
      const res = await fetch('/api/model-info');
      if (res.ok) {
        modelInfo = await res.json();
      }
      // fetch models and loras
      const mr = await fetch('/api/models')
      const md = await mr.json()
      if (mr.ok && md.success) {
        loraDatasets = Array.isArray(md.loras) ? md.loras : []
        dualAvailable = !!md.dualAvailable
      }
    } catch (e) {
      console.error('Failed to fetch model info:', e);
    }
  }

  async function fetchLoraConfig() {
    try {
      const res = await fetch('/api/lora-toggle');
      if (res.ok) {
        const config = await res.json();
        loraEnabled = config.enabled ?? false;
      }
    } catch (e) {
      console.error('Failed to fetch LoRA config:', e);
    }
  }

  async function fetchLoggingConfig() {
    try {
      const res = await fetch('/api/logging-config');
      if (res.ok) {
        const config = await res.json();
        logLevel = config.level || 'info';
        logColorize = config.console?.colorize ?? true;
        logTimestamp = config.console?.timestamp ?? true;
        logSlowRequests = config.logSlowRequests ?? true;
        slowRequestThresholdMs = config.slowRequestThresholdMs || 1000;
        suppressPatterns = (config.suppressPatterns || []).join(', ');
      }
    } catch (e) {
      console.error('Failed to fetch logging config:', e);
    }
  }

  async function saveLoggingConfig() {
    savingLogging = true;
    try {
      const patterns = suppressPatterns.split(',').map(s => s.trim()).filter(Boolean);
      const res = await fetch('/api/logging-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: logLevel,
          console: {
            enabled: true,
            colorize: logColorize,
            timestamp: logTimestamp
          },
          logSlowRequests,
          slowRequestThresholdMs,
          suppressPatterns: patterns
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save logging config');
      }
      alert('Logging configuration saved. Restart the dev server for changes to take full effect.');
    } catch (e) {
      console.error('Failed to save logging config:', e);
      alert((e as Error).message);
    } finally {
      savingLogging = false;
    }
  }

  async function toggleLora() {
    loraToggling = true;
    try {
      const res = await fetch('/api/lora-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !loraEnabled })
      });
      if (res.ok) {
        const data = await res.json();
        loraEnabled = data.enabled;
        // Refresh model info after toggling
        await fetchModelInfo();
      }
    } catch (e) {
      console.error('Failed to toggle LoRA:', e);
      alert((e as Error).message);
    } finally {
      loraToggling = false;
    }
  }

  async function handleLoraSelect(e: Event) {
    const sel = e.target as HTMLSelectElement
    const dataset = sel.value
    if (!dataset) return
    sel.value = ''
    selecting = true
    try {
      const res = await fetch('/api/adapter/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset, dual: dualEnabled })
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load adapter')
      await fetchModelInfo()
    } catch (e) {
      console.error(e)
      alert((e as Error).message)
    } finally {
      selecting = false
    }
  }

  function saveLLMOptions() {
    try { localStorage.setItem('llmOptions', JSON.stringify({ num_ctx: llmNumCtx, num_predict: llmNumPredict })); } catch {}
  }

  async function resetFactorySettings() {
    if (resettingFactory) return;
    const confirmed = window.confirm('This will erase all memories, logs, and conversations, and restore factory defaults. This action cannot be undone. Continue?');
    if (!confirmed) return;

    resettingFactory = true;
    try {
      const res = await fetch('/api/reset-factory', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Reset failed');
      }
      alert('Factory settings restored. The application will reload.');
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset factory settings:', error);
      alert(`Reset failed: ${(error as Error).message}`);
    } finally {
      resettingFactory = false;
    }
  }
  onMount(() => {
    try {
      const raw = localStorage.getItem('llmOptions');
      if (!raw) return;
      const o = JSON.parse(raw);
      if (typeof o.num_ctx === 'number') llmNumCtx = o.num_ctx;
      if (typeof o.num_predict === 'number') llmNumPredict = o.num_predict;
    } catch {}
    fetchModelInfo();
    fetchLoraConfig();
    fetchLoggingConfig();
  });
</script>

<div class="right-sidebar-container">
  <!-- Tab Navigation -->
  <div class="tabs">
    {#each tabs as tab}
      <button
        class="tab"
        class:active={activeTab === tab.id}
        on:click={() => (activeTab = tab.id)}
      >
        <span class="tab-icon">{tab.icon}</span>
        <span class="tab-label">{tab.label}</span>
      </button>
    {/each}
  </div>

  <!-- Tab Content -->
  <div class="tab-content">
    {#if activeTab === 'audit'}
      <div class="audit-container">
        <!-- Toggle Button -->
        <div class="p-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800">
          <span class="text-xs text-gray-600 dark:text-gray-400">View Mode:</span>
          <label class="flex items-center gap-2 cursor-pointer">
            <span class="text-xs text-gray-600 dark:text-gray-400">Terminal</span>
            <input
              type="checkbox"
              bind:checked={useEnhancedAudit}
              class="toggle-checkbox"
            />
            <span class="text-xs text-gray-600 dark:text-gray-400">Grouped</span>
          </label>
        </div>

        <!-- Stream Component -->
        <div class="flex-1 min-h-0">
          {#if useEnhancedAudit}
            <AuditStreamEnhanced />
          {:else}
            <LogStream />
          {/if}
        </div>
      </div>
    {:else if activeTab === 'monitor'}
      <div class="monitor-container">
        <AgentMonitor compact={true} />
      </div>
    {/if}
  </div>
</div>

<style>
  .right-sidebar-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* Tabs */
  .tabs {
    display: flex;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    flex-shrink: 0;
  }

  :global(.dark) .tabs {
    border-bottom-color: rgba(255, 255, 255, 0.1);
  }

  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.75rem 0.5rem;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: all 0.2s;
    border-bottom: 2px solid transparent;
  }

  .tab:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .tab:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .tab.active {
    border-bottom-color: rgb(124 58 237);
    background: rgba(124, 58, 237, 0.05);
  }

  :global(.dark) .tab.active {
    border-bottom-color: rgb(167 139 250);
    background: rgba(167, 139, 250, 0.05);
  }

  .tab-icon {
    font-size: 1.25rem;
  }

  .tab-label {
    font-size: 0.7rem;
    font-weight: 500;
    color: rgb(107 114 128);
  }

  :global(.dark) .tab-label {
    color: rgb(156 163 175);
  }

  .tab.active .tab-label {
    color: rgb(124 58 237);
  }

  :global(.dark) .tab.active .tab-label {
    color: rgb(167 139 250);
  }

  /* Tab Content */
  .tab-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .audit-container,
  .monitor-container,
  .settings-container {
    padding: 1rem;
  }

  .audit-container {
    padding: 0;
    height: 100%;
  }

  .monitor-container {
    padding: 0.75rem;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0 0 1rem 0;
  }

  :global(.dark) .section-title {
    color: rgb(243 244 246);
  }

  /* Settings */
  .setting-group {
    margin-bottom: 1.5rem;
  }

  .setting-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    color: rgb(107 114 128);
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.dark) .setting-label {
    color: rgb(156 163 175);
  }

  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .info-grid {
    background: rgba(255, 255, 255, 0.05);
  }

  .info-item {
    display: flex;
    justify-content: space-between;
    font-size: 0.875rem;
  }

  .opt-input {
    width: 7rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(0,0,0,0.15);
    background: white;
    color: rgb(17 24 39);
  }
  :global(.dark) .opt-input {
    background: rgb(17 24 39);
    color: rgb(243 244 246);
    border-color: rgba(255,255,255,0.2);
  }

  .info-key {
    color: rgb(107 114 128);
  }

  :global(.dark) .info-key {
    color: rgb(156 163 175);
  }

  .info-value {
    font-weight: 600;
    color: rgb(17 24 39);
  }

  :global(.dark) .info-value {
    color: rgb(243 244 246);
  }

  .danger-zone {
    border: 1px solid rgba(220, 38, 38, 0.2);
    border-radius: 0.5rem;
    padding: 0.75rem;
    background: rgba(248, 113, 113, 0.05);
  }

  :global(.dark) .danger-zone {
    border-color: rgba(239, 68, 68, 0.25);
    background: rgba(239, 68, 68, 0.08);
  }

  .danger-description {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    margin: 0.25rem 0 0.75rem;
  }

  :global(.dark) .danger-description {
    color: rgb(156 163 175);
  }

  .danger-button {
    appearance: none;
    border: none;
    background: rgb(220 38 38);
    color: white;
    font-size: 0.825rem;
    font-weight: 600;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: background 0.2s, transform 0.1s;
    width: 100%;
  }

  .danger-button:hover:not(:disabled) {
    background: rgb(185 28 28);
  }

  .danger-button:active:not(:disabled) {
    transform: translateY(1px);
  }

  .danger-button:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  /* Model Info Styles */
  .model-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8rem;
  }

  .adapter-highlight {
    color: rgb(124 58 237);
  }

  :global(.dark) .adapter-highlight {
    color: rgb(167 139 250);
  }

  .adapter-score {
    opacity: 0.7;
    font-size: 0.8rem;
    font-weight: 400;
  }

  .muted-value {
    opacity: 0.5;
    font-style: italic;
  }

  /* Adapter Controls */
  .adapter-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .adapter-select {
    width: 100%;
    padding: 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(0, 0, 0, 0.15);
    background: white;
    color: rgb(17 24 39);
    font-size: 0.875rem;
  }

  :global(.dark) .adapter-select {
    background: rgb(17 24 39);
    color: rgb(243 244 246);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .adapter-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dual-toggle-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: rgb(107 114 128);
    cursor: pointer;
  }

  :global(.dark) .dual-toggle-label {
    color: rgb(156 163 175);
  }

  .dual-checkbox {
    width: 1rem;
    height: 1rem;
    cursor: pointer;
  }

  /* LoRA Toggle Styles */
  .lora-toggle-container {
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .lora-toggle-container {
    background: rgba(255, 255, 255, 0.05);
  }

  .lora-toggle-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .lora-toggle-description {
    margin: 0;
    font-size: 0.75rem;
    color: rgb(107 114 128);
    font-style: italic;
  }

  :global(.dark) .lora-toggle-description {
    color: rgb(156 163 175);
  }

  /* Toggle Switch */
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 3rem;
    height: 1.5rem;
    cursor: pointer;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgb(209 213 219);
    transition: 0.3s;
    border-radius: 1.5rem;
  }

  :global(.dark) .toggle-slider {
    background-color: rgb(55 65 81);
  }

  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 1.125rem;
    width: 1.125rem;
    left: 0.1875rem;
    bottom: 0.1875rem;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
  }

  input:checked + .toggle-slider {
    background-color: rgb(124 58 237);
  }

  :global(.dark) input:checked + .toggle-slider {
    background-color: rgb(167 139 250);
  }

  input:checked + .toggle-slider:before {
    transform: translateX(1.5rem);
  }

  input:disabled + .toggle-slider {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Logging Configuration Styles */
  .logging-config-container {
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  :global(.dark) .logging-config-container {
    background: rgba(255, 255, 255, 0.05);
  }

  .logging-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field-label {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    font-weight: 500;
  }

  :global(.dark) .field-label {
    color: rgb(156 163 175);
  }

  .logging-select,
  .logging-input {
    padding: 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(0, 0, 0, 0.15);
    background: white;
    color: rgb(17 24 39);
    font-size: 0.875rem;
  }

  :global(.dark) .logging-select,
  :global(.dark) .logging-input {
    background: rgb(17 24 39);
    color: rgb(243 244 246);
    border-color: rgba(255, 255, 255, 0.2);
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
    color: rgb(107 114 128);
    cursor: pointer;
  }

  :global(.dark) .checkbox-label {
    color: rgb(156 163 175);
  }

  .checkbox-label input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
    cursor: pointer;
  }

  .save-logging-button {
    appearance: none;
    border: none;
    background: rgb(124 58 237);
    color: white;
    font-size: 0.825rem;
    font-weight: 600;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: background 0.2s, transform 0.1s;
  }

  .save-logging-button:hover:not(:disabled) {
    background: rgb(109 40 217);
  }

  :global(.dark) .save-logging-button {
    background: rgb(167 139 250);
    color: rgb(17 24 39);
  }

  :global(.dark) .save-logging-button:hover:not(:disabled) {
    background: rgb(192 162 255);
  }

  .save-logging-button:active:not(:disabled) {
    transform: translateY(1px);
  }

  .save-logging-button:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  /* Toggle Checkbox */
  .toggle-checkbox {
    appearance: none;
    width: 2.5rem;
    height: 1.25rem;
    background-color: rgb(209 213 219);
    border-radius: 9999px;
    position: relative;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  :global(.dark) .toggle-checkbox {
    background-color: rgb(75 85 99);
  }

  .toggle-checkbox::after {
    content: '';
    position: absolute;
    top: 0.125rem;
    left: 0.125rem;
    width: 1rem;
    height: 1rem;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }

  .toggle-checkbox:checked {
    background-color: rgb(124 58 237);
  }

  :global(.dark) .toggle-checkbox:checked {
    background-color: rgb(167 139 250);
  }

  .toggle-checkbox:checked::after {
    transform: translateX(1.25rem);
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  // Active Operator state
  let enabled = false;
  let mode: 'passive' | 'active' = 'passive';
  let loading = false;
  let saving = false;
  let error: string | null = null;

  // Status
  let status: any = null;
  let statusLoading = false;

  // Config
  let decisionModel = 'default';
  let cooldownMs = 5000;
  let maxConsecutiveTasks = 20;
  let enableSelfHealing = true;
  let energyBudgetEnabled = false;
  let tokensPerHour = 0;
  let enabledTaskTypes: string[] = [];

  const allTaskTypes = [
    { id: 'memory_curate', label: 'Memory Curation', description: 'Organize and tag memories' },
    { id: 'index_build', label: 'Index Build', description: 'Update vector search index' },
    { id: 'reflect', label: 'Reflections', description: 'Generate internal reflections' },
    { id: 'curiosity', label: 'Curiosity', description: 'Generate user-facing questions' },
    { id: 'inner_curiosity', label: 'Inner Curiosity', description: 'Self-directed Q&A' },
    { id: 'dream', label: 'Dreams', description: 'Create dreams from memories' },
    { id: 'desire_generate', label: 'Desire Generation', description: 'Generate new desires' },
    { id: 'desire_execute', label: 'Desire Execution', description: 'Execute pending desires' },
    { id: 'psychoanalyze', label: 'Psychoanalysis', description: 'Update persona from memories' },
  ];

  onMount(async () => {
    await loadConfig();
    await loadStatus();
  });

  async function loadConfig() {
    loading = true;
    error = null;
    try {
      const res = await apiFetch('/api/active-operator/config');
      if (res.ok) {
        const config = await res.json();
        enabled = config.enabled;
        mode = config.enabled ? 'active' : 'passive';
        decisionModel = config.decisionModel || 'default';
        cooldownMs = config.cooldownMs || 5000;
        maxConsecutiveTasks = config.maxConsecutiveTasks || 20;
        enableSelfHealing = config.enableSelfHealing !== false;
        energyBudgetEnabled = config.energyBudget?.enabled || false;
        tokensPerHour = config.energyBudget?.tokensPerHour || 0;
        enabledTaskTypes = config.enabledTaskTypes || [];
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function loadStatus() {
    statusLoading = true;
    try {
      const res = await apiFetch('/api/active-operator/status');
      if (res.ok) {
        status = await res.json();
      }
    } catch (err) {
      console.error('[ActiveOperatorSettings] Error loading status:', err);
    } finally {
      statusLoading = false;
    }
  }

  async function toggleMode() {
    saving = true;
    error = null;
    try {
      const res = await apiFetch('/api/active-operator/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to toggle mode');
      }
      const result = await res.json();
      mode = result.mode;
      enabled = result.mode === 'active';
      await loadStatus();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function emergencyStop() {
    if (!confirm('Emergency stop will immediately halt the Active Operator. Continue?')) {
      return;
    }
    saving = true;
    error = null;
    try {
      const res = await apiFetch('/api/active-operator/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emergency-stop' }),
      });
      if (res.ok) {
        mode = 'passive';
        enabled = false;
        await loadStatus();
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function saveConfig() {
    saving = true;
    error = null;
    try {
      const config = {
        decisionModel,
        cooldownMs,
        maxConsecutiveTasks,
        enableSelfHealing,
        energyBudget: {
          enabled: energyBudgetEnabled,
          tokensPerHour,
        },
        enabledTaskTypes,
      };
      const res = await apiFetch('/api/active-operator/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save config');
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  function toggleTaskType(taskId: string) {
    if (enabledTaskTypes.includes(taskId)) {
      enabledTaskTypes = enabledTaskTypes.filter((t) => t !== taskId);
    } else {
      enabledTaskTypes = [...enabledTaskTypes, taskId];
    }
  }
</script>

<div class="setting-group">
  <div class="section-header">
    <span class="setting-label">🧠 Active Operator</span>
    <span class="mode-badge" class:active={mode === 'active'} class:passive={mode === 'passive'}>
      {mode.toUpperCase()}
    </span>
  </div>

  <p class="setting-description">
    Transform MetaHuman OS from passive responses to proactive, LLM-controlled continuous thinking.
  </p>

  {#if error}
    <div class="error-message">{error}</div>
  {/if}

  <!-- Mode Toggle -->
  <div class="toggle-container">
    <div class="toggle-header">
      <span class="toggle-label">Enable Active Mode</span>
      <label class="toggle-switch" for="active-operator-toggle">
        <input
          id="active-operator-toggle"
          type="checkbox"
          checked={enabled}
          on:change={toggleMode}
          disabled={loading || saving}
        />
        <span class="toggle-slider"></span>
      </label>
    </div>
    <p class="toggle-description">
      {#if enabled}
        ⚡ System continuously decides what to think about
      {:else}
        😴 Timer-based scheduling (passive mode)
      {/if}
    </p>
  </div>

  {#if enabled}
    <!-- Emergency Stop -->
    <button class="emergency-stop-button" on:click={emergencyStop} disabled={saving}>
      🛑 Emergency Stop
    </button>
  {/if}

  <!-- Status Panel (when active) -->
  {#if status && enabled}
    <div class="status-panel">
      <div class="status-row">
        <span class="status-key">Health:</span>
        <span class="status-value health-{status.health}">{status.health}</span>
      </div>
      <div class="status-row">
        <span class="status-key">Queue:</span>
        <span class="status-value">{status.queue?.length || 0} tasks</span>
      </div>
      <div class="status-row">
        <span class="status-key">Tasks Executed:</span>
        <span class="status-value">{status.metrics?.totalTasksExecuted || 0}</span>
      </div>
      <div class="status-row">
        <span class="status-key">Success Rate:</span>
        <span class="status-value">{status.metrics?.successRate || 'N/A'}</span>
      </div>
      {#if status.scratchpad?.lastDecision}
        <div class="status-row">
          <span class="status-key">Last Decision:</span>
          <span class="status-value">{status.scratchpad.lastDecision.task}</span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Configuration -->
  <details class="config-details">
    <summary>Configuration</summary>

    <div class="config-section">
      <label class="config-label" for="decision-model">Decision Model</label>
      <select id="decision-model" bind:value={decisionModel} class="config-select">
        <option value="default">Default (Orchestrator)</option>
        <option value="persona">Persona Model</option>
        <option value="fast">Fast (Fallback)</option>
      </select>
    </div>

    <div class="config-section">
      <label class="config-label" for="cooldown">Cooldown (ms)</label>
      <input
        id="cooldown"
        type="number"
        bind:value={cooldownMs}
        min="1000"
        max="60000"
        step="1000"
        class="config-input"
      />
    </div>

    <div class="config-section">
      <label class="config-label" for="max-tasks">Max Consecutive Tasks</label>
      <input
        id="max-tasks"
        type="number"
        bind:value={maxConsecutiveTasks}
        min="5"
        max="100"
        class="config-input"
      />
    </div>

    <div class="config-section">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={enableSelfHealing} />
        <span>Enable Self-Healing (code analysis)</span>
      </label>
    </div>

    <!-- Energy Budget -->
    <div class="config-section">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={energyBudgetEnabled} />
        <span>Enable Energy Budget</span>
      </label>
      {#if energyBudgetEnabled}
        <div style="margin-top: 0.5rem;">
          <label class="config-label" for="tokens-per-hour">Tokens per Hour (0 = unlimited)</label>
          <input
            id="tokens-per-hour"
            type="number"
            bind:value={tokensPerHour}
            min="0"
            step="1000"
            class="config-input"
          />
        </div>
      {/if}
    </div>

    <!-- Enabled Task Types -->
    <div class="config-section">
      <label class="config-label">Enabled Task Types</label>
      <div class="task-types-grid">
        {#each allTaskTypes as task}
          <label class="task-type-checkbox">
            <input
              type="checkbox"
              checked={enabledTaskTypes.includes(task.id)}
              on:change={() => toggleTaskType(task.id)}
            />
            <span class="task-type-label">{task.label}</span>
          </label>
        {/each}
      </div>
    </div>

    <button class="save-button" on:click={saveConfig} disabled={saving}>
      {saving ? 'Saving...' : 'Save Configuration'}
    </button>
  </details>
</div>

<style>
  .setting-group {
    background: var(--card-bg, #1a1a1a);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .setting-label {
    font-weight: 600;
    font-size: 1rem;
    color: var(--text-primary, #fff);
  }

  .setting-description {
    font-size: 0.85rem;
    color: var(--text-muted, #999);
    margin-bottom: 1rem;
  }

  .mode-badge {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .mode-badge.active {
    background: #22c55e;
    color: white;
  }

  .mode-badge.passive {
    background: #6b7280;
    color: white;
  }

  .error-message {
    background: #ef4444;
    color: white;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .toggle-container {
    background: var(--bg-secondary, #252525);
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1rem;
  }

  .toggle-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .toggle-label {
    font-size: 0.9rem;
    color: var(--text-primary, #fff);
  }

  .toggle-description {
    font-size: 0.8rem;
    color: var(--text-muted, #999);
    margin-top: 0.5rem;
  }

  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 48px;
    height: 24px;
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
    background-color: #4b5563;
    transition: 0.3s;
    border-radius: 24px;
  }

  .toggle-slider:before {
    position: absolute;
    content: '';
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
  }

  input:checked + .toggle-slider {
    background-color: #22c55e;
  }

  input:checked + .toggle-slider:before {
    transform: translateX(24px);
  }

  .emergency-stop-button {
    background: #dc2626;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .emergency-stop-button:hover {
    background: #b91c1c;
  }

  .emergency-stop-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status-panel {
    background: var(--bg-secondary, #252525);
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1rem;
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    padding: 0.25rem 0;
  }

  .status-key {
    color: var(--text-muted, #999);
    font-size: 0.85rem;
  }

  .status-value {
    color: var(--text-primary, #fff);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .health-healthy {
    color: #22c55e;
  }

  .health-degraded {
    color: #eab308;
  }

  .health-error {
    color: #ef4444;
  }

  .config-details {
    margin-top: 1rem;
  }

  .config-details summary {
    cursor: pointer;
    color: var(--text-primary, #fff);
    font-weight: 500;
    padding: 0.5rem 0;
  }

  .config-section {
    margin-top: 1rem;
  }

  .config-label {
    display: block;
    font-size: 0.85rem;
    color: var(--text-muted, #999);
    margin-bottom: 0.25rem;
  }

  .config-select,
  .config-input {
    width: 100%;
    padding: 0.5rem;
    background: var(--bg-secondary, #252525);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    color: var(--text-primary, #fff);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--text-primary, #fff);
    cursor: pointer;
  }

  .task-types-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .task-type-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-primary, #fff);
    cursor: pointer;
  }

  .save-button {
    margin-top: 1rem;
    background: var(--accent-color, #3b82f6);
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
  }

  .save-button:hover {
    background: #2563eb;
  }

  .save-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

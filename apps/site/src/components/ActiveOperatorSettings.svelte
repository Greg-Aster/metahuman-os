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

<div class="card p-4 mb-4">
  <div class="flex items-center justify-between mb-2">
    <span class="font-semibold text-base text-white">🧠 Active Operator</span>
    <span class="mode-badge" class:active={mode === 'active'} class:passive={mode === 'passive'}>
      {mode.toUpperCase()}
    </span>
  </div>

  <p class="text-sm text-gray-500 mb-4">
    Transform MetaHuman OS from passive responses to proactive, LLM-controlled continuous thinking.
  </p>

  {#if error}
    <div class="banner banner-error mb-4">{error}</div>
  {/if}

  <!-- Mode Toggle -->
  <div class="bg-white/5 p-3 rounded-md mb-4">
    <div class="flex items-center justify-between">
      <span class="text-sm text-white">Enable Active Mode</span>
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
    <p class="text-sm text-gray-500 mt-2">
      {#if enabled}
        ⚡ System continuously decides what to think about
      {:else}
        😴 Timer-based scheduling (passive mode)
      {/if}
    </p>
  </div>

  {#if enabled}
    <button class="danger-button mb-4" on:click={emergencyStop} disabled={saving}>
      🛑 Emergency Stop
    </button>
  {/if}

  {#if status && enabled}
    <div class="bg-white/5 p-3 rounded-md mb-4">
      {#each [
        { key: 'Health:', value: status.health, class: `health-${status.health}` },
        { key: 'Queue:', value: `${status.queue?.length || 0} tasks` },
        { key: 'Tasks Executed:', value: status.metrics?.totalTasksExecuted || 0 },
        { key: 'Success Rate:', value: status.metrics?.successRate || 'N/A' },
      ] as row}
        <div class="flex justify-between py-1">
          <span class="text-sm text-gray-500">{row.key}</span>
          <span class="text-sm font-medium text-white {row.class || ''}">{row.value}</span>
        </div>
      {/each}
      {#if status.scratchpad?.lastDecision}
        <div class="flex justify-between py-1">
          <span class="text-sm text-gray-500">Last Decision:</span>
          <span class="text-sm font-medium text-white">{status.scratchpad.lastDecision.task}</span>
        </div>
      {/if}
    </div>
  {/if}

  <details class="mt-4">
    <summary class="cursor-pointer text-white font-medium py-2">Configuration</summary>

    <div class="mt-4">
      <label class="form-label" for="decision-model">Decision Model</label>
      <select id="decision-model" bind:value={decisionModel} class="form-input">
        <option value="default">Default (Orchestrator)</option>
        <option value="persona">Persona Model</option>
        <option value="fast">Fast (Fallback)</option>
      </select>
    </div>

    <div class="mt-4">
      <label class="form-label" for="cooldown">Cooldown (ms)</label>
      <input id="cooldown" type="number" bind:value={cooldownMs} min="1000" max="60000" step="1000" class="form-input" />
    </div>

    <div class="mt-4">
      <label class="form-label" for="max-tasks">Max Consecutive Tasks</label>
      <input id="max-tasks" type="number" bind:value={maxConsecutiveTasks} min="5" max="100" class="form-input" />
    </div>

    <div class="mt-4">
      <label class="flex items-center gap-2 text-sm text-white cursor-pointer">
        <input type="checkbox" bind:checked={enableSelfHealing} />
        <span>Enable Self-Healing (code analysis)</span>
      </label>
    </div>

    <div class="mt-4">
      <label class="flex items-center gap-2 text-sm text-white cursor-pointer">
        <input type="checkbox" bind:checked={energyBudgetEnabled} />
        <span>Enable Energy Budget</span>
      </label>
      {#if energyBudgetEnabled}
        <div class="mt-2">
          <label class="form-label" for="tokens-per-hour">Tokens per Hour (0 = unlimited)</label>
          <input id="tokens-per-hour" type="number" bind:value={tokensPerHour} min="0" step="1000" class="form-input" />
        </div>
      {/if}
    </div>

    <div class="mt-4">
      <label class="form-label">Enabled Task Types</label>
      <div class="grid grid-cols-2 gap-2 mt-2">
        {#each allTaskTypes as task}
          <label class="flex items-center gap-2 text-sm text-white cursor-pointer">
            <input
              type="checkbox"
              checked={enabledTaskTypes.includes(task.id)}
              on:change={() => toggleTaskType(task.id)}
            />
            <span>{task.label}</span>
          </label>
        {/each}
      </div>
    </div>

    <button class="btn-primary mt-4" on:click={saveConfig} disabled={saving}>
      {saving ? 'Saving...' : 'Save Configuration'}
    </button>
  </details>
</div>

<style>
  /* Mode badge */
  .mode-badge {
    @apply px-2 py-1 rounded text-xs font-semibold;
  }
  .mode-badge.active {
    @apply bg-green-500 text-white;
  }
  .mode-badge.passive {
    @apply bg-gray-500 text-white;
  }

  /* Toggle switch */
  .toggle-switch {
    @apply relative inline-block w-12 h-6;
  }
  .toggle-switch input {
    @apply opacity-0 w-0 h-0;
  }
  .toggle-slider {
    @apply absolute cursor-pointer inset-0 bg-gray-600 transition-all rounded-full;
  }
  .toggle-slider:before {
    @apply absolute content-[''] h-[18px] w-[18px] left-[3px] bottom-[3px] bg-white transition-all rounded-full;
  }
  input:checked + .toggle-slider {
    @apply bg-green-500;
  }
  input:checked + .toggle-slider:before {
    transform: translateX(24px);
  }

  /* Health status colors */
  :global(.health-healthy) { @apply text-green-500; }
  :global(.health-degraded) { @apply text-yellow-500; }
  :global(.health-error) { @apply text-red-500; }
</style>

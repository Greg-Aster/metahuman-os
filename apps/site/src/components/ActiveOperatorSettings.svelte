<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { AUTONOMY_MODES, type AutonomyMode } from '../lib/client/active-operator-modes';

  let autonomyMode: AutonomyMode = 'reactive';
  let cooldownMs = 30_000;
  let loading = false;
  let saving = false;
  let error = '';

  const modes = AUTONOMY_MODES;

  onMount(loadConfig);

  async function loadConfig() {
    loading = true;
    error = '';
    try {
      const response = await apiFetch('/api/active-operator/config');
      const config = await response.json();
      if (!response.ok) throw new Error(config.error || 'Failed to load Active Operator configuration');
      autonomyMode = config.autonomyMode || 'reactive';
      cooldownMs = config.cooldownMs ?? 30_000;
    } catch (caught) {
      error = (caught as Error).message;
    } finally {
      loading = false;
    }
  }

  async function setMode(mode: AutonomyMode) {
    saving = true;
    error = '';
    try {
      const response = await apiFetch('/api/active-operator/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-mode', mode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to change autonomy mode');
      autonomyMode = result.mode;
    } catch (caught) {
      error = (caught as Error).message;
    } finally {
      saving = false;
    }
  }

  async function saveConfig() {
    saving = true;
    error = '';
    try {
      const response = await apiFetch('/api/active-operator/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autonomyMode,
          cooldownMs,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save Active Operator configuration');
      autonomyMode = result.autonomyMode;
    } catch (caught) {
      error = (caught as Error).message;
    } finally {
      saving = false;
    }
  }

  async function emergencyStop() {
    if (!confirm('Cancel active autonomous work and return to reactive mode?')) return;
    saving = true;
    try {
      const response = await apiFetch('/api/active-operator/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emergency-stop' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Emergency stop failed');
      autonomyMode = 'reactive';
    } catch (caught) {
      error = (caught as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="card mb-4 p-4">
  <div class="mb-2 flex items-center justify-between">
    <span class="text-base font-semibold text-white">Active Operator</span>
    <span class="rounded bg-white/10 px-2 py-1 text-xs font-semibold uppercase text-white">{autonomyMode}</span>
  </div>
  <p class="mb-4 text-sm text-gray-500">Controls proactive admission above the deterministic work coordinator. It does not own or reorder the queue.</p>

  {#if error}<div class="banner banner-error mb-4">{error}</div>{/if}

  <div class="grid gap-2">
    {#each modes as mode}
      <button
        class="rounded border p-3 text-left {autonomyMode === mode.id ? 'border-blue-500 bg-blue-500/10' : 'border-white/10'}"
        disabled={loading || saving}
        on:click={() => setMode(mode.id)}
      >
        <div class="text-sm font-medium text-white">{mode.label}</div>
        <div class="mt-1 text-xs text-gray-500">{mode.description}</div>
      </button>
    {/each}
  </div>

  {#if autonomyMode === 'full'}
    <button class="danger-button mt-4" disabled={saving} on:click={emergencyStop}>Emergency stop autonomy</button>
  {/if}

  <details class="mt-4">
    <summary class="cursor-pointer py-2 font-medium text-white">Full-mode timing</summary>
    <div class="mt-3 grid gap-3">
      <label class="text-sm text-white">Robot Operator cooldown (ms)
        <input class="form-input mt-1" type="number" bind:value={cooldownMs} min="5000" step="1000" />
      </label>
      <button class="btn-primary" disabled={saving} on:click={saveConfig}>{saving ? 'Saving…' : 'Save timing'}</button>
    </div>
  </details>
</div>

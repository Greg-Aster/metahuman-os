<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    initTierSelection,
    stopTierSelection,
    selectBestTier,
    setSelectionMode,
    selectedTier,
    tierStatuses,
    deviceStatus,
    tierConfig,
    TIERS,
    getTierIcon,
    getCapabilityIcon,
    type TierType,
    type SelectionMode,
    type TierSelectionResult,
    type DeviceStatus,
  } from '../lib/client/tier-selection';

  export let compact = false;

  let result: TierSelectionResult | null = null;
  let loading = true;
  let refreshing = false;

  // Subscribe to stores
  let currentTier: TierType = 'server';
  let currentConfig = { mode: 'auto' as SelectionMode };
  let statuses = TIERS;
  let device: DeviceStatus = { batteryLevel: 100, batteryCharging: false, networkType: 'unknown', saveDataMode: false };

  const unsubTier = selectedTier.subscribe(t => currentTier = t);
  const unsubConfig = tierConfig.subscribe(c => currentConfig = c);
  const unsubStatuses = tierStatuses.subscribe(s => statuses = s as any);
  const unsubDevice = deviceStatus.subscribe(d => device = d);

  onMount(async () => {
    try {
      result = await initTierSelection();
    } catch (e) {
      console.error('Tier selection init failed:', e);
    }
    loading = false;
  });

  onDestroy(() => {
    unsubTier();
    unsubConfig();
    unsubStatuses();
    unsubDevice();
    stopTierSelection();
  });

  async function handleRefresh() {
    refreshing = true;
    try {
      result = await selectBestTier();
    } catch (e) {
      console.error('Tier refresh failed:', e);
    }
    refreshing = false;
  }

  async function handleModeChange(mode: SelectionMode) {
    await setSelectionMode(mode);
    result = await selectBestTier();
  }

  async function handleManualSelect(tier: TierType) {
    await setSelectionMode('manual', tier);
    result = await selectBestTier();
  }

  function getStatusColor(available: boolean): string {
    return available ? '#22c55e' : '#ef4444';
  }

  function getStatusText(tier: TierType): string {
    const status = result?.tierStatuses[tier];
    if (!status) return 'Unknown';
    if (status.available) {
      return status.latencyMs ? `${status.latencyMs}ms` : 'Available';
    }
    return status.error || 'Unavailable';
  }

  function getBatteryIcon(): string {
    if (device.batteryCharging) return '🔌';
    if (device.batteryLevel > 75) return '🔋';
    if (device.batteryLevel > 25) return '🪫';
    return '🔴';
  }

  function getNetworkIcon(): string {
    switch (device.networkType) {
      case 'wifi': return '📶';
      case 'cellular': return '📱';
      case 'ethernet': return '🔌';
      case 'none': return '📵';
      default: return '❓';
    }
  }
</script>

{#if loading}
  <div class="tier-selector flex items-center justify-center gap-2 min-h-[200px] text-gray-500">
    <span class="spinner"></span>
    <span>Detecting tiers...</span>
  </div>
{:else if compact}
  <!-- Compact mode: just shows current tier with icon -->
  <button class="tier-compact" on:click={handleRefresh} disabled={refreshing}>
    <span class="text-xl">{getTierIcon(currentTier)}</span>
    <span class="font-semibold text-sm text-gray-800 dark:text-gray-100">{TIERS[currentTier].name}</span>
    {#if refreshing}
      <span class="spinner small"></span>
    {/if}
  </button>
{:else}
  <!-- Full mode: shows all tiers with selection -->
  <div class="tier-selector">
    <div class="flex justify-between items-center mb-4">
      <h3 class="m-0 text-base font-semibold text-gray-700 dark:text-gray-200">Compute Tier</h3>
      <button class="p-1 px-2 border-0 bg-transparent cursor-pointer rounded-md text-base hover:bg-black/5 dark:hover:bg-white/10" on:click={handleRefresh} disabled={refreshing}>
        {#if refreshing}
          <span class="spinner small"></span>
        {:else}
          🔄
        {/if}
      </button>
    </div>

    <!-- Device Status -->
    <div class="flex gap-4 mb-4 text-sm">
      <span class="flex items-center gap-1 text-gray-500" title="Battery">
        {getBatteryIcon()} {device.batteryLevel}%
      </span>
      <span class="flex items-center gap-1 text-gray-500" title="Network">
        {getNetworkIcon()} {device.networkType}
      </span>
      {#if device.saveDataMode}
        <span class="flex items-center gap-1 text-amber-500" title="Data Saver Active">💾 Saver</span>
      {/if}
    </div>

    <!-- Selection Mode -->
    <div class="flex flex-wrap gap-3 mb-4 text-sm">
      <label class="flex items-center gap-1 cursor-pointer text-gray-700 dark:text-gray-300">
        <input type="radio" name="mode" value="auto" checked={currentConfig.mode === 'auto'} on:change={() => handleModeChange('auto')} />
        Auto
      </label>
      <label class="flex items-center gap-1 cursor-pointer text-gray-700 dark:text-gray-300">
        <input type="radio" name="mode" value="prefer-offline" checked={currentConfig.mode === 'prefer-offline'} on:change={() => handleModeChange('prefer-offline')} />
        Prefer Offline
      </label>
      <label class="flex items-center gap-1 cursor-pointer text-gray-700 dark:text-gray-300">
        <input type="radio" name="mode" value="prefer-server" checked={currentConfig.mode === 'prefer-server'} on:change={() => handleModeChange('prefer-server')} />
        Prefer Server
      </label>
      <label class="flex items-center gap-1 cursor-pointer text-gray-700 dark:text-gray-300">
        <input type="radio" name="mode" value="manual" checked={currentConfig.mode === 'manual'} on:change={() => handleModeChange('manual')} />
        Manual
      </label>
    </div>

    <!-- Tier Cards -->
    <div class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 mb-4">
      {#each Object.values(TIERS) as tier}
        {@const status = result?.tierStatuses[tier.id]}
        {@const isSelected = currentTier === tier.id}
        <button
          class="tier-card"
          class:selected={isSelected}
          class:available={status?.available}
          class:unavailable={!status?.available}
          on:click={() => handleManualSelect(tier.id)}
          disabled={currentConfig.mode !== 'manual'}
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="text-2xl">{getTierIcon(tier.id)}</span>
            <span class="font-semibold text-sm text-gray-800 dark:text-gray-100 flex-1">{tier.name}</span>
            <span class="w-2 h-2 rounded-full" style="background-color: {getStatusColor(status?.available || false)}"></span>
          </div>

          <div class="text-xs text-gray-500 mb-1 font-mono">{tier.model}</div>
          <div class="text-xs text-gray-400 mb-2">{getStatusText(tier.id)}</div>

          <div class="flex gap-1 flex-wrap">
            {#each tier.capabilities.slice(0, 4) as cap}
              <span class="text-xs p-0.5 bg-black/5 dark:bg-white/10 rounded" title={cap}>{getCapabilityIcon(cap)}</span>
            {/each}
            {#if tier.capabilities.length > 4}
              <span class="text-[0.625rem] text-gray-500">+{tier.capabilities.length - 4}</span>
            {/if}
          </div>

          {#if isSelected}
            <div class="absolute -top-2 -right-2 bg-blue-500 text-white text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full uppercase">Active</div>
          {/if}
        </button>
      {/each}
    </div>

    <!-- Selection Reason -->
    {#if result?.reason}
      <div class="text-xs text-gray-500 p-2 bg-black/[0.03] dark:bg-white/5 rounded-md">
        <strong>Why:</strong> {result.reason}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Tier selector container */
  .tier-selector {
    @apply p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.03];
  }

  /* Tier card with state variants */
  .tier-card {
    @apply relative p-3 border-2 border-transparent rounded-lg bg-white dark:bg-gray-800
           cursor-pointer text-left transition-all;
  }
  .tier-card:disabled {
    @apply cursor-default opacity-70;
  }
  .tier-card.available {
    @apply border-gray-300 dark:border-gray-700;
  }
  .tier-card.unavailable {
    @apply border-red-200 bg-red-50 dark:border-red-900 dark:bg-stone-900;
  }
  .tier-card.selected {
    @apply border-blue-500;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }
  .tier-card:not(:disabled):hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  /* Compact mode button */
  .tier-compact {
    @apply inline-flex items-center gap-1.5 py-1 px-3 border-0 rounded-full cursor-pointer
           text-sm transition-all bg-black/5 dark:bg-white/10 dark:text-gray-200;
  }
  .tier-compact:hover:not(:disabled) {
    @apply bg-black/10 dark:bg-white/15;
  }
  .tier-compact:disabled {
    @apply cursor-wait;
  }

  /* Spinner animation */
  .spinner {
    @apply w-5 h-5 rounded-full border-2 border-gray-200 border-t-blue-500;
    animation: spin 0.8s linear infinite;
  }
  .spinner.small {
    @apply w-3.5 h-3.5;
    border-width: 1.5px;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>

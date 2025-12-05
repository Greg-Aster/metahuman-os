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
  <div class="tier-selector loading">
    <span class="spinner"></span>
    <span>Detecting tiers...</span>
  </div>
{:else if compact}
  <!-- Compact mode: just shows current tier with icon -->
  <button class="tier-compact" on:click={handleRefresh} disabled={refreshing}>
    <span class="tier-icon">{getTierIcon(currentTier)}</span>
    <span class="tier-name">{TIERS[currentTier].name}</span>
    {#if refreshing}
      <span class="spinner small"></span>
    {/if}
  </button>
{:else}
  <!-- Full mode: shows all tiers with selection -->
  <div class="tier-selector">
    <div class="tier-header">
      <h3>Compute Tier</h3>
      <button class="refresh-btn" on:click={handleRefresh} disabled={refreshing}>
        {#if refreshing}
          <span class="spinner small"></span>
        {:else}
          🔄
        {/if}
      </button>
    </div>

    <!-- Device Status -->
    <div class="device-status">
      <span class="status-item" title="Battery">
        {getBatteryIcon()} {device.batteryLevel}%
      </span>
      <span class="status-item" title="Network">
        {getNetworkIcon()} {device.networkType}
      </span>
      {#if device.saveDataMode}
        <span class="status-item warning" title="Data Saver Active">💾 Saver</span>
      {/if}
    </div>

    <!-- Selection Mode -->
    <div class="mode-selector">
      <label>
        <input
          type="radio"
          name="mode"
          value="auto"
          checked={currentConfig.mode === 'auto'}
          on:change={() => handleModeChange('auto')}
        />
        Auto
      </label>
      <label>
        <input
          type="radio"
          name="mode"
          value="prefer-offline"
          checked={currentConfig.mode === 'prefer-offline'}
          on:change={() => handleModeChange('prefer-offline')}
        />
        Prefer Offline
      </label>
      <label>
        <input
          type="radio"
          name="mode"
          value="prefer-server"
          checked={currentConfig.mode === 'prefer-server'}
          on:change={() => handleModeChange('prefer-server')}
        />
        Prefer Server
      </label>
      <label>
        <input
          type="radio"
          name="mode"
          value="manual"
          checked={currentConfig.mode === 'manual'}
          on:change={() => handleModeChange('manual')}
        />
        Manual
      </label>
    </div>

    <!-- Tier Cards -->
    <div class="tier-cards">
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
          <div class="tier-card-header">
            <span class="tier-icon large">{getTierIcon(tier.id)}</span>
            <span class="tier-name">{tier.name}</span>
            <span class="status-dot" style="background-color: {getStatusColor(status?.available || false)}"></span>
          </div>

          <div class="tier-model">{tier.model}</div>

          <div class="tier-status">{getStatusText(tier.id)}</div>

          <div class="tier-capabilities">
            {#each tier.capabilities.slice(0, 4) as cap}
              <span class="capability" title={cap}>{getCapabilityIcon(cap)}</span>
            {/each}
            {#if tier.capabilities.length > 4}
              <span class="capability more">+{tier.capabilities.length - 4}</span>
            {/if}
          </div>

          {#if isSelected}
            <div class="selected-badge">Active</div>
          {/if}
        </button>
      {/each}
    </div>

    <!-- Selection Reason -->
    {#if result?.reason}
      <div class="selection-reason">
        <strong>Why:</strong> {result.reason}
      </div>
    {/if}
  </div>
{/if}

<style>
  .tier-selector {
    padding: 1rem;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 0.75rem;
  }

  :global(.dark) .tier-selector {
    background: rgba(255, 255, 255, 0.03);
  }

  .tier-selector.loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 200px;
    color: #6b7280;
  }

  .tier-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .tier-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .tier-header h3 {
    color: #e5e7eb;
  }

  .refresh-btn {
    padding: 0.25rem 0.5rem;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 0.375rem;
    font-size: 1rem;
  }

  .refresh-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .refresh-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  .device-status {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: #6b7280;
  }

  .status-item.warning {
    color: #f59e0b;
  }

  .mode-selector {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .mode-selector label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    cursor: pointer;
    color: #374151;
  }

  :global(.dark) .mode-selector label {
    color: #d1d5db;
  }

  .tier-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .tier-card {
    position: relative;
    padding: 0.75rem;
    border: 2px solid transparent;
    border-radius: 0.5rem;
    background: white;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }

  :global(.dark) .tier-card {
    background: #1f2937;
  }

  .tier-card:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .tier-card.available {
    border-color: #d1d5db;
  }

  :global(.dark) .tier-card.available {
    border-color: #374151;
  }

  .tier-card.unavailable {
    border-color: #fecaca;
    background: #fef2f2;
  }

  :global(.dark) .tier-card.unavailable {
    border-color: #7f1d1d;
    background: #1c1917;
  }

  .tier-card.selected {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }

  .tier-card:not(:disabled):hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .tier-card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .tier-icon {
    font-size: 1.25rem;
  }

  .tier-icon.large {
    font-size: 1.5rem;
  }

  .tier-name {
    font-weight: 600;
    font-size: 0.875rem;
    color: #1f2937;
    flex: 1;
  }

  :global(.dark) .tier-name {
    color: #f3f4f6;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .tier-model {
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.25rem;
    font-family: monospace;
  }

  .tier-status {
    font-size: 0.75rem;
    color: #9ca3af;
    margin-bottom: 0.5rem;
  }

  .tier-capabilities {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .capability {
    font-size: 0.75rem;
    padding: 0.125rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 0.25rem;
  }

  :global(.dark) .capability {
    background: rgba(255, 255, 255, 0.1);
  }

  .capability.more {
    color: #6b7280;
    font-size: 0.625rem;
  }

  .selected-badge {
    position: absolute;
    top: -8px;
    right: -8px;
    background: #3b82f6;
    color: white;
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.125rem 0.375rem;
    border-radius: 9999px;
    text-transform: uppercase;
  }

  .selection-reason {
    font-size: 0.75rem;
    color: #6b7280;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.03);
    border-radius: 0.375rem;
  }

  :global(.dark) .selection-reason {
    background: rgba(255, 255, 255, 0.05);
  }

  /* Compact mode */
  .tier-compact {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.75rem;
    border: none;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 9999px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.15s;
  }

  :global(.dark) .tier-compact {
    background: rgba(255, 255, 255, 0.1);
    color: #e5e7eb;
  }

  .tier-compact:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .tier-compact:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
  }

  .tier-compact:disabled {
    cursor: wait;
  }

  /* Spinner */
  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .spinner.small {
    width: 14px;
    height: 14px;
    border-width: 1.5px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    healthStatus,
    startHealthMonitor,
    stopHealthMonitor,
    forceHealthCheck,
    getQualityColor,
    getQualityLabel,
    getQualityEmoji,
    type HealthStatus
  } from '../lib/client/server-health';
  import { isCapacitorNative } from '../lib/client/api-config';

  export let compact = false;
  export let showLatency = true;
  export let showLabel = true;

  let status: HealthStatus;
  let checking = false;
  let isMobile = false;

  const unsubscribe = healthStatus.subscribe(s => {
    status = s;
  });

  async function handleClick() {
    checking = true;
    await forceHealthCheck();
    checking = false;
  }

  onMount(() => {
    isMobile = isCapacitorNative();
  });

  onDestroy(() => {
    unsubscribe();
  });

  $: qualityColor = status ? getQualityColor(status.quality) : '#6b7280';
  $: qualityLabel = status ? getQualityLabel(status.quality) : 'Unknown';
  $: qualityEmoji = status ? getQualityEmoji(status.quality) : '⚪';
</script>

{#if status}
  <button
    class="health-indicator"
    class:compact
    on:click={handleClick}
    disabled={checking}
    title={`Server: ${status.connected ? 'Connected' : 'Disconnected'}${status.latencyMs ? ` (${status.latencyMs}ms)` : ''}`}
  >
    <span class="status-dot" class:pulsing={checking} style="background-color: {qualityColor}"></span>

    {#if !compact}
      {#if showLabel}
        <span class="status-label">{qualityLabel}</span>
      {/if}

      {#if showLatency && status.connected && status.latencyMs > 0}
        <span class="latency">{status.latencyMs}ms</span>
      {/if}
    {/if}

    {#if checking}
      <span class="checking-indicator">...</span>
    {/if}
  </button>
{:else}
  <div class="health-indicator compact">
    <span class="status-dot" style="background-color: #6b7280"></span>
  </div>
{/if}

<style>
  .health-indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border: none;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 9999px;
    cursor: pointer;
    transition: all 0.15s;
    font-size: 0.75rem;
  }

  :global(.dark) .health-indicator {
    background: rgba(255, 255, 255, 0.08);
  }

  .health-indicator:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .health-indicator:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  .health-indicator:disabled {
    cursor: wait;
    opacity: 0.7;
  }

  .health-indicator.compact {
    padding: 0.125rem;
    background: transparent;
    gap: 0;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background-color 0.3s;
  }

  .status-dot.pulsing {
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(0.8);
    }
  }

  .status-label {
    color: #374151;
    font-weight: 500;
  }

  :global(.dark) .status-label {
    color: #e5e7eb;
  }

  .latency {
    color: #6b7280;
    font-size: 0.6875rem;
  }

  :global(.dark) .latency {
    color: #9ca3af;
  }

  .checking-indicator {
    color: #6b7280;
    font-size: 0.625rem;
  }
</style>

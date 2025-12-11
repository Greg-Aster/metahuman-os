<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch, isMobileApp } from '../lib/client/api-config';

  interface RuntimeMode {
    headless: boolean;
    lastChangedBy: 'local' | 'remote';
    changedAt: string;
    claimedBy: string | null;
  }

  let runtimeMode: RuntimeMode | null = null;
  let loading = false;
  let error: string | null = null;
  let claiming = false;
  let showBanner = false;
  let isMobile = false;

  async function loadRuntimeMode() {
    // Skip on mobile - headless mode is a server-only feature
    if (isMobile) return;

    try {
      const res = await apiFetch('/api/runtime/mode');
      if (res.ok) {
        runtimeMode = await res.json();
        // Show banner if in headless mode
        showBanner = runtimeMode.headless;
      }
    } catch (err) {
      // Silently fail - this is not critical for app operation
      console.warn('Failed to load runtime mode (expected on mobile):', err);
    }
  }

  async function claimRuntime() {
    error = null;
    claiming = true;

    try {
      const res = await apiFetch('/api/runtime/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: false }),
      });

      if (res.ok) {
        showBanner = false;
        // Reload to refresh agent status
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const data = await res.json();
        error = data.error || 'Failed to claim runtime';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to claim runtime';
    } finally {
      claiming = false;
    }
  }

  function dismiss() {
    showBanner = false;
  }

  onMount(() => {
    isMobile = isMobileApp();

    // Skip loading on mobile - this is a server-only feature
    if (isMobile) return;

    loadRuntimeMode();
    // Check every 10 seconds for changes
    const interval = setInterval(loadRuntimeMode, 10000);
    return () => clearInterval(interval);
  });
</script>

{#if showBanner}
  <div class="claim-banner">
    <div class="banner-content">
      <div class="banner-icon">🖥️</div>
      <div class="banner-text">
        <h3>Headless Mode Active</h3>
        <p>
          Local agents are paused. Click "Claim Runtime" to resume full system
          operations and dedicate all resources to your remote session.
        </p>
      </div>
      <div class="banner-actions">
        <button
          class="btn-claim"
          on:click={claimRuntime}
          disabled={claiming}
        >
          {claiming ? 'Claiming...' : 'Claim Runtime'}
        </button>
        <button
          class="btn-dismiss"
          on:click={dismiss}
          disabled={claiming}
        >
          Dismiss
        </button>
      </div>
    </div>

    {#if error}
      <div class="banner-error">{error}</div>
    {/if}
  </div>
{/if}

<style>
  .claim-banner {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    max-width: 600px;
    width: 90%;
    background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
    color: #78350f;
    padding: 1.5rem;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    animation: slideDown 0.3s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .banner-content {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }

  .banner-icon {
    font-size: 2rem;
    flex-shrink: 0;
  }

  .banner-text {
    flex: 1;
  }

  .banner-text h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.125rem;
    font-weight: 700;
    color: #78350f;
  }

  .banner-text p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: #92400e;
  }

  .banner-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .btn-claim,
  .btn-dismiss {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: none;
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .btn-claim {
    background: #78350f;
    color: #fef3c7;
  }

  .btn-claim:hover:not(:disabled) {
    background: #92400e;
  }

  .btn-claim:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-dismiss {
    background: transparent;
    color: #78350f;
    border: 1px solid #92400e;
  }

  .btn-dismiss:hover:not(:disabled) {
    background: rgba(146, 64, 14, 0.1);
  }

  .banner-error {
    margin-top: 1rem;
    padding: 0.75rem;
    background: rgba(127, 29, 29, 0.2);
    border: 1px solid #7f1d1d;
    border-radius: 6px;
    color: #7f1d1d;
    font-size: 0.875rem;
  }

  /* Responsive adjustments */
  @media (max-width: 640px) {
    .claim-banner {
      top: 60px;
      width: 95%;
      padding: 1rem;
    }

    .banner-content {
      flex-direction: column;
    }

    .banner-actions {
      width: 100%;
    }

    .btn-claim,
    .btn-dismiss {
      width: 100%;
    }
  }
</style>

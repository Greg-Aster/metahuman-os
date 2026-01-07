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
  <div class="fixed top-20 left-1/2 -translate-x-1/2 z-[1000] max-w-[600px] w-[90%] bg-gradient-to-br from-amber-400 to-amber-500 text-amber-900 p-6 rounded-xl shadow-2xl animate-slide-down sm:top-[60px] sm:w-[95%] sm:p-4">
    <div class="flex items-start gap-4 sm:flex-col">
      <div class="text-3xl shrink-0">🖥️</div>
      <div class="flex-1">
        <h3 class="m-0 mb-2 text-lg font-bold text-amber-900">Headless Mode Active</h3>
        <p class="m-0 text-sm leading-relaxed text-amber-800">
          Local agents are paused. Click "Claim Runtime" to resume full system
          operations and dedicate all resources to your remote session.
        </p>
      </div>
      <div class="flex flex-col gap-2 shrink-0 sm:w-full">
        <button
          class="px-4 py-2 rounded-md border-0 font-semibold text-sm cursor-pointer transition-all whitespace-nowrap bg-amber-900 text-amber-100 hover:bg-amber-800 disabled:opacity-60 disabled:cursor-not-allowed sm:w-full"
          on:click={claimRuntime}
          disabled={claiming}
        >
          {claiming ? 'Claiming...' : 'Claim Runtime'}
        </button>
        <button
          class="px-4 py-2 rounded-md font-semibold text-sm cursor-pointer transition-all whitespace-nowrap bg-transparent text-amber-900 border border-amber-800 hover:bg-amber-800/10 disabled:opacity-60 disabled:cursor-not-allowed sm:w-full"
          on:click={dismiss}
          disabled={claiming}
        >
          Dismiss
        </button>
      </div>
    </div>

    {#if error}
      <div class="mt-4 p-3 bg-red-900/20 border border-red-900 rounded-md text-red-900 text-sm">{error}</div>
    {/if}
  </div>
{/if}

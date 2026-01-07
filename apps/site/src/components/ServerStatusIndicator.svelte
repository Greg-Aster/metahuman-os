<script lang="ts">
  /**
   * ServerStatusIndicator
   * Reusable component for displaying server status with controls
   */

  import { onMount, onDestroy } from 'svelte';

  export let serverName: string = 'Server';
  export let statusEndpoint: string;
  export let controlEndpoint: string;
  export let autoRefresh: boolean = true;
  export let refreshInterval: number = 10000; // 10 seconds

  interface ServerStatus {
    running: boolean;
    installed: boolean;
    pid?: number;
    port?: number;
    serverUrl?: string;
    healthy?: boolean;
  }

  let status: ServerStatus | null = null;
  let loading = true;
  let error: string | null = null;
  let starting = false;
  let stopping = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function fetchStatus() {
    try {
      const response = await fetch(statusEndpoint);
      if (!response.ok) throw new Error('Failed to fetch status');
      status = await response.json();
      error = null;
    } catch (e) {
      error = String(e);
      console.error(`[ServerStatusIndicator ${serverName}] Error fetching status:`, e);
    } finally {
      loading = false;
    }
  }

  async function startServer() {
    starting = true;
    error = null;
    try {
      const response = await fetch(controlEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start server');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to start server');
      }

      // Refresh status after a moment
      setTimeout(fetchStatus, 2000);
    } catch (e) {
      error = String(e);
      console.error(`[ServerStatusIndicator ${serverName}] Error starting server:`, e);
    } finally {
      starting = false;
    }
  }

  async function stopServer() {
    stopping = true;
    error = null;
    try {
      const response = await fetch(controlEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to stop server');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to stop server');
      }

      // Refresh status immediately
      await fetchStatus();
    } catch (e) {
      error = String(e);
      console.error(`[ServerStatusIndicator ${serverName}] Error stopping server:`, e);
    } finally {
      stopping = false;
    }
  }

  onMount(() => {
    fetchStatus();
    if (autoRefresh) {
      pollInterval = setInterval(fetchStatus, refreshInterval);
    }
  });

  onDestroy(() => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });
</script>

<div class="bg-gray-100 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-lg p-3">
  {#if loading && !status}
    <div class="flex items-center gap-2 p-2 text-gray-500 dark:text-gray-400">
      <span class="spinner"></span>
      <span>Loading status...</span>
    </div>
  {:else if error && !status}
    <div class="flex items-center gap-2 p-2 text-gray-500 dark:text-gray-400">
      <span>⚠️</span>
      <span>Error loading status</span>
    </div>
  {:else if status}
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3 flex-wrap">
        {#if !status.installed}
          <div class="status-badge not-installed">
            <span class="status-dot"></span>
            <span>Not Installed</span>
          </div>
        {:else if status.running && status.healthy}
          <div class="status-badge running">
            <span class="status-dot pulsing"></span>
            <span>Running</span>
          </div>
        {:else if status.running && !status.healthy}
          <div class="status-badge starting">
            <span class="status-dot"></span>
            <span>Starting...</span>
          </div>
        {:else}
          <div class="status-badge stopped">
            <span class="status-dot"></span>
            <span>Stopped</span>
          </div>
        {/if}

        {#if status.running && status.pid}
          <span class="text-sm text-gray-500 dark:text-gray-400 px-2 py-1 bg-white dark:bg-black rounded">PID: {status.pid}</span>
        {/if}

        {#if status.port}
          <span class="text-sm text-gray-500 dark:text-gray-400 px-2 py-1 bg-white dark:bg-black rounded">Port: {status.port}</span>
        {/if}
      </div>

      {#if status.installed}
        <div class="flex gap-2 flex-wrap">
          {#if status.running}
            <button class="control-btn bg-red-500 hover:bg-red-600 dark:bg-red-700 dark:hover:bg-red-800" on:click={stopServer} disabled={stopping}>
              {stopping ? '⏳' : '⏹️'} {stopping ? 'Stopping...' : 'Stop'}
            </button>
          {:else}
            <button class="control-btn bg-green-500 hover:bg-green-600 dark:bg-green-700 dark:hover:bg-green-800" on:click={startServer} disabled={starting}>
              {starting ? '⏳' : '▶️'} {starting ? 'Starting...' : 'Start'}
            </button>
          {/if}

          {#if status.serverUrl && status.healthy}
            <a href={status.serverUrl} target="_blank" rel="noopener noreferrer" class="control-btn bg-blue-500 hover:bg-blue-600 dark:bg-blue-700 dark:hover:bg-blue-800 no-underline">
              🔗 Open
            </a>
          {/if}

          <button class="control-btn bg-gray-500 hover:bg-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600" on:click={fetchStatus} disabled={loading}>
            🔄
          </button>
        </div>
      {/if}
    </div>

    {#if error}
      <div class="banner banner-error mt-3">{error}</div>
    {/if}
  {/if}
</div>

<style>
  /* Spinner animation */
  .spinner {
    @apply inline-block w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Status badge variants */
  .status-badge {
    @apply inline-flex items-center gap-2 py-1.5 px-3 rounded-full text-sm font-semibold;
  }
  .status-badge.not-installed {
    @apply bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400;
  }
  .status-badge.running {
    @apply bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300;
  }
  .status-badge.starting {
    @apply bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300;
  }
  .status-badge.stopped {
    @apply bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300;
  }

  /* Status dot with pulse animation */
  .status-dot {
    @apply inline-block w-2 h-2 rounded-full bg-current;
  }
  .status-dot.pulsing {
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Control button base */
  .control-btn {
    @apply py-1.5 px-3 text-sm font-medium border-0 rounded-md cursor-pointer transition-all
           inline-flex items-center gap-1 text-white;
  }
  .control-btn:disabled {
    @apply opacity-50 cursor-not-allowed;
  }
</style>

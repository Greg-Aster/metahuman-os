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

<div class="server-status-indicator">
  {#if loading && !status}
    <div class="status-loading">
      <span class="loading-spinner"></span>
      <span>Loading status...</span>
    </div>
  {:else if error && !status}
    <div class="status-error">
      <span class="status-icon">⚠️</span>
      <span class="status-text">Error loading status</span>
    </div>
  {:else if status}
    <div class="status-content">
      <div class="status-display">
        {#if !status.installed}
          <div class="status-badge not-installed">
            <span class="status-dot"></span>
            <span class="status-label">Not Installed</span>
          </div>
        {:else if status.running && status.healthy}
          <div class="status-badge running healthy">
            <span class="status-dot pulsing"></span>
            <span class="status-label">Running</span>
          </div>
        {:else if status.running && !status.healthy}
          <div class="status-badge running unhealthy">
            <span class="status-dot"></span>
            <span class="status-label">Starting...</span>
          </div>
        {:else}
          <div class="status-badge stopped">
            <span class="status-dot"></span>
            <span class="status-label">Stopped</span>
          </div>
        {/if}

        {#if status.running && status.pid}
          <span class="status-detail">PID: {status.pid}</span>
        {/if}

        {#if status.port}
          <span class="status-detail">Port: {status.port}</span>
        {/if}
      </div>

      {#if status.installed}
        <div class="status-controls">
          {#if status.running}
            <button
              class="control-btn stop-btn"
              on:click={stopServer}
              disabled={stopping}
            >
              {stopping ? '⏳' : '⏹️'} {stopping ? 'Stopping...' : 'Stop'}
            </button>
          {:else}
            <button
              class="control-btn start-btn"
              on:click={startServer}
              disabled={starting}
            >
              {starting ? '⏳' : '▶️'} {starting ? 'Starting...' : 'Start'}
            </button>
          {/if}

          {#if status.serverUrl && status.healthy}
            <a
              href={status.serverUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="control-btn link-btn"
            >
              🔗 Open
            </a>
          {/if}

          <button
            class="control-btn refresh-btn"
            on:click={fetchStatus}
            disabled={loading}
          >
            🔄
          </button>
        </div>
      {/if}
    </div>

    {#if error}
      <div class="error-message">{error}</div>
    {/if}
  {/if}
</div>

<style>
  .server-status-indicator {
    background: var(--bg-secondary, #f5f5f5);
    border: 1px solid var(--border, #ddd);
    border-radius: 8px;
    padding: 12px;
  }

  :global(.dark) .server-status-indicator {
    background: #1a1a1a;
    border-color: #333;
  }

  .status-loading,
  .status-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    color: var(--text-secondary, #666);
  }

  :global(.dark) .status-loading,
  :global(.dark) .status-error {
    color: #999;
  }

  .loading-spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid var(--border, #ddd);
    border-top-color: var(--accent, #2196F3);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .status-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .status-display {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 16px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .status-badge.not-installed {
    background: #f3f4f6;
    color: #6b7280;
  }

  :global(.dark) .status-badge.not-installed {
    background: #374151;
    color: #9ca3af;
  }

  .status-badge.running.healthy {
    background: #d1fae5;
    color: #065f46;
  }

  :global(.dark) .status-badge.running.healthy {
    background: #064e3b;
    color: #6ee7b7;
  }

  .status-badge.running.unhealthy {
    background: #fef3c7;
    color: #92400e;
  }

  :global(.dark) .status-badge.running.unhealthy {
    background: #78350f;
    color: #fcd34d;
  }

  .status-badge.stopped {
    background: #fee2e2;
    color: #991b1b;
  }

  :global(.dark) .status-badge.stopped {
    background: #7f1d1d;
    color: #fca5a5;
  }

  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  .status-dot.pulsing {
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .status-detail {
    font-size: 0.85rem;
    color: var(--text-secondary, #666);
    padding: 4px 8px;
    background: var(--bg-tertiary, #fff);
    border-radius: 4px;
  }

  :global(.dark) .status-detail {
    background: #0f0f0f;
    color: #999;
  }

  .status-controls {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .control-btn {
    padding: 6px 12px;
    font-size: 0.85rem;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .start-btn {
    background: #10b981;
    color: white;
  }

  .start-btn:hover:not(:disabled) {
    background: #059669;
  }

  :global(.dark) .start-btn {
    background: #047857;
  }

  :global(.dark) .start-btn:hover:not(:disabled) {
    background: #065f46;
  }

  .stop-btn {
    background: #ef4444;
    color: white;
  }

  .stop-btn:hover:not(:disabled) {
    background: #dc2626;
  }

  :global(.dark) .stop-btn {
    background: #b91c1c;
  }

  :global(.dark) .stop-btn:hover:not(:disabled) {
    background: #991b1b;
  }

  .link-btn {
    background: #3b82f6;
    color: white;
    text-decoration: none;
  }

  .link-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  :global(.dark) .link-btn {
    background: #1e40af;
  }

  :global(.dark) .link-btn:hover:not(:disabled) {
    background: #1e3a8a;
  }

  .refresh-btn {
    background: #6b7280;
    color: white;
  }

  .refresh-btn:hover:not(:disabled) {
    background: #4b5563;
  }

  :global(.dark) .refresh-btn {
    background: #374151;
  }

  :global(.dark) .refresh-btn:hover:not(:disabled) {
    background: #1f2937;
  }

  .error-message {
    padding: 8px 12px;
    background: #fee2e2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    color: #991b1b;
    font-size: 0.85rem;
  }

  :global(.dark) .error-message {
    background: #7f1d1d;
    border-color: #991b1b;
    color: #fca5a5;
  }

  @media (max-width: 640px) {
    .status-display {
      flex-direction: column;
      align-items: flex-start;
    }

    .status-controls {
      width: 100%;
    }

    .control-btn {
      flex: 1;
      justify-content: center;
    }
  }
</style>

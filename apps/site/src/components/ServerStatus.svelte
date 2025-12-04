<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface ServerInfo {
    name: string;
    displayName: string;
    endpoint: string;
    port: number;
    status: 'running' | 'stopped' | 'unknown';
    healthy: boolean;
    installed: boolean;
    details?: any;
  }

  interface AstroServer {
    port: number;
    pid: number;
    command: string;
    isCurrentServer: boolean;
  }

  let servers: ServerInfo[] = [];
  let astroServers: AstroServer[] = [];
  let loading = true;
  let actionInProgress: string | null = null;
  let refreshInterval: ReturnType<typeof setInterval>;

  const serverConfigs = [
    { name: 'whisper', displayName: 'Whisper STT', endpoint: '/api/whisper-server', port: 9883 },
    { name: 'kokoro', displayName: 'Kokoro TTS', endpoint: '/api/kokoro-server', port: 9882 },
    { name: 'rvc', displayName: 'RVC Voice', endpoint: '/api/rvc-server', port: 9881 },
    { name: 'sovits', displayName: 'GPT-SoVITS', endpoint: '/api/sovits-server', port: 9880 },
  ];

  async function fetchServerStatus() {
    const newServers: ServerInfo[] = [];

    for (const config of serverConfigs) {
      try {
        const response = await apiFetch(config.endpoint);
        if (response.ok) {
          const data = await response.json();
          newServers.push({
            name: config.name,
            displayName: config.displayName,
            endpoint: config.endpoint,
            port: config.port,
            status: data.running ? 'running' : 'stopped',
            healthy: data.healthy ?? data.running,
            installed: data.installed ?? true,
            details: data,
          });
        } else {
          newServers.push({
            name: config.name,
            displayName: config.displayName,
            endpoint: config.endpoint,
            port: config.port,
            status: 'unknown',
            healthy: false,
            installed: false,
          });
        }
      } catch (error) {
        newServers.push({
          name: config.name,
          displayName: config.displayName,
          endpoint: config.endpoint,
          port: config.port,
          status: 'unknown',
          healthy: false,
          installed: false,
        });
      }
    }

    // Fetch Astro dev servers
    try {
      const astroResponse = await apiFetch('/api/astro-servers');
      if (astroResponse.ok) {
        const astroData = await astroResponse.json();
        astroServers = astroData.servers || [];
      }
    } catch (error) {
      console.error('Failed to fetch Astro servers:', error);
      astroServers = [];
    }

    servers = newServers;
    loading = false;
  }

  async function controlServer(server: ServerInfo, action: 'start' | 'stop' | 'restart') {
    actionInProgress = `${server.name}-${action}`;

    try {
      const response = await apiFetch(server.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(`Failed to ${action} ${server.displayName}: ${data.error || 'Unknown error'}`);
      } else {
        // Wait a moment then refresh
        setTimeout(fetchServerStatus, 1000);
      }
    } catch (error) {
      alert(`Error ${action}ing ${server.displayName}: ${(error as Error).message}`);
    } finally {
      actionInProgress = null;
    }
  }

  function getStatusIcon(server: ServerInfo): string {
    if (!server.installed) return '⚠️';
    if (server.status === 'running' && server.healthy) return '🟢';
    if (server.status === 'running' && !server.healthy) return '🟡';
    if (server.status === 'stopped') return '🔴';
    return '⚪';
  }

  function getStatusText(server: ServerInfo): string {
    if (!server.installed) return 'Not Installed';
    if (server.status === 'running' && server.healthy) return 'Running';
    if (server.status === 'running' && !server.healthy) return 'Unhealthy';
    if (server.status === 'stopped') return 'Stopped';
    return 'Unknown';
  }

  async function stopAstroServer(port: number, isCurrentServer: boolean) {
    if (isCurrentServer) {
      const confirmed = confirm(
        `⚠️ Warning: This will stop the current Astro dev server.\n\n` +
        `The UI will disconnect and you'll need to restart the server manually.\n\n` +
        `Continue?`
      );
      if (!confirmed) return;
    }

    actionInProgress = `astro-${port}`;

    try {
      const response = await apiFetch('/api/astro-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', port }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(`Failed to stop Astro server: ${data.error || 'Unknown error'}`);
      } else {
        if (isCurrentServer) {
          alert('Server stopped. You will need to restart it manually.');
        } else {
          setTimeout(fetchServerStatus, 1000);
        }
      }
    } catch (error) {
      alert(`Error stopping Astro server: ${(error as Error).message}`);
    } finally {
      actionInProgress = null;
    }
  }

  onMount(() => {
    fetchServerStatus();
    refreshInterval = setInterval(fetchServerStatus, 10000); // Refresh every 10 seconds
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });
</script>

<div class="server-status-container">
  <div class="header">
    <h3 class="title">Server Status</h3>
    <button class="refresh-btn" on:click={fetchServerStatus} disabled={loading}>
      {loading ? '⏳' : '🔄'}
    </button>
  </div>

  {#if loading && servers.length === 0 && astroServers.length === 0}
    <div class="loading">Loading server status...</div>
  {:else}
    <div class="server-list">
      <!-- Astro Dev Servers Section -->
      {#if astroServers.length > 0}
        <div class="section-header">
          <span class="section-icon">🚀</span>
          <span class="section-title">Astro Dev Servers</span>
        </div>
        {#each astroServers as astro (astro.port)}
          <div class="server-card astro-card" class:current-server={astro.isCurrentServer}>
            <div class="server-header">
              <div class="server-info">
                <span class="status-icon">🟢</span>
                <div class="server-details">
                  <div class="server-name">
                    Astro Dev Server
                    {#if astro.isCurrentServer}
                      <span class="current-badge">CURRENT</span>
                    {/if}
                  </div>
                  <div class="server-meta">
                    Port: {astro.port} • PID: {astro.pid}
                  </div>
                  <div class="server-command">{astro.command}</div>
                </div>
              </div>
            </div>

            <div class="server-actions">
              <button
                class="action-btn stop"
                class:danger={astro.isCurrentServer}
                on:click={() => stopAstroServer(astro.port, astro.isCurrentServer)}
                disabled={actionInProgress !== null}
              >
                {actionInProgress === `astro-${astro.port}` ? '...' : 'Stop'}
              </button>
            </div>
          </div>
        {/each}
      {/if}

      <!-- Voice/Backend Servers Section -->
      {#if servers.length > 0}
        <div class="section-header">
          <span class="section-icon">🔧</span>
          <span class="section-title">Backend Services</span>
        </div>
      {/if}
      {#each servers as server (server.name)}
        <div class="server-card">
          <div class="server-header">
            <div class="server-info">
              <span class="status-icon">{getStatusIcon(server)}</span>
              <div class="server-details">
                <div class="server-name">{server.displayName}</div>
                <div class="server-meta">
                  Port: {server.port} • {getStatusText(server)}
                </div>
              </div>
            </div>
          </div>

          {#if server.installed}
            <div class="server-actions">
              {#if server.status === 'running'}
                <button
                  class="action-btn stop"
                  on:click={() => controlServer(server, 'stop')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === `${server.name}-stop` ? '...' : 'Stop'}
                </button>
                <button
                  class="action-btn restart"
                  on:click={() => controlServer(server, 'restart')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === `${server.name}-restart` ? '...' : 'Restart'}
                </button>
              {:else}
                <button
                  class="action-btn start"
                  on:click={() => controlServer(server, 'start')}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === `${server.name}-start` ? '...' : 'Start'}
                </button>
              {/if}
            </div>
          {:else}
            <div class="not-installed-msg">
              Not installed or configured
            </div>
          {/if}

          {#if server.details && server.status === 'running'}
            <div class="server-details-extra">
              {#if server.details.model}
                <span class="detail-badge">Model: {server.details.model}</span>
              {/if}
              {#if server.details.device}
                <span class="detail-badge">Device: {server.details.device}</span>
              {/if}
              {#if server.details.voice}
                <span class="detail-badge">Voice: {server.details.voice}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .server-status-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1rem;
    gap: 1rem;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title {
    font-size: 1rem;
    font-weight: 600;
    color: rgb(17 24 39);
    margin: 0;
  }

  :global(.dark) .title {
    color: rgb(243 244 246);
  }

  .refresh-btn {
    background: transparent;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.375rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
  }

  :global(.dark) .refresh-btn {
    border-color: rgba(255, 255, 255, 0.2);
  }

  .refresh-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .refresh-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: rgb(107 114 128);
    font-size: 0.875rem;
  }

  :global(.dark) .loading {
    color: rgb(156 163 175);
  }

  .server-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
  }

  .server-card {
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.5rem;
    padding: 0.75rem;
    background: white;
    transition: all 0.2s;
  }

  :global(.dark) .server-card {
    background: rgb(31 41 55);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .server-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .server-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .server-header {
    margin-bottom: 0.75rem;
  }

  .server-info {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .status-icon {
    font-size: 1.25rem;
    line-height: 1;
  }

  .server-details {
    flex: 1;
    min-width: 0;
  }

  .server-name {
    font-weight: 600;
    font-size: 0.875rem;
    color: rgb(17 24 39);
    margin-bottom: 0.25rem;
  }

  :global(.dark) .server-name {
    color: rgb(243 244 246);
  }

  .server-meta {
    font-size: 0.75rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .server-meta {
    color: rgb(156 163 175);
  }

  .server-actions {
    display: flex;
    gap: 0.5rem;
  }

  .action-btn {
    flex: 1;
    padding: 0.4rem 0.75rem;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.start {
    background: rgb(34 197 94);
    color: white;
  }

  .action-btn.start:hover:not(:disabled) {
    background: rgb(22 163 74);
  }

  .action-btn.stop {
    background: rgb(239 68 68);
    color: white;
  }

  .action-btn.stop:hover:not(:disabled) {
    background: rgb(220 38 38);
  }

  .action-btn.restart {
    background: rgb(234 179 8);
    color: white;
  }

  .action-btn.restart:hover:not(:disabled) {
    background: rgb(202 138 4);
  }

  .not-installed-msg {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    font-style: italic;
    padding: 0.5rem;
    text-align: center;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 0.375rem;
  }

  :global(.dark) .not-installed-msg {
    color: rgb(156 163 175);
    background: rgba(255, 255, 255, 0.05);
  }

  .server-details-extra {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
  }

  :global(.dark) .server-details-extra {
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .detail-badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    background: rgba(124, 58, 237, 0.1);
    color: rgb(124 58 237);
    border-radius: 0.25rem;
    font-size: 0.7rem;
    font-weight: 500;
  }

  :global(.dark) .detail-badge {
    background: rgba(167, 139, 250, 0.15);
    color: rgb(167 139 250);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
    margin-top: 0.5rem;
    font-weight: 600;
    font-size: 0.8rem;
    color: rgb(107 114 128);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.dark) .section-header {
    color: rgb(156 163 175);
  }

  .section-icon {
    font-size: 1rem;
  }

  .section-title {
    flex: 1;
  }

  .astro-card {
    border-color: rgba(124, 58, 237, 0.2);
  }

  :global(.dark) .astro-card {
    border-color: rgba(167, 139, 250, 0.2);
  }

  .astro-card.current-server {
    border-width: 2px;
    border-color: rgba(124, 58, 237, 0.4);
    background: rgba(124, 58, 237, 0.02);
  }

  :global(.dark) .astro-card.current-server {
    border-color: rgba(167, 139, 250, 0.4);
    background: rgba(167, 139, 250, 0.03);
  }

  .current-badge {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    margin-left: 0.5rem;
    background: rgba(124, 58, 237, 0.15);
    color: rgb(124 58 237);
    border-radius: 0.25rem;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  :global(.dark) .current-badge {
    background: rgba(167, 139, 250, 0.2);
    color: rgb(167 139 250);
  }

  .server-command {
    font-size: 0.65rem;
    color: rgb(156 163 175);
    margin-top: 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  :global(.dark) .server-command {
    color: rgb(107 114 128);
  }

  .action-btn.danger {
    background: rgb(185 28 28);
  }

  .action-btn.danger:hover:not(:disabled) {
    background: rgb(153 27 27);
  }
</style>

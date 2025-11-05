<script lang="ts">
  import { onMount } from 'svelte';

  interface TunnelStatus {
    installed: boolean;
    running: boolean;
    enabled: boolean;
    hostname: string;
    pid?: number;
  }

  let tunnelStatus: TunnelStatus | null = null;
  let loading = true;
  let error: string | null = null;
  let successMessage: string | null = null;

  async function loadTunnelStatus() {
    try {
      const res = await fetch('/api/cloudflare/status');
      if (res.ok) {
        tunnelStatus = await res.json();
      }
    } catch (err) {
      console.error('Failed to load tunnel status:', err);
    } finally {
      loading = false;
    }
  }

  async function toggleTunnel(enable: boolean) {
    error = null;
    successMessage = null;
    loading = true;

    try {
      const res = await fetch('/api/cloudflare/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable }),
      });

      if (res.ok) {
        successMessage = enable ? 'Tunnel enabled!' : 'Tunnel disabled!';
        await loadTunnelStatus();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to toggle tunnel';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to toggle tunnel';
    } finally {
      loading = false;
    }
  }

  async function startTunnel() {
    error = null;
    successMessage = null;
    loading = true;

    try {
      const res = await fetch('/api/cloudflare/start', { method: 'POST' });
      if (res.ok) {
        successMessage = 'Tunnel started!';
        await loadTunnelStatus();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to start tunnel';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to start tunnel';
    } finally {
      loading = false;
    }
  }

  async function stopTunnel() {
    error = null;
    successMessage = null;
    loading = true;

    try {
      const res = await fetch('/api/cloudflare/stop', { method: 'POST' });
      if (res.ok) {
        successMessage = 'Tunnel stopped!';
        await loadTunnelStatus();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to stop tunnel';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to stop tunnel';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadTunnelStatus();
    const interval = setInterval(loadTunnelStatus, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  });
</script>

<div class="network-container">
  <div class="network-header">
    <h1>Network Settings</h1>
    <p>Manage Cloudflare Tunnel and external connectivity</p>
    <a href="https://github.com/yourusername/metahuman/blob/master/docs/user-guide/17-cloudflare-tunnel-setup.md" target="_blank" rel="noopener noreferrer" class="setup-guide-link">
      📖 Setup Guide
    </a>
  </div>

  {#if loading && !tunnelStatus}
    <div class="loading">Loading tunnel status...</div>
  {:else if tunnelStatus}
    <div class="tunnel-section">
      <h2>🌐 Cloudflare Tunnel</h2>

      {#if !tunnelStatus.installed}
        <div class="warning-box">
          <strong>⚠️ cloudflared not installed</strong>
          <p>Install cloudflared to enable secure tunneling:</p>
          <code>wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared-linux-amd64.deb</code>
          <p style="margin-top: 1rem;">
            <a href="https://github.com/yourusername/metahuman/blob/master/docs/user-guide/17-cloudflare-tunnel-setup.md" target="_blank" rel="noopener noreferrer" class="inline-guide-link">
              📖 View complete setup guide
            </a>
          </p>
        </div>
      {:else}
        <div class="status-box" class:status-running={tunnelStatus.running} class:status-stopped={!tunnelStatus.running}>
          <div class="status-indicator">
            <span class="status-dot" class:dot-running={tunnelStatus.running} class:dot-stopped={!tunnelStatus.running}></span>
            <strong>{tunnelStatus.running ? '✅ Running' : '⭕ Stopped'}</strong>
            {#if tunnelStatus.pid}
              <span class="pid">(PID: {tunnelStatus.pid})</span>
            {/if}
          </div>

          {#if tunnelStatus.hostname}
            <div class="hostname">
              <strong>Public URL:</strong>
              <a href="https://{tunnelStatus.hostname}" target="_blank" rel="noopener noreferrer">
                https://{tunnelStatus.hostname}
              </a>
            </div>
          {/if}

          <div class="tunnel-controls">
            <label class="toggle-label">
              <input
                type="checkbox"
                checked={tunnelStatus.enabled}
                on:change={(e) => toggleTunnel(e.currentTarget.checked)}
                disabled={loading}
              />
              <span>Auto-start on boot</span>
            </label>

            <div class="button-group">
              <button
                class="btn btn-primary"
                on:click={startTunnel}
                disabled={loading || tunnelStatus.running}
              >
                Start Tunnel
              </button>
              <button
                class="btn btn-danger"
                on:click={stopTunnel}
                disabled={loading || !tunnelStatus.running}
              >
                Stop Tunnel
              </button>
            </div>
          </div>
        </div>

        <div class="info-box">
          <h3>ℹ️ How It Works</h3>
          <ul>
            <li><strong>Auto-start:</strong> When enabled, the tunnel starts automatically when MetaHuman starts</li>
            <li><strong>No port forwarding:</strong> Cloudflare tunnel creates a secure connection without opening router ports</li>
            <li><strong>HTTPS included:</strong> Automatic SSL certificates from Cloudflare</li>
            <li><strong>Access control:</strong> Configure email whitelisting in Cloudflare Zero Trust dashboard</li>
          </ul>
        </div>
      {/if}
    </div>

    {#if error}
      <div class="error-message">{error}</div>
    {/if}

    {#if successMessage}
      <div class="success-message">{successMessage}</div>
    {/if}
  {/if}
</div>

<style>
  .network-container {
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .network-header {
    margin-bottom: 2rem;
  }

  .network-header h1 {
    font-size: 2rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #1f2937;
  }

  :global(.dark) .network-header h1 {
    color: #f9fafb;
  }

  .network-header p {
    color: #6b7280;
    margin-bottom: 0.75rem;
  }

  :global(.dark) .network-header p {
    color: #9ca3af;
  }

  .setup-guide-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: #3b82f6;
    color: white;
    text-decoration: none;
    border-radius: 6px;
    font-weight: 500;
    font-size: 0.875rem;
    transition: background 0.15s;
  }

  .setup-guide-link:hover {
    background: #2563eb;
  }

  :global(.dark) .setup-guide-link {
    background: #2563eb;
  }

  :global(.dark) .setup-guide-link:hover {
    background: #1d4ed8;
  }

  .inline-guide-link {
    color: #3b82f6;
    text-decoration: underline;
    font-weight: 500;
  }

  .inline-guide-link:hover {
    color: #2563eb;
  }

  :global(.dark) .inline-guide-link {
    color: #60a5fa;
  }

  :global(.dark) .inline-guide-link:hover {
    color: #93c5fd;
  }

  .tunnel-section {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .tunnel-section {
    background: #1f2937;
    border-color: #374151;
  }

  .tunnel-section h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: #111827;
  }

  :global(.dark) .tunnel-section h2 {
    color: #f9fafb;
  }

  .status-box {
    background: #f9fafb;
    border: 2px solid #d1d5db;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .status-box {
    background: #111827;
    border-color: #4b5563;
  }

  .status-box.status-running {
    border-color: #10b981;
    background: #ecfdf5;
  }

  :global(.dark) .status-box.status-running {
    background: #064e3b;
    border-color: #059669;
  }

  .status-box.status-stopped {
    border-color: #ef4444;
    background: #fef2f2;
  }

  :global(.dark) .status-box.status-stopped {
    background: #7f1d1d;
    border-color: #dc2626;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .dot-running {
    background: #10b981;
    box-shadow: 0 0 8px #10b981;
  }

  .dot-stopped {
    background: #ef4444;
  }

  .pid {
    color: #6b7280;
    font-size: 0.875rem;
  }

  .hostname {
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: #ffffff;
    border-radius: 4px;
    border: 1px solid #e5e7eb;
  }

  :global(.dark) .hostname {
    background: #374151;
    border-color: #4b5563;
  }

  .hostname a {
    color: #3b82f6;
    text-decoration: none;
    word-break: break-all;
  }

  .hostname a:hover {
    text-decoration: underline;
  }

  .tunnel-controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .button-group {
    display: flex;
    gap: 0.75rem;
  }

  .btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: none;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #3b82f6;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-danger {
    background: #ef4444;
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: #dc2626;
  }

  .info-box, .warning-box {
    padding: 1rem;
    border-radius: 6px;
    margin-top: 1rem;
  }

  .info-box {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
  }

  :global(.dark) .info-box {
    background: #1e3a8a;
    border-color: #3b82f6;
  }

  .warning-box {
    background: #fef3c7;
    border: 1px solid #fde68a;
  }

  :global(.dark) .warning-box {
    background: #78350f;
    border-color: #fbbf24;
  }

  .info-box h3, .warning-box strong {
    margin-bottom: 0.5rem;
  }

  .info-box ul {
    margin: 0.5rem 0 0 1.5rem;
  }

  .info-box li {
    margin-bottom: 0.5rem;
  }

  .warning-box code {
    display: block;
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: #ffffff;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.875rem;
  }

  .error-message, .success-message {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-top: 1rem;
  }

  .error-message {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  :global(.dark) .error-message {
    background: #7f1d1d;
    color: #fecaca;
    border-color: #dc2626;
  }

  .success-message {
    background: #d1fae5;
    color: #065f46;
    border: 1px solid #a7f3d0;
  }

  :global(.dark) .success-message {
    background: #064e3b;
    color: #a7f3d0;
    border-color: #059669;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
  }
</style>

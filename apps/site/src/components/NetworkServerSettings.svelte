<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch, isReactNativeWebView } from '../lib/client/api-config';
  import {
    isMobileApp,
    getApiBaseUrl,
    getApiBaseUrlAsync,
    setServerUrl,
    testServerConnection,
    getDefaultServers,
    initServerUrl
  } from '../lib/client/api-config';
  import {
    healthStatus,
    forceHealthCheck,
    getQualityColor,
    getQualityLabel,
    type HealthStatus
  } from '../lib/client/server-health';
  import TierSelector from './TierSelector.svelte';
  import SyncStatus from './SyncStatus.svelte';
  import UpdateManager from './UpdateManager.svelte';
  import ProfileManager from './ProfileManager.svelte';

  // ============ Shared State ============
  let isMobile = false;
  let loading = true;
  let error: string | null = null;
  let successMessage: string | null = null;

  // ============ Server Connection State ============
  interface ServerStatus {
    url: string;
    connected: boolean;
    latencyMs: number;
    version?: string;
    error?: string;
  }

  let currentServerUrl = '';
  let customServerUrl = '';
  let testing = false;
  let saving = false;
  let serverStatus: ServerStatus | null = null;
  let showCustomInput = false;
  let defaultServers: { local: string; cloud: string } = { local: '', cloud: '' };

  // Subscribe to health status for live updates
  let liveHealthStatus: HealthStatus | null = null;
  const unsubscribe = healthStatus.subscribe(s => {
    liveHealthStatus = s;
    if (s && serverStatus) {
      serverStatus = {
        ...serverStatus,
        connected: s.connected,
        latencyMs: s.latencyMs,
        error: s.error
      };
    }
  });

  // ============ Local Server Info State (Web) ============
  interface ServerInfo {
    hostname: string;
    port: number;
    platform: string;
    arch: string;
    primaryIP: string | null;
    urls: string[];
    interfaces: Array<{
      name: string;
      address: string;
      internal: boolean;
      url: string;
    }>;
  }

  let localServerInfo: ServerInfo | null = null;
  let loadingServerInfo = false;
  let copiedUrl = '';

  // ============ Network Info State (Mobile WiFi Broadcast) ============
  interface NetworkInfo {
    wifiBroadcastEnabled: boolean;
    port: number;
    addresses: Array<{ interface: string; address: string; url: string }>;
    localUrl: string;
    networkUrls: string[];
  }

  let networkInfo: NetworkInfo | null = null;

  // ============ Cloudflare Tunnel State ============
  interface TunnelStatus {
    installed: boolean;
    running: boolean;
    enabled: boolean;
    hostname: string;
    pid?: number;
  }

  let tunnelStatus: TunnelStatus | null = null;

  // ============ Headless Mode State ============
  interface RuntimeMode {
    headless: boolean;
    lastChangedBy: 'local' | 'remote';
    changedAt: string;
    claimedBy: string | null;
  }

  let runtimeMode: RuntimeMode | null = null;

  // ============ Server Connection Functions ============
  async function loadCurrentServer() {
    try {
      defaultServers = getDefaultServers();
      currentServerUrl = await getApiBaseUrlAsync();
      customServerUrl = currentServerUrl;
      await testCurrentConnection();
    } catch (err) {
      console.error('Failed to load server config:', err);
      error = err instanceof Error ? err.message : 'Failed to load configuration';
    }
  }

  async function testCurrentConnection() {
    if (!currentServerUrl) {
      // Web mode - test relative URL
      serverStatus = {
        url: window.location.origin,
        connected: true,
        latencyMs: 0,
        version: 'local'
      };
      return;
    }

    testing = true;
    error = null;

    try {
      const result = await testServerConnection(currentServerUrl);
      serverStatus = {
        url: currentServerUrl,
        connected: result.success,
        latencyMs: result.latencyMs,
        version: result.version,
        error: result.error
      };
    } catch (err) {
      serverStatus = {
        url: currentServerUrl,
        connected: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : 'Connection failed'
      };
    } finally {
      testing = false;
    }
  }

  async function testServer(url: string) {
    testing = true;
    error = null;
    successMessage = null;

    try {
      const result = await testServerConnection(url);
      if (result.success) {
        successMessage = `Connected! Latency: ${result.latencyMs}ms${result.version ? `, Version: ${result.version}` : ''}`;
        return true;
      } else {
        error = result.error || 'Connection failed';
        return false;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Connection test failed';
      return false;
    } finally {
      testing = false;
    }
  }

  async function saveServer(url: string) {
    saving = true;
    error = null;
    successMessage = null;

    try {
      const testResult = await testServerConnection(url);
      if (!testResult.success) {
        error = `Cannot connect to server: ${testResult.error}`;
        return;
      }

      await setServerUrl(url);
      currentServerUrl = url;
      customServerUrl = url;
      showCustomInput = false;

      successMessage = `Server updated to ${url}`;

      serverStatus = {
        url,
        connected: true,
        latencyMs: testResult.latencyMs,
        version: testResult.version
      };
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to save server';
    } finally {
      saving = false;
    }
  }

  function selectPresetServer(url: string) {
    customServerUrl = url;
    showCustomInput = false;
    saveServer(url);
  }

  function enableCustomServer() {
    showCustomInput = true;
    customServerUrl = '';
  }

  function cancelCustom() {
    showCustomInput = false;
    customServerUrl = currentServerUrl;
  }

  // ============ Local Server Info Functions (Web) ============
  async function loadLocalServerInfo() {
    loadingServerInfo = true;
    try {
      const response = await fetch('/api/server-info');
      const data = await response.json();
      if (data.success) {
        localServerInfo = data.server;
      }
    } catch (err) {
      console.error('Failed to load server info:', err);
    } finally {
      loadingServerInfo = false;
    }
  }

  async function copyToClipboard(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      copiedUrl = url;
      setTimeout(() => { copiedUrl = ''; }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  // ============ WiFi Broadcast Functions (Mobile) ============
  async function loadNetworkInfo() {
    if (!isMobile) return;
    try {
      const res = await apiFetch('/api/network-info');
      if (res.ok) {
        networkInfo = await res.json();
      }
    } catch (err) {
      console.warn('Failed to load network info:', err);
    }
  }

  async function toggleWifiBroadcast(enable: boolean) {
    error = null;
    successMessage = null;
    loading = true;

    try {
      const res = await apiFetch('/api/network-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wifiBroadcastEnabled: enable }),
      });

      if (res.ok) {
        const data = await res.json();
        successMessage = data.message || (enable ? 'WiFi broadcast enabled!' : 'WiFi broadcast disabled!');
        await loadNetworkInfo();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to toggle WiFi broadcast';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to toggle WiFi broadcast';
    } finally {
      loading = false;
    }
  }

  // ============ Cloudflare Tunnel Functions ============
  async function loadTunnelStatus() {
    try {
      const res = await apiFetch('/api/cloudflare/status');
      if (res.ok) {
        tunnelStatus = await res.json();
      }
    } catch (err) {
      console.error('Failed to load tunnel status:', err);
    }
  }

  async function toggleTunnel(enable: boolean) {
    error = null;
    successMessage = null;
    loading = true;

    try {
      const res = await apiFetch('/api/cloudflare/toggle', {
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
      const res = await apiFetch('/api/cloudflare/start', { method: 'POST' });
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
      const res = await apiFetch('/api/cloudflare/stop', { method: 'POST' });
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

  // ============ Headless Mode Functions ============
  async function loadRuntimeMode() {
    try {
      const res = await apiFetch('/api/runtime/mode');
      if (res.ok) {
        runtimeMode = await res.json();
      }
    } catch (err) {
      console.error('Failed to load runtime mode:', err);
    }
  }

  async function toggleHeadlessMode(enable: boolean) {
    error = null;
    successMessage = null;
    loading = true;

    try {
      const res = await apiFetch('/api/runtime/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: enable }),
      });

      if (res.ok) {
        successMessage = enable
          ? 'Headless mode enabled! Local agents will pause.'
          : 'Headless mode disabled! Local agents will resume.';
        await loadRuntimeMode();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to toggle headless mode';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to toggle headless mode';
    } finally {
      loading = false;
    }
  }

  // ============ Lifecycle ============
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    isMobile = isMobileApp() || isReactNativeWebView();
    loading = true;

    (async () => {
      await initServerUrl();
      await loadCurrentServer();
      await loadTunnelStatus();
      await loadRuntimeMode();

      if (isMobile) {
        await loadNetworkInfo();
      } else {
        await loadLocalServerInfo();
      }

      loading = false;
    })();

    // Periodic refresh
    refreshInterval = setInterval(() => {
      testCurrentConnection();
      loadTunnelStatus();
      loadRuntimeMode();
      if (isMobile) {
        loadNetworkInfo();
      }
    }, 30000);
  });

  onDestroy(() => {
    unsubscribe();
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });
</script>

<div class="settings-container">
  <div class="settings-header">
    <h1>🌐 Network & Server</h1>
    <p>Configure server connections, network access, and remote connectivity</p>
  </div>

  {#if loading && !serverStatus && !tunnelStatus}
    <div class="loading">Loading settings...</div>
  {:else}
    <!-- ============ CONNECTION STATUS (Always Shown) ============ -->
    <div class="section">
      <h2>📡 Connection Status</h2>

      <div class="status-box" class:status-connected={serverStatus?.connected} class:status-disconnected={!serverStatus?.connected}>
        <div class="status-indicator">
          <span class="status-dot" class:dot-connected={serverStatus?.connected} class:dot-disconnected={!serverStatus?.connected}></span>
          <strong>{serverStatus?.connected ? '✅ Connected' : '❌ Disconnected'}</strong>
          {#if testing}
            <span class="testing-badge">Testing...</span>
          {/if}
        </div>

        <div class="server-info-details">
          <div class="info-row">
            <span class="label">Server:</span>
            <span class="value">{serverStatus?.url || 'Not configured'}</span>
          </div>
          {#if serverStatus?.connected}
            <div class="info-row">
              <span class="label">Latency:</span>
              <span class="value latency" class:latency-good={serverStatus.latencyMs < 200} class:latency-warn={serverStatus.latencyMs >= 200 && serverStatus.latencyMs < 500} class:latency-bad={serverStatus.latencyMs >= 500}>
                {serverStatus.latencyMs}ms
              </span>
            </div>
            {#if serverStatus.version}
              <div class="info-row">
                <span class="label">Version:</span>
                <span class="value">{serverStatus.version}</span>
              </div>
            {/if}
          {:else if serverStatus?.error}
            <div class="info-row error">
              <span class="label">Error:</span>
              <span class="value">{serverStatus.error}</span>
            </div>
          {/if}
        </div>

        <button class="btn btn-secondary" on:click={testCurrentConnection} disabled={testing}>
          {testing ? 'Testing...' : '🔄 Test Connection'}
        </button>
      </div>
    </div>

    <!-- ============ LOCAL SERVER INFO (Web Mode) ============ -->
    <div class="section" class:section-disabled={isMobile}>
      <div class="section-header-row">
        <h2>🖥️ Local Server</h2>
        {#if isMobile}
          <span class="platform-badge">Desktop Only</span>
        {/if}
      </div>
      <p class="section-description">
        {#if isMobile}
          This feature shows local network addresses for connecting from other devices. Available when running from desktop.
        {:else}
          Your MetaHuman server is running locally. Other devices on the same WiFi network can connect using the addresses below.
        {/if}
      </p>

      {#if loadingServerInfo && !isMobile}
        <div class="loading-inline">Loading server info...</div>
      {:else if localServerInfo && !isMobile}
        <!-- Primary Connection URL -->
        {#if localServerInfo.primaryIP}
          <div class="primary-url-box">
            <div class="url-label">Connect from mobile devices:</div>
            <div class="url-display">
              <code>http://{localServerInfo.primaryIP}:{localServerInfo.port}</code>
              <button
                class="copy-btn"
                on:click={() => copyToClipboard(`http://${localServerInfo?.primaryIP}:${localServerInfo?.port}`)}
                title="Copy to clipboard"
                disabled={isMobile}
              >
                {copiedUrl === `http://${localServerInfo.primaryIP}:${localServerInfo.port}` ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>
          </div>
        {/if}

        <!-- Server Details -->
        <div class="server-details">
          <div class="detail-row">
            <span class="detail-label">Hostname:</span>
            <span class="detail-value">{localServerInfo.hostname}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Port:</span>
            <span class="detail-value">{localServerInfo.port}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Platform:</span>
            <span class="detail-value">{localServerInfo.platform} ({localServerInfo.arch})</span>
          </div>
        </div>

        <!-- All Network Interfaces -->
        <details class="interfaces-details">
          <summary>All Network Interfaces ({localServerInfo.interfaces.length})</summary>
          <div class="interfaces-list">
            {#each localServerInfo.interfaces as iface}
              <div class="interface-item" class:interface-internal={iface.internal}>
                <div class="interface-name">{iface.name}</div>
                <div class="interface-url">
                  <code>{iface.url}</code>
                  <button
                    class="copy-btn-small"
                    on:click={() => copyToClipboard(iface.url)}
                    title="Copy to clipboard"
                    disabled={isMobile}
                  >
                    {copiedUrl === iface.url ? '✓' : '📋'}
                  </button>
                </div>
                {#if iface.internal}
                  <span class="internal-badge">localhost</span>
                {/if}
              </div>
            {/each}
          </div>
        </details>
      {:else}
        <!-- Placeholder for mobile or when no data -->
        <div class="placeholder-content">
          <div class="primary-url-box" style="opacity: 0.5;">
            <div class="url-label">Connect from mobile devices:</div>
            <div class="url-display">
              <code>{isMobile ? 'Run MetaHuman on desktop to see server address' : 'http://192.168.x.x:4321'}</code>
            </div>
          </div>
          <div class="server-details" style="opacity: 0.5;">
            <div class="detail-row">
              <span class="detail-label">Hostname:</span>
              <span class="detail-value">{isMobile ? '—' : 'Loading...'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Port:</span>
              <span class="detail-value">{isMobile ? '—' : '4321'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Platform:</span>
              <span class="detail-value">{isMobile ? '—' : 'Loading...'}</span>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- ============ WIFI BROADCAST (Mobile) ============ -->
    <div class="section" class:section-disabled={!isMobile}>
      <div class="section-header-row">
        <h2>📡 WiFi Broadcasting</h2>
        {#if !isMobile}
          <span class="platform-badge">Mobile Only</span>
        {/if}
      </div>
      <p class="section-description">
        {#if isMobile}
          Enable other devices on your local WiFi network to connect to this device.
        {:else}
          This feature allows the mobile app to broadcast its server to other devices on the same WiFi network.
        {/if}
      </p>

      <div class="status-box" class:status-running={isMobile && networkInfo?.wifiBroadcastEnabled}>
        <div class="status-indicator">
          <span class="status-dot" class:dot-running={isMobile && networkInfo?.wifiBroadcastEnabled} class:dot-stopped={!isMobile || !networkInfo?.wifiBroadcastEnabled}></span>
          <strong>{isMobile ? (networkInfo?.wifiBroadcastEnabled ? '✅ Broadcasting' : '⭕ Local Only') : '—'}</strong>
        </div>

        {#if isMobile && networkInfo?.wifiBroadcastEnabled && networkInfo?.networkUrls?.length}
          <div class="hostname">
            <strong>Access from other devices:</strong>
            {#each networkInfo.networkUrls as url}
              <div style="margin-top: 0.5rem;">
                <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
              </div>
            {/each}
          </div>
        {:else if !isMobile}
          <div class="hostname" style="opacity: 0.5;">
            <strong>Access from other devices:</strong>
            <div style="margin-top: 0.5rem;">
              <span style="color: #6b7280;">Available on mobile app</span>
            </div>
          </div>
        {/if}

        <div class="tunnel-controls">
          <label class="toggle-label">
            <input
              type="checkbox"
              checked={isMobile ? (networkInfo?.wifiBroadcastEnabled || false) : false}
              on:change={(e) => toggleWifiBroadcast(e.currentTarget.checked)}
              disabled={!isMobile || loading}
            />
            <span>Enable WiFi Broadcast</span>
          </label>

          {#if isMobile && networkInfo?.wifiBroadcastEnabled}
            <div class="info-banner" style="background: #d1fae5; border-color: #a7f3d0;">
              <p><strong>⚠️ Restart Required:</strong> Changes take effect after restarting the app.</p>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- ============ SERVER SELECTION (Mobile) ============ -->
    <div class="section" class:section-disabled={!isMobile}>
      <div class="section-header-row">
        <h2>🔧 Server Selection</h2>
        {#if !isMobile}
          <span class="platform-badge">Mobile Only</span>
        {/if}
      </div>
      <p class="section-description">
        {#if isMobile}
          Choose which server to connect to. Your app will remember this setting.
        {:else}
          Mobile app server configuration. Use the mobile app to select between Home Server, Cloud Server, or a custom URL.
        {/if}
      </p>

      <div class="server-options">
        <!-- Local Server -->
        <button
          class="server-option"
          class:selected={isMobile && currentServerUrl === defaultServers.local && !showCustomInput}
          on:click={() => selectPresetServer(defaultServers.local)}
          disabled={!isMobile || saving}
        >
          <div class="option-icon">🏠</div>
          <div class="option-details">
            <strong>Home Server</strong>
            <span class="option-url">{defaultServers.local || 'http://192.168.x.x:4321'}</span>
            <span class="option-desc">Local Ollama with full model access</span>
          </div>
          {#if isMobile && currentServerUrl === defaultServers.local && !showCustomInput}
            <span class="selected-badge">Active</span>
          {/if}
        </button>

        <!-- Cloud Server -->
        <button
          class="server-option"
          class:selected={isMobile && currentServerUrl === defaultServers.cloud && !showCustomInput}
          on:click={() => selectPresetServer(defaultServers.cloud)}
          disabled={!isMobile || saving}
        >
          <div class="option-icon">☁️</div>
          <div class="option-details">
            <strong>Cloud Server</strong>
            <span class="option-url">{defaultServers.cloud || 'https://cloud.example.com'}</span>
            <span class="option-desc">RunPod GPU with Qwen3-Coder-30B</span>
          </div>
          {#if isMobile && currentServerUrl === defaultServers.cloud && !showCustomInput}
            <span class="selected-badge">Active</span>
          {/if}
        </button>

        <!-- Custom Server -->
        <button
          class="server-option"
          class:selected={isMobile && (showCustomInput || (currentServerUrl !== defaultServers.local && currentServerUrl !== defaultServers.cloud))}
          on:click={enableCustomServer}
          disabled={!isMobile || saving}
        >
          <div class="option-icon">⚙️</div>
          <div class="option-details">
            <strong>Custom Server</strong>
            {#if isMobile && !showCustomInput && currentServerUrl !== defaultServers.local && currentServerUrl !== defaultServers.cloud}
              <span class="option-url">{currentServerUrl}</span>
            {:else}
              <span class="option-desc">Enter a custom server URL</span>
            {/if}
          </div>
          {#if isMobile && !showCustomInput && currentServerUrl !== defaultServers.local && currentServerUrl !== defaultServers.cloud}
            <span class="selected-badge">Active</span>
          {/if}
        </button>
      </div>

      <!-- Custom URL Input -->
      {#if isMobile && showCustomInput}
        <div class="custom-input-section">
          <label for="custom-url">Custom Server URL:</label>
          <div class="input-group">
            <input
              id="custom-url"
              type="url"
              bind:value={customServerUrl}
              placeholder="https://your-server.example.com"
              disabled={saving || testing}
            />
            <button
              class="btn btn-primary"
              on:click={() => testServer(customServerUrl)}
              disabled={saving || testing || !customServerUrl}
            >
              Test
            </button>
          </div>
          <div class="button-row">
            <button
              class="btn btn-success"
              on:click={() => saveServer(customServerUrl)}
              disabled={saving || testing || !customServerUrl}
            >
              {saving ? 'Saving...' : 'Save & Connect'}
            </button>
            <button class="btn btn-secondary" on:click={cancelCustom} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- ============ CLOUDFLARE TUNNEL (Both) ============ -->
    {#if tunnelStatus}
      <div class="section">
        <div class="section-header-row">
          <h2>🌐 Cloudflare Tunnel</h2>
          <a href="https://github.com/yourusername/metahuman/blob/master/docs/user-guide/17-cloudflare-tunnel-setup.md" target="_blank" rel="noopener noreferrer" class="setup-guide-link">
            📖 Setup Guide
          </a>
        </div>
        <p class="section-description">
          Secure remote access to your MetaHuman server from anywhere without port forwarding.
        </p>

        {#if !tunnelStatus.installed}
          <div class="warning-box">
            <strong>⚠️ cloudflared not installed</strong>
            <p>Install cloudflared to enable secure tunneling:</p>
            <code>wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared-linux-amd64.deb</code>
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
    {/if}

    <!-- ============ HEADLESS MODE (Both) ============ -->
    {#if runtimeMode}
      <div class="section">
        <h2>🖥️ Headless Runtime Mode</h2>
        <p class="section-description">
          Pause local background agents when running remotely to prevent conflicts and save resources.
        </p>

        <div class="status-box" class:status-headless={runtimeMode.headless}>
          <div class="status-indicator">
            <span class="status-dot" class:dot-headless={runtimeMode.headless} class:dot-active={!runtimeMode.headless}></span>
            <strong>{runtimeMode.headless ? '🟡 Headless Mode Active' : '🟢 Normal Mode'}</strong>
          </div>

          {#if runtimeMode.headless}
            <div class="info-banner">
              <p><strong>ℹ️ Local agents are paused.</strong></p>
              <p>The tunnel and web server stay online, but background services (boredom, sleep, organizer, etc.) are stopped.</p>
            </div>
          {/if}

          <div class="tunnel-controls">
            <label class="toggle-label">
              <input
                type="checkbox"
                checked={runtimeMode.headless}
                on:change={(e) => toggleHeadlessMode(e.currentTarget.checked)}
                disabled={loading}
              />
              <span>Enable Headless Mode</span>
            </label>

            <div class="metadata">
              <small>Last changed: {new Date(runtimeMode.changedAt).toLocaleString()} ({runtimeMode.lastChangedBy})</small>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- ============ MOBILE FEATURES (Shown on all platforms) ============ -->
    <!-- Tier Selection -->
    <div class="section" class:section-disabled={!isMobile}>
      <div class="section-header-row">
        <h2>⚡ Compute Tier</h2>
        {#if !isMobile}
          <span class="platform-badge">Mobile Only</span>
        {/if}
      </div>
      <p class="section-description">
        Automatically select the best compute tier based on connectivity, battery, and task requirements.
      </p>
      {#if isMobile}
        <TierSelector />
      {:else}
        <div class="placeholder-content" style="opacity: 0.5;">
          <div class="status-box">
            <div class="status-indicator">
              <span class="status-dot dot-stopped"></span>
              <strong>—</strong>
            </div>
            <p style="font-size: 0.875rem; color: #6b7280;">Use mobile app to select compute tier</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- Memory Sync -->
    <div class="section" class:section-disabled={!isMobile}>
      <div class="section-header-row">
        <h2>🔄 Memory Sync</h2>
        {#if !isMobile}
          <span class="platform-badge">Mobile Only</span>
        {/if}
      </div>
      <p class="section-description">
        Keep your memories synchronized between devices. Changes made offline will sync when reconnected.
      </p>
      {#if isMobile}
        <SyncStatus />
      {:else}
        <div class="placeholder-content" style="opacity: 0.5;">
          <div class="status-box">
            <div class="status-indicator">
              <span class="status-dot dot-stopped"></span>
              <strong>—</strong>
            </div>
            <p style="font-size: 0.875rem; color: #6b7280;">Use mobile app to sync memories</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- App Updates -->
    <div class="section" class:section-disabled={!isMobile}>
      <div class="section-header-row">
        <h2>⬇️ App Updates</h2>
        {#if !isMobile}
          <span class="platform-badge">Mobile Only</span>
        {/if}
      </div>
      <p class="section-description">
        Check for and download new versions of the MetaHuman app from your connected server.
      </p>
      {#if isMobile}
        <UpdateManager />
      {:else}
        <div class="placeholder-content" style="opacity: 0.5;">
          <div class="status-box">
            <div class="status-indicator">
              <span class="status-dot dot-stopped"></span>
              <strong>—</strong>
            </div>
            <p style="font-size: 0.875rem; color: #6b7280;">Use mobile app to check for updates</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- Profile Management -->
    <div class="section" class:section-disabled={!isMobile}>
      <div class="section-header-row">
        <h2>👤 Profile Data</h2>
        {#if !isMobile}
          <span class="platform-badge">Mobile Only</span>
        {/if}
      </div>
      <p class="section-description">
        Download your profile for offline use, create local profiles, or sync changes with the server.
      </p>
      {#if isMobile}
        <ProfileManager />
      {:else}
        <div class="placeholder-content" style="opacity: 0.5;">
          <div class="status-box">
            <div class="status-indicator">
              <span class="status-dot dot-stopped"></span>
              <strong>—</strong>
            </div>
            <p style="font-size: 0.875rem; color: #6b7280;">Use mobile app to manage profile data</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- ============ MESSAGES ============ -->
    {#if error}
      <div class="error-message">{error}</div>
    {/if}

    {#if successMessage}
      <div class="success-message">{successMessage}</div>
    {/if}
  {/if}
</div>

<style>
  .settings-container {
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .settings-header {
    margin-bottom: 2rem;
  }

  .settings-header h1 {
    font-size: 2rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #1f2937;
  }

  :global(.dark) .settings-header h1 {
    color: #f9fafb;
  }

  .settings-header p {
    color: #6b7280;
  }

  :global(.dark) .settings-header p {
    color: #9ca3af;
  }

  .section {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .section {
    background: #1f2937;
    border-color: #374151;
  }

  .section.section-disabled {
    opacity: 0.6;
    pointer-events: none;
  }

  .section.section-info {
    background: #f0f9ff;
    border-color: #bae6fd;
  }

  :global(.dark) .section.section-info {
    background: #0c4a6e;
    border-color: #0369a1;
  }

  .section-header-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  .section h2 {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0;
    color: #111827;
  }

  :global(.dark) .section h2 {
    color: #f9fafb;
  }

  .section-description {
    color: #6b7280;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  :global(.dark) .section-description {
    color: #9ca3af;
  }

  .platform-badge {
    font-size: 0.75rem;
    padding: 0.25rem 0.75rem;
    background: #f3f4f6;
    color: #6b7280;
    border-radius: 9999px;
    font-weight: 500;
  }

  :global(.dark) .platform-badge {
    background: #374151;
    color: #9ca3af;
  }

  .setup-guide-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    background: #3b82f6;
    color: white;
    text-decoration: none;
    border-radius: 6px;
    font-weight: 500;
    font-size: 0.75rem;
    transition: background 0.15s;
  }

  .setup-guide-link:hover {
    background: #2563eb;
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

  .status-box.status-connected,
  .status-box.status-running {
    border-color: #10b981;
    background: #ecfdf5;
  }

  :global(.dark) .status-box.status-connected,
  :global(.dark) .status-box.status-running {
    background: #064e3b;
    border-color: #059669;
  }

  .status-box.status-disconnected,
  .status-box.status-stopped {
    border-color: #ef4444;
    background: #fef2f2;
  }

  :global(.dark) .status-box.status-disconnected,
  :global(.dark) .status-box.status-stopped {
    background: #7f1d1d;
    border-color: #dc2626;
  }

  .status-box.status-headless {
    border-color: #f59e0b;
    background: #fffbeb;
  }

  :global(.dark) .status-box.status-headless {
    background: #78350f;
    border-color: #f59e0b;
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

  .dot-connected, .dot-running, .dot-active {
    background: #10b981;
    box-shadow: 0 0 8px #10b981;
  }

  .dot-disconnected, .dot-stopped {
    background: #ef4444;
  }

  .dot-headless {
    background: #f59e0b;
    box-shadow: 0 0 8px #f59e0b;
  }

  .testing-badge {
    font-size: 0.75rem;
    background: #3b82f6;
    color: white;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    margin-left: 0.5rem;
  }

  .pid {
    color: #6b7280;
    font-size: 0.875rem;
  }

  .server-info-details, .server-details {
    margin-bottom: 1rem;
  }

  .info-row, .detail-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  .detail-row {
    justify-content: space-between;
    padding: 0.375rem 0;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .detail-row {
    border-color: #374151;
  }

  .detail-row:last-child {
    border-bottom: none;
  }

  .info-row .label, .detail-label {
    color: #6b7280;
    min-width: 80px;
  }

  :global(.dark) .info-row .label,
  :global(.dark) .detail-label {
    color: #9ca3af;
  }

  .info-row .value, .detail-value {
    color: #111827;
    word-break: break-all;
  }

  :global(.dark) .info-row .value,
  :global(.dark) .detail-value {
    color: #f3f4f6;
  }

  .info-row.error .value {
    color: #dc2626;
  }

  :global(.dark) .info-row.error .value {
    color: #fca5a5;
  }

  .detail-value {
    font-weight: 500;
  }

  .latency {
    font-weight: 600;
  }

  .latency-good { color: #10b981 !important; }
  .latency-warn { color: #f59e0b !important; }
  .latency-bad { color: #ef4444 !important; }

  /* Primary URL Box */
  .primary-url-box {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  .url-label {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.9);
    margin-bottom: 0.5rem;
  }

  .url-display {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .url-display code {
    font-size: 1.125rem;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    color: white;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    flex: 1;
    min-width: 200px;
  }

  .copy-btn {
    padding: 0.5rem 1rem;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: white;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.15s;
  }

  .copy-btn:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  /* Server Details */
  .server-details {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .server-details {
    background: #111827;
    border-color: #374151;
  }

  /* Network Interfaces */
  .interfaces-details {
    margin-bottom: 1rem;
  }

  .interfaces-details summary {
    cursor: pointer;
    padding: 0.75rem;
    background: #f3f4f6;
    border-radius: 6px;
    color: #374151;
    font-size: 0.875rem;
    font-weight: 500;
  }

  :global(.dark) .interfaces-details summary {
    background: #1f2937;
    color: #e5e7eb;
  }

  .interfaces-details summary:hover {
    background: #e5e7eb;
  }

  :global(.dark) .interfaces-details summary:hover {
    background: #374151;
  }

  .interfaces-list {
    margin-top: 0.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    overflow: hidden;
  }

  :global(.dark) .interfaces-list {
    border-color: #374151;
  }

  .interface-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: #f9fafb;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .interface-item {
    background: #111827;
    border-color: #374151;
  }

  .interface-item:last-child {
    border-bottom: none;
  }

  .interface-item.interface-internal {
    opacity: 0.6;
  }

  .interface-name {
    font-weight: 600;
    font-size: 0.75rem;
    color: #6b7280;
    min-width: 80px;
  }

  :global(.dark) .interface-name {
    color: #9ca3af;
  }

  .interface-url {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .interface-url code {
    font-size: 0.75rem;
    color: #3b82f6;
    background: none;
    padding: 0;
  }

  .copy-btn-small {
    padding: 0.25rem 0.5rem;
    background: #e5e7eb;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75rem;
    transition: background 0.15s;
  }

  :global(.dark) .copy-btn-small {
    background: #374151;
  }

  .copy-btn-small:hover {
    background: #d1d5db;
  }

  :global(.dark) .copy-btn-small:hover {
    background: #4b5563;
  }

  .internal-badge {
    font-size: 0.625rem;
    background: #9ca3af;
    color: white;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    text-transform: uppercase;
  }

  /* Server Options */
  .server-options {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .server-option {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: #f9fafb;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    width: 100%;
  }

  :global(.dark) .server-option {
    background: #111827;
    border-color: #374151;
  }

  .server-option:hover:not(:disabled) {
    border-color: #3b82f6;
    background: #eff6ff;
  }

  :global(.dark) .server-option:hover:not(:disabled) {
    background: #1e3a8a;
    border-color: #3b82f6;
  }

  .server-option.selected {
    border-color: #10b981;
    background: #ecfdf5;
  }

  :global(.dark) .server-option.selected {
    background: #064e3b;
    border-color: #059669;
  }

  .server-option:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .option-icon {
    font-size: 2rem;
    flex-shrink: 0;
  }

  .option-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .option-details strong {
    color: #111827;
    font-size: 1rem;
  }

  :global(.dark) .option-details strong {
    color: #f9fafb;
  }

  .option-url {
    font-family: monospace;
    font-size: 0.75rem;
    color: #3b82f6;
    word-break: break-all;
  }

  .option-desc {
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .option-desc {
    color: #9ca3af;
  }

  .selected-badge {
    background: #10b981;
    color: white;
    font-size: 0.75rem;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-weight: 600;
  }

  /* Custom Input */
  .custom-input-section {
    margin-top: 1rem;
    padding: 1rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }

  :global(.dark) .custom-input-section {
    background: #111827;
    border-color: #374151;
  }

  .custom-input-section label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: #374151;
  }

  :global(.dark) .custom-input-section label {
    color: #e5e7eb;
  }

  .input-group {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .input-group input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.875rem;
    background: white;
    color: #111827;
  }

  :global(.dark) .input-group input {
    background: #374151;
    border-color: #4b5563;
    color: #f9fafb;
  }

  .input-group input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .button-row, .button-group {
    display: flex;
    gap: 0.5rem;
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

  /* Buttons */
  .btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: none;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    font-size: 0.875rem;
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

  .btn-secondary {
    background: #e5e7eb;
    color: #374151;
  }

  :global(.dark) .btn-secondary {
    background: #4b5563;
    color: #f9fafb;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #d1d5db;
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: #6b7280;
  }

  .btn-success {
    background: #10b981;
    color: white;
  }

  .btn-success:hover:not(:disabled) {
    background: #059669;
  }

  .btn-danger {
    background: #ef4444;
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: #dc2626;
  }

  /* Info/Warning Boxes */
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
    color: #1e40af;
    font-size: 0.875rem;
  }

  :global(.dark) .info-box li {
    color: #bfdbfe;
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

  .info-banner {
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 4px;
  }

  :global(.dark) .info-banner {
    background: #92400e;
    border-color: #f59e0b;
  }

  .info-banner p {
    margin: 0.25rem 0;
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

  .metadata {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .metadata {
    border-color: #4b5563;
  }

  .metadata small {
    color: #6b7280;
    font-size: 0.75rem;
  }

  :global(.dark) .metadata small {
    color: #9ca3af;
  }

  /* Messages */
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

  .loading-inline {
    padding: 1rem;
    color: #6b7280;
    font-style: italic;
  }
</style>

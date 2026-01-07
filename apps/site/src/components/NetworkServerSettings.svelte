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

<div class="p-8 max-w-[900px] mx-auto h-full overflow-y-auto overflow-x-hidden">
  <div class="mb-8">
    <h1 class="text-2xl font-semibold mb-2 text-gray-800 dark:text-gray-50">🌐 Network & Server</h1>
    <p class="text-gray-500 dark:text-gray-400">Configure server connections, network access, and remote connectivity</p>
  </div>

  {#if loading && !serverStatus && !tunnelStatus}
    <div class="text-center py-8 text-gray-500">Loading settings...</div>
  {:else}
    <!-- ============ CONNECTION STATUS (Always Shown) ============ -->
    <div class="panel mb-6">
      <h2 class="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-50">📡 Connection Status</h2>

      <div class="rounded-md p-4 mb-4 border-2 {serverStatus?.connected ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/50' : 'border-red-500 bg-red-50 dark:bg-red-900/50'}">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-3 h-3 rounded-full {serverStatus?.connected ? 'bg-emerald-500 shadow-[0_0_8px_theme(colors.emerald.500)]' : 'bg-red-500'}"></span>
          <strong>{serverStatus?.connected ? '✅ Connected' : '❌ Disconnected'}</strong>
          {#if testing}
            <span class="text-xs bg-blue-500 text-white px-2 py-0.5 rounded ml-2">Testing...</span>
          {/if}
        </div>

        <div class="mb-4">
          <div class="flex gap-2 mb-2 text-sm">
            <span class="text-gray-500 dark:text-gray-400 min-w-[80px]">Server:</span>
            <span class="text-gray-900 dark:text-gray-100 break-all">{serverStatus?.url || 'Not configured'}</span>
          </div>
          {#if serverStatus?.connected}
            <div class="flex gap-2 mb-2 text-sm">
              <span class="text-gray-500 dark:text-gray-400 min-w-[80px]">Latency:</span>
              <span class="font-semibold {serverStatus.latencyMs < 200 ? 'text-emerald-500' : serverStatus.latencyMs < 500 ? 'text-amber-500' : 'text-red-500'}">
                {serverStatus.latencyMs}ms
              </span>
            </div>
            {#if serverStatus.version}
              <div class="flex gap-2 mb-2 text-sm">
                <span class="text-gray-500 dark:text-gray-400 min-w-[80px]">Version:</span>
                <span class="text-gray-900 dark:text-gray-100">{serverStatus.version}</span>
              </div>
            {/if}
          {:else if serverStatus?.error}
            <div class="flex gap-2 mb-2 text-sm">
              <span class="text-gray-500 dark:text-gray-400 min-w-[80px]">Error:</span>
              <span class="text-red-600 dark:text-red-400">{serverStatus.error}</span>
            </div>
          {/if}
        </div>

        <button class="btn-secondary" on:click={testCurrentConnection} disabled={testing}>
          {testing ? 'Testing...' : '🔄 Test Connection'}
        </button>
      </div>
    </div>

    <!-- ============ LOCAL SERVER INFO (Web Mode) ============ -->
    <div class="panel mb-6 {isMobile ? 'opacity-60 pointer-events-none' : ''}">
      <div class="flex items-center gap-4 flex-wrap mb-3">
        <h2 class="text-lg font-semibold m-0 text-gray-900 dark:text-gray-50">🖥️ Local Server</h2>
        {#if isMobile}
          <span class="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full font-medium">Desktop Only</span>
        {/if}
      </div>
      <p class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
        {#if isMobile}
          This feature shows local network addresses for connecting from other devices. Available when running from desktop.
        {:else}
          Your MetaHuman server is running locally. Other devices on the same WiFi network can connect using the addresses below.
        {/if}
      </p>

      {#if loadingServerInfo && !isMobile}
        <div class="py-4 text-gray-500 italic">Loading server info...</div>
      {:else if localServerInfo && !isMobile}
        <!-- Primary Connection URL -->
        {#if localServerInfo.primaryIP}
          <div class="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg p-5 mb-4">
            <div class="text-sm text-white/90 mb-2">Connect from mobile devices:</div>
            <div class="flex items-center gap-3 flex-wrap">
              <code class="text-lg font-mono text-white bg-black/20 px-3 py-2 rounded-md flex-1 min-w-[200px]">http://{localServerInfo.primaryIP}:{localServerInfo.port}</code>
              <button
                class="px-4 py-2 bg-white/20 border border-white/30 text-white rounded-md text-sm hover:bg-white/30 transition-colors"
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
        <div class="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-4 mb-4">
          <div class="flex justify-between py-1.5 border-b border-gray-200 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Hostname:</span>
            <span class="text-gray-900 dark:text-gray-100 font-medium">{localServerInfo.hostname}</span>
          </div>
          <div class="flex justify-between py-1.5 border-b border-gray-200 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Port:</span>
            <span class="text-gray-900 dark:text-gray-100 font-medium">{localServerInfo.port}</span>
          </div>
          <div class="flex justify-between py-1.5">
            <span class="text-gray-500 dark:text-gray-400">Platform:</span>
            <span class="text-gray-900 dark:text-gray-100 font-medium">{localServerInfo.platform} ({localServerInfo.arch})</span>
          </div>
        </div>

        <!-- All Network Interfaces -->
        <details class="mb-4">
          <summary class="cursor-pointer px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-md text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700">
            All Network Interfaces ({localServerInfo.interfaces.length})
          </summary>
          <div class="mt-2 border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
            {#each localServerInfo.interfaces as iface}
              <div class="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 last:border-b-0 {iface.internal ? 'opacity-60' : ''}">
                <div class="font-semibold text-xs text-gray-500 dark:text-gray-400 min-w-[80px]">{iface.name}</div>
                <div class="flex-1 flex items-center gap-2">
                  <code class="text-xs text-blue-500">{iface.url}</code>
                  <button
                    class="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    on:click={() => copyToClipboard(iface.url)}
                    title="Copy to clipboard"
                    disabled={isMobile}
                  >
                    {copiedUrl === iface.url ? '✓' : '📋'}
                  </button>
                </div>
                {#if iface.internal}
                  <span class="text-[0.625rem] bg-gray-400 text-white px-1.5 py-0.5 rounded uppercase">localhost</span>
                {/if}
              </div>
            {/each}
          </div>
        </details>
      {:else}
        <!-- Placeholder for mobile or when no data -->
        <div class="opacity-50">
          <div class="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg p-5 mb-4">
            <div class="text-sm text-white/90 mb-2">Connect from mobile devices:</div>
            <div class="flex items-center gap-3 flex-wrap">
              <code class="text-lg font-mono text-white bg-black/20 px-3 py-2 rounded-md flex-1 min-w-[200px]">{isMobile ? 'Run MetaHuman on desktop to see server address' : 'http://192.168.x.x:4321'}</code>
            </div>
          </div>
          <div class="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-4">
            <div class="flex justify-between py-1.5 border-b border-gray-200 dark:border-gray-700">
              <span class="text-gray-500 dark:text-gray-400">Hostname:</span>
              <span class="text-gray-900 dark:text-gray-100 font-medium">{isMobile ? '—' : 'Loading...'}</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-gray-200 dark:border-gray-700">
              <span class="text-gray-500 dark:text-gray-400">Port:</span>
              <span class="text-gray-900 dark:text-gray-100 font-medium">{isMobile ? '—' : '4321'}</span>
            </div>
            <div class="flex justify-between py-1.5">
              <span class="text-gray-500 dark:text-gray-400">Platform:</span>
              <span class="text-gray-900 dark:text-gray-100 font-medium">{isMobile ? '—' : 'Loading...'}</span>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- ============ WIFI BROADCAST (Mobile) ============ -->
    <div class="panel mb-6 {!isMobile ? 'opacity-60 pointer-events-none' : ''}">
      <div class="flex items-center gap-4 flex-wrap mb-3">
        <h2 class="text-lg font-semibold m-0 text-gray-900 dark:text-gray-50">📡 WiFi Broadcasting</h2>
        {#if !isMobile}
          <span class="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full font-medium">Mobile Only</span>
        {/if}
      </div>
      <p class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
        {#if isMobile}
          Enable other devices on your local WiFi network to connect to this device.
        {:else}
          This feature allows the mobile app to broadcast its server to other devices on the same WiFi network.
        {/if}
      </p>

      <div class="rounded-md p-4 mb-4 border-2 {isMobile && networkInfo?.wifiBroadcastEnabled ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/50' : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900'}">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-3 h-3 rounded-full {isMobile && networkInfo?.wifiBroadcastEnabled ? 'bg-emerald-500 shadow-[0_0_8px_theme(colors.emerald.500)]' : 'bg-red-500'}"></span>
          <strong>{isMobile ? (networkInfo?.wifiBroadcastEnabled ? '✅ Broadcasting' : '⭕ Local Only') : '—'}</strong>
        </div>

        {#if isMobile && networkInfo?.wifiBroadcastEnabled && networkInfo?.networkUrls?.length}
          <div class="mb-4 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <strong>Access from other devices:</strong>
            {#each networkInfo.networkUrls as url}
              <div class="mt-2">
                <a href={url} target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline break-all">{url}</a>
              </div>
            {/each}
          </div>
        {:else if !isMobile}
          <div class="mb-4 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 opacity-50">
            <strong>Access from other devices:</strong>
            <div class="mt-2">
              <span class="text-gray-500">Available on mobile app</span>
            </div>
          </div>
        {/if}

        <div class="flex flex-col gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isMobile ? (networkInfo?.wifiBroadcastEnabled || false) : false}
              on:change={(e) => toggleWifiBroadcast(e.currentTarget.checked)}
              disabled={!isMobile || loading}
            />
            <span>Enable WiFi Broadcast</span>
          </label>

          {#if isMobile && networkInfo?.wifiBroadcastEnabled}
            <div class="p-3 bg-green-100 dark:bg-green-900/50 border border-green-300 dark:border-green-700 rounded">
              <p class="m-0 text-sm"><strong>⚠️ Restart Required:</strong> Changes take effect after restarting the app.</p>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- ============ SERVER SELECTION (Mobile) ============ -->
    <div class="panel mb-6 {!isMobile ? 'opacity-60 pointer-events-none' : ''}">
      <div class="flex items-center gap-4 flex-wrap mb-3">
        <h2 class="text-lg font-semibold m-0 text-gray-900 dark:text-gray-50">🔧 Server Selection</h2>
        {#if !isMobile}
          <span class="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full font-medium">Mobile Only</span>
        {/if}
      </div>
      <p class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
        {#if isMobile}
          Choose which server to connect to. Your app will remember this setting.
        {:else}
          Mobile app server configuration. Use the mobile app to select between Home Server, Cloud Server, or a custom URL.
        {/if}
      </p>

      <div class="flex flex-col gap-3">
        <!-- Local Server -->
        <button
          class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-900 border-2 rounded-lg text-left w-full transition-all {isMobile && currentServerUrl === defaultServers.local && !showCustomInput ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/50' : 'border-gray-200 dark:border-gray-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'} disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={() => selectPresetServer(defaultServers.local)}
          disabled={!isMobile || saving}
        >
          <div class="text-3xl flex-shrink-0">🏠</div>
          <div class="flex-1 flex flex-col gap-1">
            <strong class="text-gray-900 dark:text-gray-50">Home Server</strong>
            <span class="font-mono text-xs text-blue-500 break-all">{defaultServers.local || 'http://192.168.x.x:4321'}</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">Local Ollama with full model access</span>
          </div>
          {#if isMobile && currentServerUrl === defaultServers.local && !showCustomInput}
            <span class="bg-emerald-500 text-white text-xs px-3 py-1 rounded-full font-semibold">Active</span>
          {/if}
        </button>

        <!-- Cloud Server -->
        <button
          class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-900 border-2 rounded-lg text-left w-full transition-all {isMobile && currentServerUrl === defaultServers.cloud && !showCustomInput ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/50' : 'border-gray-200 dark:border-gray-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'} disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={() => selectPresetServer(defaultServers.cloud)}
          disabled={!isMobile || saving}
        >
          <div class="text-3xl flex-shrink-0">☁️</div>
          <div class="flex-1 flex flex-col gap-1">
            <strong class="text-gray-900 dark:text-gray-50">Cloud Server</strong>
            <span class="font-mono text-xs text-blue-500 break-all">{defaultServers.cloud || 'https://cloud.example.com'}</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">RunPod GPU with Qwen3-Coder-30B</span>
          </div>
          {#if isMobile && currentServerUrl === defaultServers.cloud && !showCustomInput}
            <span class="bg-emerald-500 text-white text-xs px-3 py-1 rounded-full font-semibold">Active</span>
          {/if}
        </button>

        <!-- Custom Server -->
        <button
          class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-900 border-2 rounded-lg text-left w-full transition-all {isMobile && (showCustomInput || (currentServerUrl !== defaultServers.local && currentServerUrl !== defaultServers.cloud)) ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/50' : 'border-gray-200 dark:border-gray-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'} disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={enableCustomServer}
          disabled={!isMobile || saving}
        >
          <div class="text-3xl flex-shrink-0">⚙️</div>
          <div class="flex-1 flex flex-col gap-1">
            <strong class="text-gray-900 dark:text-gray-50">Custom Server</strong>
            {#if isMobile && !showCustomInput && currentServerUrl !== defaultServers.local && currentServerUrl !== defaultServers.cloud}
              <span class="font-mono text-xs text-blue-500 break-all">{currentServerUrl}</span>
            {:else}
              <span class="text-xs text-gray-500 dark:text-gray-400">Enter a custom server URL</span>
            {/if}
          </div>
          {#if isMobile && !showCustomInput && currentServerUrl !== defaultServers.local && currentServerUrl !== defaultServers.cloud}
            <span class="bg-emerald-500 text-white text-xs px-3 py-1 rounded-full font-semibold">Active</span>
          {/if}
        </button>
      </div>

      <!-- Custom URL Input -->
      {#if isMobile && showCustomInput}
        <div class="mt-4 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md">
          <label for="custom-url" class="block mb-2 font-medium text-gray-600 dark:text-gray-300">Custom Server URL:</label>
          <div class="flex gap-2 mb-4">
            <input
              id="custom-url"
              type="url"
              bind:value={customServerUrl}
              placeholder="https://your-server.example.com"
              disabled={saving || testing}
              class="input-field flex-1"
            />
            <button
              class="btn-primary"
              on:click={() => testServer(customServerUrl)}
              disabled={saving || testing || !customServerUrl}
            >
              Test
            </button>
          </div>
          <div class="flex gap-2">
            <button
              class="btn-success"
              on:click={() => saveServer(customServerUrl)}
              disabled={saving || testing || !customServerUrl}
            >
              {saving ? 'Saving...' : 'Save & Connect'}
            </button>
            <button class="btn-secondary" on:click={cancelCustom} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- ============ CLOUDFLARE TUNNEL (Both) ============ -->
    {#if tunnelStatus}
      <div class="panel mb-6">
        <div class="flex items-center gap-4 flex-wrap mb-3">
          <h2 class="text-lg font-semibold m-0 text-gray-900 dark:text-gray-50">🌐 Cloudflare Tunnel</h2>
          <a href="https://github.com/yourusername/metahuman/blob/master/docs/user-guide/17-cloudflare-tunnel-setup.md" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white no-underline rounded-md font-medium text-xs hover:bg-blue-600 transition-colors">
            📖 Setup Guide
          </a>
        </div>
        <p class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
          Secure remote access to your MetaHuman server from anywhere without port forwarding.
        </p>

        {#if !tunnelStatus.installed}
          <div class="p-4 rounded-md mt-4 bg-amber-100 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-600">
            <strong>⚠️ cloudflared not installed</strong>
            <p>Install cloudflared to enable secure tunneling:</p>
            <code class="block mt-2 p-2 bg-white dark:bg-gray-800 rounded text-sm overflow-x-auto">wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared-linux-amd64.deb</code>
          </div>
        {:else}
          <div class="rounded-md p-4 mb-4 border-2 {tunnelStatus.running ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/50' : 'border-red-500 bg-red-50 dark:bg-red-900/50'}">
            <div class="flex items-center gap-2 mb-3">
              <span class="w-3 h-3 rounded-full {tunnelStatus.running ? 'bg-emerald-500 shadow-[0_0_8px_theme(colors.emerald.500)]' : 'bg-red-500'}"></span>
              <strong>{tunnelStatus.running ? '✅ Running' : '⭕ Stopped'}</strong>
              {#if tunnelStatus.pid}
                <span class="text-gray-500 text-sm">(PID: {tunnelStatus.pid})</span>
              {/if}
            </div>

            {#if tunnelStatus.hostname}
              <div class="mb-4 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                <strong>Public URL:</strong>
                <a href="https://{tunnelStatus.hostname}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline break-all">
                  https://{tunnelStatus.hostname}
                </a>
              </div>
            {/if}

            <div class="flex flex-col gap-4">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tunnelStatus.enabled}
                  on:change={(e) => toggleTunnel(e.currentTarget.checked)}
                  disabled={loading}
                />
                <span>Auto-start on boot</span>
              </label>

              <div class="flex gap-2">
                <button
                  class="btn-primary"
                  on:click={startTunnel}
                  disabled={loading || tunnelStatus.running}
                >
                  Start Tunnel
                </button>
                <button
                  class="btn-danger"
                  on:click={stopTunnel}
                  disabled={loading || !tunnelStatus.running}
                >
                  Stop Tunnel
                </button>
              </div>
            </div>
          </div>

          <div class="p-4 rounded-md mt-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700">
            <h3 class="mb-2 text-gray-900 dark:text-gray-100">ℹ️ How It Works</h3>
            <ul class="mt-2 ml-6 list-disc">
              <li class="mb-2 text-blue-800 dark:text-blue-200 text-sm"><strong>Auto-start:</strong> When enabled, the tunnel starts automatically when MetaHuman starts</li>
              <li class="mb-2 text-blue-800 dark:text-blue-200 text-sm"><strong>No port forwarding:</strong> Cloudflare tunnel creates a secure connection without opening router ports</li>
              <li class="mb-2 text-blue-800 dark:text-blue-200 text-sm"><strong>HTTPS included:</strong> Automatic SSL certificates from Cloudflare</li>
              <li class="mb-2 text-blue-800 dark:text-blue-200 text-sm"><strong>Access control:</strong> Configure email whitelisting in Cloudflare Zero Trust dashboard</li>
            </ul>
          </div>
        {/if}
      </div>
    {/if}

    <!-- ============ HEADLESS MODE (Both) ============ -->
    {#if runtimeMode}
      <div class="panel mb-6">
        <h2 class="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-50">🖥️ Headless Runtime Mode</h2>
        <p class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
          Pause local background agents when running remotely to prevent conflicts and save resources.
        </p>

        <div class="rounded-md p-4 mb-4 border-2 {runtimeMode.headless ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/50' : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900'}">
          <div class="flex items-center gap-2 mb-3">
            <span class="w-3 h-3 rounded-full {runtimeMode.headless ? 'bg-amber-500 shadow-[0_0_8px_theme(colors.amber.500)]' : 'bg-emerald-500 shadow-[0_0_8px_theme(colors.emerald.500)]'}"></span>
            <strong>{runtimeMode.headless ? '🟡 Headless Mode Active' : '🟢 Normal Mode'}</strong>
          </div>

          {#if runtimeMode.headless}
            <div class="mb-4 p-3 bg-amber-100 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-700 rounded">
              <p class="m-0 text-sm"><strong>ℹ️ Local agents are paused.</strong></p>
              <p class="m-1 text-sm">The tunnel and web server stay online, but background services (boredom, sleep, organizer, etc.) are stopped.</p>
            </div>
          {/if}

          <div class="flex flex-col gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={runtimeMode.headless}
                on:change={(e) => toggleHeadlessMode(e.currentTarget.checked)}
                disabled={loading}
              />
              <span>Enable Headless Mode</span>
            </label>

            <div class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <small class="text-gray-500 dark:text-gray-400 text-xs">Last changed: {new Date(runtimeMode.changedAt).toLocaleString()} ({runtimeMode.lastChangedBy})</small>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- ============ MOBILE FEATURES (Shown on all platforms) ============ -->
    <!-- Tier Selection -->
    <div class="panel mb-6 {!isMobile ? 'opacity-60 pointer-events-none' : ''}">
      <div class="flex items-center gap-4 flex-wrap mb-3">
        <h2 class="text-lg font-semibold m-0 text-gray-900 dark:text-gray-50">⚡ Compute Tier</h2>
        {#if !isMobile}
          <span class="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full font-medium">Mobile Only</span>
        {/if}
      </div>
      <p class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
        Automatically select the best compute tier based on connectivity, battery, and task requirements.
      </p>
      {#if isMobile}
        <TierSelector />
      {:else}
        <div class="opacity-50">
          <div class="rounded-md p-4 border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
            <div class="flex items-center gap-2 mb-3">
              <span class="w-3 h-3 rounded-full bg-red-500"></span>
              <strong>—</strong>
            </div>
            <p class="text-sm text-gray-500">Use mobile app to select compute tier</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- Memory Sync -->
    <div class="panel mb-6 {!isMobile ? 'opacity-60 pointer-events-none' : ''}">
      <div class="flex items-center gap-4 flex-wrap mb-3">
        <h2 class="text-lg font-semibold m-0 text-gray-900 dark:text-gray-50">🔄 Memory Sync</h2>
        {#if !isMobile}
          <span class="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full font-medium">Mobile Only</span>
        {/if}
      </div>
      <p class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
        Keep your memories synchronized between devices. Changes made offline will sync when reconnected.
      </p>
      {#if isMobile}
        <SyncStatus />
      {:else}
        <div class="opacity-50">
          <div class="rounded-md p-4 border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
            <div class="flex items-center gap-2 mb-3">
              <span class="w-3 h-3 rounded-full bg-red-500"></span>
              <strong>—</strong>
            </div>
            <p class="text-sm text-gray-500">Use mobile app to sync memories</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- App Updates -->
    <div class="panel mb-6 {!isMobile ? 'opacity-60 pointer-events-none' : ''}">
      <div class="flex items-center gap-4 flex-wrap mb-3">
        <h2 class="text-lg font-semibold m-0 text-gray-900 dark:text-gray-50">⬇️ App Updates</h2>
        {#if !isMobile}
          <span class="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full font-medium">Mobile Only</span>
        {/if}
      </div>
      <p class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
        Check for and download new versions of the MetaHuman app from your connected server.
      </p>
      {#if isMobile}
        <UpdateManager />
      {:else}
        <div class="opacity-50">
          <div class="rounded-md p-4 border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
            <div class="flex items-center gap-2 mb-3">
              <span class="w-3 h-3 rounded-full bg-red-500"></span>
              <strong>—</strong>
            </div>
            <p class="text-sm text-gray-500">Use mobile app to check for updates</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- Profile Management -->
    <div class="panel mb-6 {!isMobile ? 'opacity-60 pointer-events-none' : ''}">
      <div class="flex items-center gap-4 flex-wrap mb-3">
        <h2 class="text-lg font-semibold m-0 text-gray-900 dark:text-gray-50">👤 Profile Data</h2>
        {#if !isMobile}
          <span class="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full font-medium">Mobile Only</span>
        {/if}
      </div>
      <p class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
        Download your profile for offline use, create local profiles, or sync changes with the server.
      </p>
      {#if isMobile}
        <ProfileManager />
      {:else}
        <div class="opacity-50">
          <div class="rounded-md p-4 border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
            <div class="flex items-center gap-2 mb-3">
              <span class="w-3 h-3 rounded-full bg-red-500"></span>
              <strong>—</strong>
            </div>
            <p class="text-sm text-gray-500">Use mobile app to manage profile data</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- ============ MESSAGES ============ -->
    {#if error}
      <div class="p-3 rounded-md mt-4 bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-700">{error}</div>
    {/if}

    {#if successMessage}
      <div class="p-3 rounded-md mt-4 bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700">{successMessage}</div>
    {/if}
  {/if}
</div>

<style>
  .btn-success {
    @apply px-4 py-2 rounded-md font-medium text-sm transition-colors;
    @apply bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed;
  }
</style>

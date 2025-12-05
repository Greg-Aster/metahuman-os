<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    isCapacitorNative,
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
  import ModelManager from './ModelManager.svelte';
  import UpdateManager from './UpdateManager.svelte';
  import ProfileManager from './ProfileManager.svelte';

  interface ServerStatus {
    url: string;
    connected: boolean;
    latencyMs: number;
    version?: string;
    error?: string;
  }

  let currentServerUrl = '';
  let customServerUrl = '';
  let isMobile = false;
  let loading = true;
  let testing = false;
  let saving = false;
  let serverStatus: ServerStatus | null = null;
  let error: string | null = null;
  let successMessage: string | null = null;
  let showCustomInput = false;
  let defaultServers: { local: string; cloud: string } = { local: '', cloud: '' };

  // Subscribe to health status for live updates
  let liveHealthStatus: HealthStatus | null = null;
  const unsubscribe = healthStatus.subscribe(s => {
    liveHealthStatus = s;
    // Update serverStatus with live health data
    if (s && serverStatus) {
      serverStatus = {
        ...serverStatus,
        connected: s.connected,
        latencyMs: s.latencyMs,
        error: s.error
      };
    }
  });

  async function loadCurrentServer() {
    loading = true;
    try {
      isMobile = isCapacitorNative();
      defaultServers = getDefaultServers();
      currentServerUrl = await getApiBaseUrlAsync();
      customServerUrl = currentServerUrl;

      // Test current connection
      await testCurrentConnection();
    } catch (err) {
      console.error('Failed to load server config:', err);
      error = err instanceof Error ? err.message : 'Failed to load configuration';
    } finally {
      loading = false;
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
      // Test connection first
      const testResult = await testServerConnection(url);
      if (!testResult.success) {
        error = `Cannot connect to server: ${testResult.error}`;
        return;
      }

      // Save the URL
      await setServerUrl(url);
      currentServerUrl = url;
      customServerUrl = url;
      showCustomInput = false;

      successMessage = `Server updated to ${url}`;

      // Update status
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

  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    // Initialize async - don't return cleanup from async
    (async () => {
      await initServerUrl();
      await loadCurrentServer();
    })();

    // Refresh status periodically (health monitor handles this, but keep for compatibility)
    refreshInterval = setInterval(testCurrentConnection, 30000);
  });

  onDestroy(() => {
    unsubscribe();
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });
</script>

<!-- Server Settings (Mobile App) -->
<div class="server-container">
  <div class="server-header">
    <h1>📡 Server Settings</h1>
    <p>Configure your MetaHuman server connection</p>
  </div>

  {#if loading}
    <div class="loading">Loading server configuration...</div>
  {:else}
    <!-- Connection Status -->
    <div class="section">
      <h2>Connection Status</h2>

      <div class="status-box" class:status-connected={serverStatus?.connected} class:status-disconnected={!serverStatus?.connected}>
        <div class="status-indicator">
          <span class="status-dot" class:dot-connected={serverStatus?.connected} class:dot-disconnected={!serverStatus?.connected}></span>
          <strong>{serverStatus?.connected ? '✅ Connected' : '❌ Disconnected'}</strong>
          {#if testing}
            <span class="testing-badge">Testing...</span>
          {/if}
        </div>

        <div class="server-info">
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

    <!-- Server Selection (Mobile Only) -->
    {#if isMobile}
      <div class="section">
        <h2>🔧 Server Selection</h2>
        <p class="section-description">Choose which server to connect to. Your app will remember this setting.</p>

        <div class="server-options">
          <!-- Local Server -->
          <button
            class="server-option"
            class:selected={currentServerUrl === defaultServers.local && !showCustomInput}
            on:click={() => selectPresetServer(defaultServers.local)}
            disabled={saving}
          >
            <div class="option-icon">🏠</div>
            <div class="option-details">
              <strong>Home Server</strong>
              <span class="option-url">{defaultServers.local}</span>
              <span class="option-desc">Local Ollama with full model access</span>
            </div>
            {#if currentServerUrl === defaultServers.local && !showCustomInput}
              <span class="selected-badge">Active</span>
            {/if}
          </button>

          <!-- Cloud Server -->
          <button
            class="server-option"
            class:selected={currentServerUrl === defaultServers.cloud && !showCustomInput}
            on:click={() => selectPresetServer(defaultServers.cloud)}
            disabled={saving}
          >
            <div class="option-icon">☁️</div>
            <div class="option-details">
              <strong>Cloud Server</strong>
              <span class="option-url">{defaultServers.cloud}</span>
              <span class="option-desc">RunPod GPU with Qwen3-Coder-30B</span>
            </div>
            {#if currentServerUrl === defaultServers.cloud && !showCustomInput}
              <span class="selected-badge">Active</span>
            {/if}
          </button>

          <!-- Custom Server -->
          <button
            class="server-option"
            class:selected={showCustomInput || (currentServerUrl !== defaultServers.local && currentServerUrl !== defaultServers.cloud)}
            on:click={enableCustomServer}
            disabled={saving}
          >
            <div class="option-icon">⚙️</div>
            <div class="option-details">
              <strong>Custom Server</strong>
              {#if !showCustomInput && currentServerUrl !== defaultServers.local && currentServerUrl !== defaultServers.cloud}
                <span class="option-url">{currentServerUrl}</span>
              {:else}
                <span class="option-desc">Enter a custom server URL</span>
              {/if}
            </div>
            {#if !showCustomInput && currentServerUrl !== defaultServers.local && currentServerUrl !== defaultServers.cloud}
              <span class="selected-badge">Active</span>
            {/if}
          </button>
        </div>

        <!-- Custom URL Input -->
        {#if showCustomInput}
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

      <!-- Tier Selection -->
      <div class="section">
        <h2>⚡ Compute Tier</h2>
        <p class="section-description">
          Automatically select the best compute tier based on connectivity, battery, and task requirements.
        </p>
        <TierSelector />
      </div>

      <!-- Tier Info -->
      <div class="section">
        <h2>ℹ️ Tier Details</h2>
        <div class="info-box">
          <ul>
            <li><strong>🏠 Home Server:</strong> Full Ollama access, Qwen3:14B, all memories synced</li>
            <li><strong>☁️ Cloud Server:</strong> RunPod GPU, Qwen3-Coder-30B, low latency</li>
            <li><strong>📱 On-Device:</strong> Local Qwen3-1.7B via llama.cpp (offline capable)</li>
          </ul>
        </div>
      </div>

      <!-- Memory Sync -->
      <div class="section">
        <h2>🔄 Memory Sync</h2>
        <p class="section-description">
          Keep your memories synchronized between devices. Changes made offline will sync when reconnected.
        </p>
        <SyncStatus />
      </div>

      <!-- On-Device Models -->
      <div class="section">
        <h2>📱 On-Device AI</h2>
        <p class="section-description">
          Download and manage local AI models for offline use. Models run directly on your device.
        </p>
        <ModelManager />
      </div>

      <!-- App Updates -->
      <div class="section">
        <h2>⬇️ App Updates</h2>
        <p class="section-description">
          Check for and download new versions of the MetaHuman app from your connected server.
        </p>
        <UpdateManager />
      </div>

      <!-- Profile Management -->
      <div class="section">
        <h2>👤 Profile Data</h2>
        <p class="section-description">
          Download your profile for offline use, create local profiles, or sync changes with the server.
        </p>
        <ProfileManager />
      </div>
    {:else}
      <!-- Web Mode Info -->
      <div class="section">
        <div class="info-box">
          <h3>ℹ️ Web Mode</h3>
          <p>You're running in web browser mode. The app automatically connects to the same server hosting this page.</p>
          <p>Server configuration is only available in the mobile app.</p>
        </div>
      </div>
    {/if}

    {#if error}
      <div class="error-message">{error}</div>
    {/if}

    {#if successMessage}
      <div class="success-message">{successMessage}</div>
    {/if}
  {/if}
</div>

<style>
  .server-container {
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .server-header {
    margin-bottom: 2rem;
  }

  .server-header h1 {
    font-size: 2rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #1f2937;
  }

  :global(.dark) .server-header h1 {
    color: #f9fafb;
  }

  .server-header p {
    color: #6b7280;
  }

  :global(.dark) .server-header p {
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

  .section h2 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
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

  .status-box {
    background: #f9fafb;
    border: 2px solid #d1d5db;
    border-radius: 6px;
    padding: 1rem;
  }

  :global(.dark) .status-box {
    background: #111827;
    border-color: #4b5563;
  }

  .status-box.status-connected {
    border-color: #10b981;
    background: #ecfdf5;
  }

  :global(.dark) .status-box.status-connected {
    background: #064e3b;
    border-color: #059669;
  }

  .status-box.status-disconnected {
    border-color: #ef4444;
    background: #fef2f2;
  }

  :global(.dark) .status-box.status-disconnected {
    background: #7f1d1d;
    border-color: #dc2626;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .dot-connected {
    background: #10b981;
    box-shadow: 0 0 8px #10b981;
  }

  .dot-disconnected {
    background: #ef4444;
  }

  .testing-badge {
    font-size: 0.75rem;
    background: #3b82f6;
    color: white;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    margin-left: 0.5rem;
  }

  .server-info {
    margin-bottom: 1rem;
  }

  .info-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  .info-row .label {
    color: #6b7280;
    min-width: 80px;
  }

  :global(.dark) .info-row .label {
    color: #9ca3af;
  }

  .info-row .value {
    color: #111827;
    word-break: break-all;
  }

  :global(.dark) .info-row .value {
    color: #f3f4f6;
  }

  .info-row.error .value {
    color: #dc2626;
  }

  :global(.dark) .info-row.error .value {
    color: #fca5a5;
  }

  .latency {
    font-weight: 600;
  }

  .latency-good {
    color: #10b981 !important;
  }

  .latency-warn {
    color: #f59e0b !important;
  }

  .latency-bad {
    color: #ef4444 !important;
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

  .button-row {
    display: flex;
    gap: 0.5rem;
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

  /* Info Box */
  .info-box {
    padding: 1rem;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
  }

  :global(.dark) .info-box {
    background: #1e3a8a;
    border-color: #3b82f6;
  }

  .info-box h3 {
    margin-bottom: 0.5rem;
    color: #1e40af;
  }

  :global(.dark) .info-box h3 {
    color: #93c5fd;
  }

  .info-box p {
    margin-bottom: 0.5rem;
    color: #1e40af;
    font-size: 0.875rem;
  }

  :global(.dark) .info-box p {
    color: #bfdbfe;
  }

  .info-box ul {
    margin: 0;
    padding-left: 1.5rem;
  }

  .info-box li {
    margin-bottom: 0.5rem;
    color: #1e40af;
    font-size: 0.875rem;
  }

  :global(.dark) .info-box li {
    color: #bfdbfe;
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
</style>

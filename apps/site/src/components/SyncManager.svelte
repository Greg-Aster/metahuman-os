<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { formatFileSize, updateState, checkForUpdates, downloadAndInstall } from '../lib/client/app-updater';
  import {
    configureRemoteSyncServer,
    testRemoteServerConnection,
    getRemoteSyncConfig,
    clearRemoteSyncConfig,
    // syncFromRemoteServer - REMOVED: Now handled by profile-sync agent
    checkRemoteSyncStatus,
    type RemoteSyncProgress,
    type SyncComparison,
    type RemoteSyncResult,
  } from '../lib/client/profile-sync';
  import {
    getSyncSettings,
    updateSyncSettings,
    type SyncSettings,
  } from '../lib/client/sync-settings';
  import { apiFetch } from '../lib/client/api-config';

  /**
   * Trigger an agent via the agents API
   */
  async function triggerAgent(agentName: string, args: string[] = []): Promise<{ success: boolean; pid?: number; error?: string }> {
    try {
      const res = await apiFetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentName, args }),
      });
      if (res.ok) {
        const data = await res.json();
        return { success: true, pid: data.pid };
      } else {
        const error = await res.text();
        return { success: false, error };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  /**
   * Read profile-sync state from agent's output file
   */
  async function readProfileSyncState(): Promise<any | null> {
    try {
      const res = await apiFetch('/api/profile-sync-state');
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Wait for profile-sync agent to complete by polling state file
   */
  async function waitForProfileSync(maxWaitMs: number = 120000): Promise<any> {
    const startTime = Date.now();
    const pollInterval = 1000; // Poll every second

    while (Date.now() - startTime < maxWaitMs) {
      const state = await readProfileSyncState();

      if (state) {
        // Update progress UI
        if (state.phase && state.message) {
          remoteSyncPhase = state.phase === 'complete' ? 'complete'
            : state.phase === 'error' ? 'error'
            : 'downloading';
          remoteSyncMessage = state.message;

          if (state.current !== undefined && state.total !== undefined) {
            syncProgress = {
              current: state.current,
              total: state.total,
              category: state.message,
            };
          }
        }

        // Check if completed or errored
        if (state.phase === 'complete' || state.phase === 'error') {
          return state;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return { phase: 'error', message: 'Sync timed out' };
  }

  const dispatch = createEventDispatcher();

  export let isOpen = false;
  export let isSyncing = false;
  export let syncProgress: { current: number; total: number; category: string } | null = null;

  // Server configuration state
  let serverUrl = '';
  let serverUsername = '';
  let serverPassword = '';
  let isServerConfigured = false;
  let isTestingConnection = false;
  let connectionTestResult: { success: boolean; message: string } | null = null;
  let isSavingConfig = false;
  let showServerConfig = false;
  let lastSyncAt: string | null = null;

  // Remote sync progress
  let remoteSyncPhase: RemoteSyncProgress['phase'] | null = null;
  let remoteSyncMessage = '';

  // Sync settings state
  let syncSettingsData: SyncSettings | null = null;
  let showSyncSettings = false;
  let isSavingSettings = false;

  // Sync status comparison
  let isCheckingStatus = false;
  let syncComparison: SyncComparison | null = null;
  let statusCheckError: string | null = null;

  // Sync completion state
  let showSyncComplete = false;
  let syncResult: RemoteSyncResult | null = null;

  // Update result tracking
  interface UpdateResult {
    checked: boolean;
    available: boolean;
    version: string | null;
    downloadStarted: boolean;
    error: string | null;
  }
  let updateResult: UpdateResult = {
    checked: false,
    available: false,
    version: null,
    downloadStarted: false,
    error: null,
  };

  function getLatestUpdateVersion(): string | null {
    const state = get(updateState);
    if (state.platform === 'mobile') {
      return state.latestMobileVersion?.version || null;
    }
    if (state.platform === 'server') {
      return state.serverUpdateInfo?.latestVersion || null;
    }
    return null;
  }

  function getCurrentUpdateVersion(): string | null {
    const state = get(updateState);
    return state.currentVersion || null;
  }

  // Memory date range options
  interface DateRangeOption {
    value: number;
    label: string;
    description: string;
  }

  const dateRangeOptions: DateRangeOption[] = [
    { value: 7, label: 'Last 7 days', description: 'Recent memories only' },
    { value: 30, label: 'Last 30 days', description: 'About a month' },
    { value: 90, label: 'Last 90 days', description: 'About 3 months' },
    { value: 365, label: 'Last year', description: 'Warning: may be large' },
    { value: 0, label: 'All memories', description: 'Warning: may be very large!' },
  ];

  let memoryDays = 7; // Default to last 7 days

  // Sync options
  interface SyncOption {
    id: string;
    label: string;
    description: string;
    enabled: boolean;
    warning?: string;
    estimatedSize?: string;
  }

  let syncOptions: SyncOption[] = [
    {
      id: 'persona',
      label: 'Persona Files',
      description: 'Core identity, personality traits, relationships, and decision rules',
      enabled: false,  // Disabled by default - memories only
      estimatedSize: '~50 KB',
    },
    {
      id: 'config',
      label: 'Configuration',
      description: 'Settings, preferences, model registry, and runtime config',
      enabled: false,  // Disabled by default - memories only
      estimatedSize: '~25 KB',
    },
    {
      id: 'memories',
      label: 'Memories',
      description: 'Episodic memories, conversations, and inner dialogue',
      enabled: true,   // Enabled by default - primary sync content
      estimatedSize: 'Variable',
    },
    {
      id: 'logs',
      label: 'Audit Logs',
      description: 'System logs and audit trail (for debugging)',
      enabled: false,
      estimatedSize: 'Large',
    },
    {
      id: 'models',
      label: 'LoRA Adapters',
      description: 'Custom fine-tuned model weights',
      enabled: false,
      warning: 'Not recommended - files can be 500MB+ each',
      estimatedSize: '500MB+',
    },
    {
      id: 'update',
      label: 'Program Update',
      description: 'Check for and download app updates',
      enabled: true,
      estimatedSize: '~10 MB',
    },
  ];

  // Sci-fi slang messages - cyberpunk/sci-fi terminology
  const scifiMessages = [
    // User provided
    'Synchronizing the stack...',
    'Backing up your ghost...',
    'Preventing ghost hack vulnerabilities...',
    'Updating wetware protocols...',
    'Verifying wetware integrity...',

    // Neuromancer/Gibson references
    'Jacking into the matrix...',
    'Decking through ICE barriers...',
    'Flatlining countermeasures...',
    'Riding the razorgirl protocol...',
    'Burning chrome signatures...',

    // Blade Runner references
    'Replicating memory engrams...',
    'Voight-Kampff verification active...',
    'Processing baseline data...',
    'Retiring obsolete sectors...',

    // Ghost in the Shell references
    'Diving into the net...',
    'Securing Section 9 protocols...',
    'Laughing Man encryption active...',
    'Puppet master handshake...',
    'Stand Alone Complex sync...',

    // Snow Crash references
    'Entering the Metaverse...',
    'Gargoyle mode engaged...',
    'Snow Crash firewall active...',
    'Hiro Protagonist protocol...',

    // Cyberpunk generic
    'Cyberspace handshake complete...',
    'Neural link established...',
    'Uploading consciousness fragments...',
    'Downloading identity backup...',
    'Meat-to-metal bridge active...',
    'Chrome extensions syncing...',
    'Biochip verification...',
    'Street samurai mode...',
    'Netrunner protocol engaged...',
    'Braindance sync in progress...',

    // Deus Ex references
    'Augmentation sync active...',
    'UNATCO uplink established...',
    'Nano-augmentation verified...',

    // The Matrix references
    'Red pill accepted...',
    'Downloading kung fu...',
    'Nebuchadnezzar uplink...',
    'Zion mainframe sync...',
    'Sentinels bypassed...',

    // Altered Carbon references
    'Stack backup initiated...',
    'Cortical stack sync...',
    'Sleeve transfer protocol...',
    'DHF pattern verified...',
    'Envoy conditioning active...',

    // Mr. Robot references
    'fsociety protocol active...',
    'Dark Army bypass engaged...',
    'E Corp firewall penetrated...',

    // Other sci-fi
    'Ansible connection stable...',
    'Gom jabbar test passed...',
    'Spice flow initiated...',
    'Mentat calculations complete...',
    'Holographic archive syncing...',
    'Quantum entanglement verified...',
    'Tachyon burst received...',
    'Subspace relay active...',
    'Warp signature locked...',
    'Replicator patterns cached...',

    // Original creations
    'Meatspace tether stable...',
    'Digital exocortex syncing...',
    'Neuroweave calibration...',
    'Psycho-pass clearance verified...',
    'Memory palace reconstruction...',
    'Synaptic bridge established...',
    'Ego backup confirmed...',
    'Identity matrix verified...',
    'Personality substrate sync...',
    'Cognitive mesh active...',
    'Mind-state serialization...',
    'Ghost protocol engaged...',
    'Soul backup in progress...',
    'Digital twin synchronizing...',
    'Memetic payload delivered...',
    'Consciousness partition active...',
  ];

  let currentMessageIndex = 0;
  let currentMessage = scifiMessages[0];
  let messageInterval: ReturnType<typeof setInterval> | null = null;

  // Rotate messages every 10 seconds during sync
  $: if (isSyncing && !messageInterval) {
    currentMessageIndex = Math.floor(Math.random() * scifiMessages.length);
    currentMessage = scifiMessages[currentMessageIndex];
    messageInterval = setInterval(() => {
      currentMessageIndex = Math.floor(Math.random() * scifiMessages.length);
      currentMessage = scifiMessages[currentMessageIndex];
    }, 10000);
  } else if (!isSyncing && messageInterval) {
    clearInterval(messageInterval);
    messageInterval = null;
  }

  onDestroy(() => {
    if (messageInterval) {
      clearInterval(messageInterval);
    }
  });

  // Load server config and sync settings on mount
  onMount(async () => {
    await loadServerConfig();
    await loadSyncSettings();
  });

  async function loadSyncSettings() {
    try {
      syncSettingsData = await getSyncSettings();
    } catch (err) {
      console.error('Failed to load sync settings:', err);
    }
  }

  async function handleSaveSyncSettings() {
    if (!syncSettingsData) return;
    isSavingSettings = true;
    try {
      await updateSyncSettings(syncSettingsData);
      showSyncSettings = false;
    } catch (err) {
      console.error('Failed to save sync settings:', err);
    } finally {
      isSavingSettings = false;
    }
  }

  async function loadServerConfig() {
    try {
      const config = await getRemoteSyncConfig();
      isServerConfigured = config.configured;
      if (config.configured) {
        serverUrl = config.serverUrl || '';
        serverUsername = config.username || '';
        lastSyncAt = config.lastSyncAt || null;
        // Password is not returned for security
        serverPassword = '';
      }
    } catch (err) {
      console.error('Failed to load server config:', err);
    }
  }

  async function handleTestConnection() {
    if (!serverUrl || !serverUsername || !serverPassword) {
      connectionTestResult = { success: false, message: 'Please fill in all fields' };
      return;
    }

    isTestingConnection = true;
    connectionTestResult = null;

    try {
      const result = await testRemoteServerConnection(serverUrl, serverUsername, serverPassword);
      connectionTestResult = {
        success: result.success,
        message: result.success ? 'Connection successful!' : result.error || 'Connection failed',
      };
    } catch (err) {
      connectionTestResult = {
        success: false,
        message: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    } finally {
      isTestingConnection = false;
    }
  }

  async function handleSaveConfig() {
    if (!serverUrl || !serverUsername || !serverPassword) {
      connectionTestResult = { success: false, message: 'Please fill in all fields' };
      return;
    }

    isSavingConfig = true;
    try {
      const result = await configureRemoteSyncServer(serverUrl, serverUsername, serverPassword);
      if (result.success) {
        isServerConfigured = true;
        showServerConfig = false;
        connectionTestResult = { success: true, message: 'Server configured successfully!' };
        await loadServerConfig();
      } else {
        connectionTestResult = { success: false, message: result.error || 'Failed to save configuration' };
      }
    } catch (err) {
      connectionTestResult = {
        success: false,
        message: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    } finally {
      isSavingConfig = false;
    }
  }

  async function handleClearConfig() {
    try {
      await clearRemoteSyncConfig();
      serverUrl = '';
      serverUsername = '';
      serverPassword = '';
      isServerConfigured = false;
      lastSyncAt = null;
      connectionTestResult = null;
    } catch (err) {
      console.error('Failed to clear config:', err);
    }
  }

  async function handleCheckStatus() {
    if (!isServerConfigured) return;

    isCheckingStatus = true;
    statusCheckError = null;
    syncComparison = null;

    try {
      syncComparison = await checkRemoteSyncStatus();
      if (syncComparison.error) {
        statusCheckError = syncComparison.error;
      }
    } catch (err) {
      statusCheckError = err instanceof Error ? err.message : 'Failed to check status';
    } finally {
      isCheckingStatus = false;
    }
  }

  async function handleRemoteSync() {
    isSyncing = true;
    remoteSyncPhase = 'authenticating';
    remoteSyncMessage = 'Starting sync via profile-sync agent...';
    syncResult = null;

    // Reset update result
    updateResult = {
      checked: false,
      available: false,
      version: null,
      downloadStarted: false,
      error: null,
    };

    // Read checkbox selections to honor user's choices
    const wantPersona = syncOptions.find(o => o.id === 'persona')?.enabled ?? false;
    const wantConfig = syncOptions.find(o => o.id === 'config')?.enabled ?? false;
    const wantMemories = syncOptions.find(o => o.id === 'memories')?.enabled ?? false;
    const wantUpdate = syncOptions.find(o => o.id === 'update')?.enabled ?? false;

    // Check if ONLY update is selected (no profile sync needed)
    const onlyUpdateSelected = wantUpdate && !wantPersona && !wantConfig && !wantMemories;

    console.log('[SyncManager] Options:', { wantPersona, wantConfig, wantMemories, wantUpdate, onlyUpdateSelected });
    console.log('[SyncManager] Using profile-sync agent for ALL sync operations');

    const errors: string[] = [];

    try {
      // === CASE 1: Only update selected ===
      if (onlyUpdateSelected) {
        remoteSyncMessage = 'Checking for app updates...';
        remoteSyncPhase = 'downloading';

        try {
          const updateAvailable = await checkForUpdates();
          updateResult.checked = true;

          if (updateAvailable) {
            updateResult.available = true;
            updateResult.version = getLatestUpdateVersion();
            remoteSyncMessage = `Update ${updateResult.version || ''} found! Starting update...`;

            await downloadAndInstall();
            updateResult.downloadStarted = true;
            remoteSyncMessage = 'Update started - check your device for progress';
          } else {
            updateResult.available = false;
            updateResult.version = getCurrentUpdateVersion() || 'unknown';
            remoteSyncMessage = `Already up to date (v${updateResult.version})`;
          }
        } catch (err) {
          updateResult.error = err instanceof Error ? err.message : 'Update failed';
          remoteSyncMessage = updateResult.error;
          errors.push(updateResult.error);
        }

        syncResult = {
          success: errors.length === 0,
          error: errors.join('; ') || undefined,
        };
        remoteSyncPhase = errors.length === 0 ? 'complete' : 'error';
        showSyncComplete = true;

      // === CASE 2: Profile/Memory sync via profile-sync agent ===
      } else {
        // Build agent args based on selections
        const agentArgs: string[] = ['--pull-only'];

        if (wantMemories && !wantPersona && !wantConfig) {
          agentArgs.push('--memories-only');
        } else if ((wantPersona || wantConfig) && !wantMemories) {
          agentArgs.push('--profile-only');
        }

        // Add memory days filter if set
        if (memoryDays > 0) {
          agentArgs.push(`--days=${memoryDays}`);
        }

        remoteSyncMessage = 'Triggering profile-sync agent...';
        remoteSyncPhase = 'downloading';

        console.log('[SyncManager] Triggering profile-sync agent with args:', agentArgs);
        const agentResult = await triggerAgent('profile-sync', agentArgs);

        if (agentResult.success) {
          remoteSyncMessage = `Profile sync agent started (PID: ${agentResult.pid}). Syncing...`;
          console.log('[SyncManager] Profile sync agent started:', agentResult.pid);

          // Wait for agent completion by polling state file
          const finalState = await waitForProfileSync(120000); // 2 minute max wait

          if (finalState.phase === 'complete') {
            // Check for app updates if requested
            if (wantUpdate) {
              remoteSyncMessage = 'Checking for app updates...';
              try {
                const updateAvailable = await checkForUpdates();
                updateResult.checked = true;

                if (updateAvailable) {
                  updateResult.available = true;
                  updateResult.version = getLatestUpdateVersion();
                  remoteSyncMessage = `Update ${updateResult.version || ''} found! Starting update...`;

                  await downloadAndInstall();
                  updateResult.downloadStarted = true;
                } else {
                  updateResult.available = false;
                  updateResult.version = getCurrentUpdateVersion();
                }
              } catch (err) {
                updateResult.error = err instanceof Error ? err.message : 'Update failed';
              }
            }

            // Build success message
            const successParts: string[] = [];
            if (finalState.profileFiles > 0) successParts.push(`${finalState.profileFiles} profile files`);
            if (finalState.memoriesImported > 0) successParts.push(`${finalState.memoriesImported} memories`);
            if (finalState.credentialsSynced) successParts.push('credentials');
            if (updateResult.checked) successParts.push('update checked');

            remoteSyncPhase = 'complete';
            remoteSyncMessage = `Sync complete! ${successParts.join(', ')}.`;

            syncResult = {
              success: true,
              profileFiles: finalState.profileFiles || 0,
              memoriesImported: finalState.memoriesImported || 0,
              credentialsSynced: finalState.credentialsSynced || false,
            };
          } else {
            // Error or timeout
            errors.push(finalState.message || 'Sync failed');
            remoteSyncPhase = 'error';
            remoteSyncMessage = finalState.message || 'Sync failed';

            syncResult = {
              success: false,
              error: finalState.message || finalState.error || 'Sync failed',
            };
          }
        } else {
          errors.push(agentResult.error || 'Failed to start profile-sync agent');
          remoteSyncPhase = 'error';
          remoteSyncMessage = agentResult.error || 'Failed to start profile-sync agent';

          syncResult = {
            success: false,
            error: agentResult.error || 'Failed to start profile-sync agent',
          };
        }

        await loadServerConfig();
        showSyncComplete = true;
      }
    } catch (err) {
      remoteSyncPhase = 'error';
      remoteSyncMessage = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      syncResult = { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      isSyncing = false;
      syncProgress = null;
      syncComparison = null;
    }
  }

  function handleCloseSyncComplete() {
    showSyncComplete = false;
    syncResult = null;
    remoteSyncPhase = null;
    // Reset update result
    updateResult = {
      checked: false,
      available: false,
      version: null,
      downloadStarted: false,
      error: null,
    };
  }

  function toggleOption(id: string) {
    syncOptions = syncOptions.map(opt =>
      opt.id === id ? { ...opt, enabled: !opt.enabled } : opt
    );
  }

  function selectAll() {
    syncOptions = syncOptions.map(opt => ({ ...opt, enabled: true }));
  }

  function selectNone() {
    syncOptions = syncOptions.map(opt => ({ ...opt, enabled: false }));
  }

  function handleClose() {
    if (!isSyncing) {
      dispatch('close');
    }
  }

  function getProgressPercent(): number {
    if (!syncProgress) return 0;
    return Math.round((syncProgress.current / syncProgress.total) * 100);
  }
</script>

{#if isOpen}
  <div class="modal-overlay" on:click={handleClose}>
    <div class="sync-manager" on:click|stopPropagation>
      <div class="modal-header">
        <div class="header-content">
          <h3>Sync Manager</h3>
          <span class="header-subtitle">Configure your synchronization</span>
        </div>
        {#if !isSyncing}
          <button class="close-btn" on:click={handleClose}>×</button>
        {/if}
      </div>

      {#if isSyncing}
        <!-- Syncing State -->
        <div class="sync-progress-section">
          <div class="sync-animation">
            <div class="pulse-ring"></div>
            <div class="pulse-ring delay-1"></div>
            <div class="pulse-ring delay-2"></div>
            <span class="sync-icon">⟳</span>
          </div>

          <div class="scifi-message">
            <span class="message-text">{currentMessage}</span>
            <span class="cursor">_</span>
          </div>

          {#if syncProgress}
            <div class="progress-details">
              <div class="progress-bar">
                <div class="progress-fill" style="width: {getProgressPercent()}%"></div>
              </div>
              <div class="progress-text">
                <span class="progress-category">{syncProgress.category}</span>
                <span class="progress-percent">{getProgressPercent()}%</span>
              </div>
            </div>
          {:else}
            <div class="progress-indeterminate">
              <div class="indeterminate-bar"></div>
            </div>
          {/if}

          <p class="sync-warning-active">
            Do not close the app while syncing...
          </p>
        </div>
      {:else}
        <!-- Options State - Unified scrollable container -->
        <div class="scrollable-content">

        <!-- Server Configuration Section -->
        <div class="server-config-section">
          <div class="server-config-header" on:click={() => showServerConfig = !showServerConfig}>
            <div class="server-status">
              <span class="server-icon">{isServerConfigured ? '🔗' : '⚙️'}</span>
              <div class="server-info">
                <span class="server-title">
                  {isServerConfigured ? 'Remote Server Connected' : 'Configure Sync Server'}
                </span>
                {#if isServerConfigured}
                  <span class="server-url">{serverUrl}</span>
                  {#if lastSyncAt}
                    <span class="last-sync">Last sync: {new Date(lastSyncAt).toLocaleString()}</span>
                  {/if}
                {:else}
                  <span class="server-hint">Set up server to sync your profile</span>
                {/if}
              </div>
            </div>
            <span class="expand-icon">{showServerConfig ? '▼' : '▶'}</span>
          </div>

          {#if showServerConfig}
            <div class="server-config-form">
              <div class="form-group">
                <label for="serverUrl">Server URL</label>
                <input
                  type="url"
                  id="serverUrl"
                  placeholder="https://mh.example.com"
                  bind:value={serverUrl}
                  disabled={isSavingConfig || isTestingConnection}
                />
              </div>

              <div class="form-group">
                <label for="serverUsername">Username</label>
                <input
                  type="text"
                  id="serverUsername"
                  placeholder="your-username"
                  bind:value={serverUsername}
                  disabled={isSavingConfig || isTestingConnection}
                />
              </div>

              <div class="form-group">
                <label for="serverPassword">Password</label>
                <input
                  type="password"
                  id="serverPassword"
                  placeholder={isServerConfigured ? '••••••••' : 'your-password'}
                  bind:value={serverPassword}
                  disabled={isSavingConfig || isTestingConnection}
                />
              </div>

              {#if connectionTestResult}
                <div class="connection-result" class:success={connectionTestResult.success} class:error={!connectionTestResult.success}>
                  <span class="result-icon">{connectionTestResult.success ? '✓' : '✗'}</span>
                  <span class="result-message">{connectionTestResult.message}</span>
                </div>
              {/if}

              <div class="server-config-actions">
                <button
                  class="config-btn test"
                  on:click={handleTestConnection}
                  disabled={!serverUrl || !serverUsername || !serverPassword || isTestingConnection || isSavingConfig}
                >
                  {isTestingConnection ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  class="config-btn save"
                  on:click={handleSaveConfig}
                  disabled={!serverUrl || !serverUsername || !serverPassword || isSavingConfig}
                >
                  {isSavingConfig ? 'Saving...' : 'Save & Connect'}
                </button>
                {#if isServerConfigured}
                  <button class="config-btn clear" on:click={handleClearConfig}>
                    Disconnect
                  </button>
                {/if}
              </div>
            </div>
          {/if}
        </div>

        <!-- Sync Settings Section -->
        <div class="sync-settings-section">
          <div class="sync-settings-header" on:click={() => showSyncSettings = !showSyncSettings}>
            <div class="settings-status">
              <span class="settings-icon">⚙️</span>
              <div class="settings-info">
                <span class="settings-title">Sync Behavior Settings</span>
                <span class="settings-hint">Auto-sync, WiFi-only, and defaults</span>
              </div>
            </div>
            <span class="expand-icon">{showSyncSettings ? '▼' : '▶'}</span>
          </div>

          {#if showSyncSettings && syncSettingsData}
            <div class="sync-settings-form">
              <div class="settings-group">
                <h4>Automatic Sync</h4>

                <label class="setting-toggle">
                  <input
                    type="checkbox"
                    bind:checked={syncSettingsData.syncOnLogin}
                    disabled={isSavingSettings}
                  />
                  <span class="toggle-label">
                    <strong>Sync on login</strong>
                    <small>Pull latest memories when logging in</small>
                  </span>
                </label>

                <label class="setting-toggle">
                  <input
                    type="checkbox"
                    bind:checked={syncSettingsData.syncOnWifiOnly}
                    disabled={isSavingSettings}
                  />
                  <span class="toggle-label">
                    <strong>WiFi only</strong>
                    <small>Don't sync on cellular data</small>
                  </span>
                </label>

                <label class="setting-toggle">
                  <input
                    type="checkbox"
                    bind:checked={syncSettingsData.manualSyncOnly}
                    disabled={isSavingSettings}
                  />
                  <span class="toggle-label">
                    <strong>Manual sync only</strong>
                    <small>Disable all automatic syncing</small>
                  </span>
                </label>
              </div>

              <div class="settings-group">
                <h4>Default Sync Content</h4>

                <label class="setting-toggle">
                  <input
                    type="checkbox"
                    bind:checked={syncSettingsData.syncPersona}
                    disabled={isSavingSettings}
                  />
                  <span class="toggle-label">
                    <strong>Sync persona</strong>
                    <small>Identity, personality, relationships</small>
                  </span>
                </label>

                <label class="setting-toggle">
                  <input
                    type="checkbox"
                    bind:checked={syncSettingsData.syncSettings}
                    disabled={isSavingSettings}
                  />
                  <span class="toggle-label">
                    <strong>Sync settings</strong>
                    <small>App preferences and configuration</small>
                  </span>
                </label>

                <label class="setting-toggle">
                  <input
                    type="checkbox"
                    bind:checked={syncSettingsData.syncConversationBuffer}
                    disabled={isSavingSettings}
                  />
                  <span class="toggle-label">
                    <strong>Sync conversation buffer</strong>
                    <small>Recent chat history (can be large)</small>
                  </span>
                </label>
              </div>

              <div class="settings-actions">
                <button
                  class="config-btn save"
                  on:click={handleSaveSyncSettings}
                  disabled={isSavingSettings}
                >
                  {isSavingSettings ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          {/if}
        </div>

        {#if isServerConfigured}
          <!-- Remote Sync Section -->
          <div class="remote-sync-section">
            <!-- Memory Date Range Selector -->
            <div class="date-range-section">
              <label class="date-range-label">Memory sync range:</label>
              <select class="date-range-select" bind:value={memoryDays}>
                {#each dateRangeOptions as option}
                  <option value={option.value}>
                    {option.label}
                  </option>
                {/each}
              </select>
              <span class="date-range-hint">
                {dateRangeOptions.find(o => o.value === memoryDays)?.description || ''}
              </span>
            </div>

            <div class="sync-actions-row">
              <button
                class="status-check-btn"
                on:click={handleCheckStatus}
                disabled={isCheckingStatus || isSyncing}
              >
                {#if isCheckingStatus}
                  <span class="spinning">↻</span> Checking...
                {:else}
                  <span class="btn-icon">📊</span> Check Status
                {/if}
              </button>
            </div>

            <!-- Sync Comparison Display -->
            {#if syncComparison && !syncComparison.error}
              <div class="sync-comparison">
                <div class="comparison-header">
                  <span class="comparison-title">Sync Status</span>
                  {#if syncComparison.differences.syncRecommended}
                    <span class="sync-badge recommended">Sync Recommended</span>
                  {:else}
                    <span class="sync-badge up-to-date">Up to Date</span>
                  {/if}
                </div>

                <div class="comparison-grid">
                  <div class="comparison-item">
                    <span class="comparison-label">Server</span>
                    <span class="comparison-value server">{syncComparison.server.memoryCount} memories</span>
                  </div>
                  <div class="comparison-item">
                    <span class="comparison-label">Local</span>
                    <span class="comparison-value local">{syncComparison.local.memoryCount} memories</span>
                  </div>
                </div>

                {#if syncComparison.differences.newMemoriesOnServer > 0}
                  <div class="comparison-diff">
                    <span class="diff-icon">↓</span>
                    <span class="diff-text">
                      {syncComparison.differences.newMemoriesOnServer} new memories available on server
                    </span>
                  </div>
                {/if}
              </div>
            {/if}

            {#if statusCheckError}
              <div class="status-error">
                <span class="error-icon">⚠️</span>
                <span class="error-text">{statusCheckError}</span>
              </div>
            {/if}

            <span class="sync-hint">Download profile, memories, and credentials from your server</span>
          </div>
        {/if}

        <div class="wifi-warning">
          <span class="warning-icon">📶</span>
          <div class="warning-content">
            <span class="warning-title">WiFi Recommended</span>
            <span class="warning-text">
              Sync operations can transfer significant amounts of data.
              We recommend using a WiFi connection to avoid mobile data charges.
            </span>
          </div>
        </div>

        <div class="options-section">
          <div class="options-header">
            <span class="options-title">Select data to sync:</span>
            <div class="bulk-actions">
              <button class="bulk-btn" on:click={selectAll}>All</button>
              <button class="bulk-btn" on:click={selectNone}>None</button>
            </div>
          </div>

          <div class="options-list">
            {#each syncOptions as option}
              <label class="option-item" class:has-warning={option.warning}>
                <input
                  type="checkbox"
                  checked={option.enabled}
                  on:change={() => toggleOption(option.id)}
                />
                <div class="option-content">
                  <div class="option-header">
                    <span class="option-label">{option.label}</span>
                    {#if option.estimatedSize}
                      <span class="option-size">{option.estimatedSize}</span>
                    {/if}
                  </div>
                  <span class="option-description">{option.description}</span>
                  {#if option.warning}
                    <span class="option-warning">⚠️ {option.warning}</span>
                  {/if}
                </div>
              </label>
            {/each}
          </div>
        </div>

        </div><!-- End scrollable-content -->

        <div class="action-section">
          <button
            class="sync-btn primary"
            on:click={handleRemoteSync}
            disabled={!syncOptions.some(opt => opt.enabled) || !isServerConfigured}
          >
            <span class="btn-icon">⟳</span>
            {isServerConfigured ? 'Start Sync' : 'Configure Server First'}
          </button>
          <button class="sync-btn secondary" on:click={handleClose}>
            Cancel
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Sync Complete Dialog -->
{#if showSyncComplete && syncResult}
  <div class="modal-overlay" on:click={handleCloseSyncComplete}>
    <div class="sync-complete-modal" on:click|stopPropagation>
      <div class="complete-icon-wrapper">
        {#if syncResult.success}
          <span class="complete-icon success">✓</span>
        {:else}
          <span class="complete-icon error">✗</span>
        {/if}
      </div>

      <h3 class="complete-title">
        {syncResult.success ? 'Sync Complete!' : 'Sync Failed'}
      </h3>

      {#if syncResult.success}
        <div class="complete-stats">
          {#if syncResult.profileFiles}
            <div class="stat-item">
              <span class="stat-icon">📋</span>
              <span class="stat-value">{syncResult.profileFiles}</span>
              <span class="stat-label">profile files imported</span>
            </div>
          {/if}
          {#if syncResult.memoriesImported}
            <div class="stat-item">
              <span class="stat-icon">🧠</span>
              <span class="stat-value">{syncResult.memoriesImported}</span>
              <span class="stat-label">memories synced</span>
            </div>
          {/if}
          {#if syncResult.credentialsSynced}
            <div class="stat-item">
              <span class="stat-icon">🔑</span>
              <span class="stat-value">✓</span>
              <span class="stat-label">credentials synced</span>
            </div>
          {/if}

          <!-- Update result feedback -->
          {#if updateResult.checked}
            {#if updateResult.downloadStarted}
              <div class="stat-item update-downloading">
                <span class="stat-icon">⬇️</span>
                <span class="stat-value">{updateResult.version}</span>
                <span class="stat-label">update started!</span>
              </div>
            {:else if updateResult.available}
              <div class="stat-item update-available">
                <span class="stat-icon">🆕</span>
                <span class="stat-value">{updateResult.version}</span>
                <span class="stat-label">app update available!</span>
              </div>
            {:else if !updateResult.error}
              <div class="stat-item">
                <span class="stat-icon">✅</span>
                <span class="stat-value">v{updateResult.version || 'current'}</span>
                <span class="stat-label">app is up to date</span>
              </div>
            {/if}

            {#if updateResult.error}
              <div class="stat-item update-error">
                <span class="stat-icon">⚠️</span>
                <span class="stat-label">{updateResult.error}</span>
              </div>
            {/if}
          {/if}

          {#if !syncResult.profileFiles && !syncResult.memoriesImported && !syncResult.credentialsSynced && !updateResult.checked}
            <div class="stat-item">
              <span class="stat-icon">📡</span>
              <span class="stat-label">Connection verified - no new data to sync</span>
            </div>
          {/if}
        </div>

        <p class="complete-message">
          {#if updateResult.downloadStarted}
            {#if $updateState.platform === 'mobile'}
              APK download started. Check your browser or system downloads to install.
            {:else}
              Update started. Monitor server logs for completion.
            {/if}
          {:else if updateResult.available && $updateState.platform === 'mobile' && $updateState.latestMobileVersion?.downloadUrl}
            Update available! Click below to download.
          {:else if updateResult.available && $updateState.platform === 'server'}
            Update available! Click below to apply.
          {:else}
            Your local device is now up to date with your server.
          {/if}
        </p>

        {#if updateResult.available && !updateResult.downloadStarted}
          {#if $updateState.platform === 'mobile' && $updateState.latestMobileVersion?.downloadUrl}
            <button class="update-btn" on:click={() => downloadAndInstall()}>
              ⬇ Download Update ({updateResult.version})
            </button>
          {:else if $updateState.platform === 'server'}
            <button class="update-btn" on:click={() => downloadAndInstall()}>
              ⬆ Apply Update ({updateResult.version || 'latest'})
            </button>
          {/if}
        {/if}
      {:else}
        <div class="error-details">
          <span class="error-message">{syncResult.error || 'An unknown error occurred'}</span>
        </div>
        <p class="complete-message">
          Please check your server connection and try again.
        </p>
      {/if}

      <button class="complete-btn" on:click={handleCloseSyncComplete}>
        {syncResult.success ? 'Done' : 'Close'}
      </button>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .sync-manager {
    background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(0, 255, 136, 0.2);
    border-radius: 1rem;
    width: 90%;
    max-width: 450px;
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow:
      0 0 40px rgba(0, 255, 136, 0.1),
      0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 1.25rem;
    border-bottom: 1px solid rgba(0, 255, 136, 0.15);
    background: rgba(0, 255, 136, 0.03);
  }

  .header-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: #00ff88;
    text-shadow: 0 0 10px rgba(0, 255, 136, 0.3);
  }

  .header-subtitle {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    line-height: 1;
    padding: 0.25rem;
    transition: color 0.2s;
  }

  .close-btn:hover {
    color: #ff6b6b;
  }

  /* Scrollable Content Container */
  .scrollable-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0; /* Important for flex children to respect overflow */
  }

  /* WiFi Warning */
  .wifi-warning {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    background: rgba(255, 193, 7, 0.1);
    border-bottom: 1px solid rgba(255, 193, 7, 0.2);
  }

  .warning-icon {
    font-size: 1.25rem;
  }

  .warning-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .warning-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #ffc107;
  }

  .warning-text {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.4;
  }

  /* Options Section */
  .options-section {
    padding: 1rem 1.25rem;
  }

  .options-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .options-title {
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.7);
  }

  .bulk-actions {
    display: flex;
    gap: 0.5rem;
  }

  .bulk-btn {
    padding: 0.25rem 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.25rem;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.6875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .bulk-btn:hover {
    background: rgba(0, 255, 136, 0.1);
    border-color: rgba(0, 255, 136, 0.3);
    color: #00ff88;
  }

  .options-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .option-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .option-item:hover {
    background: rgba(0, 255, 136, 0.05);
    border-color: rgba(0, 255, 136, 0.2);
  }

  .option-item.has-warning {
    border-color: rgba(255, 152, 0, 0.3);
  }

  .option-item input[type="checkbox"] {
    margin-top: 0.125rem;
    width: 1rem;
    height: 1rem;
    accent-color: #00ff88;
    cursor: pointer;
  }

  .option-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
  }

  .option-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .option-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #ffffff;
  }

  .option-size {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.4);
    font-family: monospace;
  }

  .option-description {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.4;
  }

  .option-warning {
    font-size: 0.6875rem;
    color: #ff9800;
    margin-top: 0.25rem;
  }

  /* Action Section */
  .action-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.25rem;
    border-top: 1px solid rgba(0, 255, 136, 0.15);
  }

  .sync-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .sync-btn.primary {
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
    border: none;
    color: #1a1a2e;
  }

  .sync-btn.primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #00ff99 0%, #00dd77 100%);
    box-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
  }

  .sync-btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sync-btn.secondary {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.7);
  }

  .sync-btn.secondary:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .btn-icon {
    font-size: 1rem;
  }

  /* Sync Progress Section */
  .sync-progress-section {
    padding: 2rem 1.25rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
  }

  .sync-animation {
    position: relative;
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-ring {
    position: absolute;
    width: 100%;
    height: 100%;
    border: 2px solid rgba(0, 255, 136, 0.3);
    border-radius: 50%;
    animation: pulse 2s ease-out infinite;
  }

  .pulse-ring.delay-1 {
    animation-delay: 0.5s;
  }

  .pulse-ring.delay-2 {
    animation-delay: 1s;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.5);
      opacity: 1;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }

  .sync-icon {
    font-size: 2rem;
    color: #00ff88;
    animation: spin 2s linear infinite;
    text-shadow: 0 0 20px rgba(0, 255, 136, 0.5);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .scifi-message {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-family: 'Courier New', monospace;
    font-size: 0.875rem;
    color: #00ff88;
    text-shadow: 0 0 10px rgba(0, 255, 136, 0.3);
  }

  .cursor {
    animation: blink 1s step-end infinite;
  }

  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  .progress-details {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .progress-bar {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #00ff88 0%, #00cc6a 100%);
    border-radius: 2px;
    transition: width 0.3s ease;
    box-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
  }

  .progress-text {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
  }

  .progress-category {
    color: rgba(255, 255, 255, 0.6);
  }

  .progress-percent {
    color: #00ff88;
    font-family: monospace;
  }

  .progress-indeterminate {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .indeterminate-bar {
    width: 30%;
    height: 100%;
    background: linear-gradient(90deg, #00ff88 0%, #00cc6a 100%);
    border-radius: 2px;
    animation: indeterminate 1.5s ease-in-out infinite;
    box-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
  }

  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  .sync-warning-active {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
  }

  /* Server Configuration Styles */
  .server-config-section {
    border-bottom: 1px solid rgba(0, 255, 136, 0.15);
  }

  .server-config-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .server-config-header:hover {
    background: rgba(0, 255, 136, 0.05);
  }

  .server-status {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .server-icon {
    font-size: 1.25rem;
    margin-top: 0.125rem;
  }

  .server-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .server-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #ffffff;
  }

  .server-url {
    font-size: 0.75rem;
    color: #00ff88;
    font-family: monospace;
  }

  .server-hint {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .last-sync {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.4);
  }

  .expand-icon {
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.75rem;
  }

  .server-config-form {
    padding: 0 1.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .form-group label {
    font-size: 0.75rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.7);
  }

  .form-group input {
    padding: 0.625rem 0.75rem;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: #ffffff;
    transition: border-color 0.2s;
  }

  .form-group input:focus {
    outline: none;
    border-color: rgba(0, 255, 136, 0.5);
  }

  .form-group input::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  .form-group input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .connection-result {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
  }

  .connection-result.success {
    background: rgba(0, 255, 136, 0.1);
    border: 1px solid rgba(0, 255, 136, 0.3);
    color: #00ff88;
  }

  .connection-result.error {
    background: rgba(255, 107, 107, 0.1);
    border: 1px solid rgba(255, 107, 107, 0.3);
    color: #ff6b6b;
  }

  .result-icon {
    font-weight: bold;
  }

  .server-config-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .config-btn {
    flex: 1;
    padding: 0.625rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .config-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .config-btn.test {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.8);
  }

  .config-btn.test:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .config-btn.save {
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
    border: none;
    color: #1a1a2e;
  }

  .config-btn.save:hover:not(:disabled) {
    box-shadow: 0 0 15px rgba(0, 255, 136, 0.3);
  }

  .config-btn.clear {
    background: rgba(255, 107, 107, 0.1);
    border: 1px solid rgba(255, 107, 107, 0.3);
    color: #ff6b6b;
    flex: 0.5;
  }

  .config-btn.clear:hover {
    background: rgba(255, 107, 107, 0.2);
  }

  /* Sync Settings Section */
  .sync-settings-section {
    border-bottom: 1px solid rgba(0, 255, 136, 0.15);
  }

  .sync-settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .sync-settings-header:hover {
    background: rgba(0, 255, 136, 0.05);
  }

  .settings-status {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .settings-icon {
    font-size: 1.25rem;
    margin-top: 0.125rem;
  }

  .settings-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .settings-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #ffffff;
  }

  .settings-hint {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .sync-settings-form {
    padding: 0 1.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .settings-group h4 {
    font-size: 0.75rem;
    font-weight: 600;
    color: #00ff88;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
    padding-bottom: 0.375rem;
    border-bottom: 1px solid rgba(0, 255, 136, 0.2);
  }

  .setting-toggle {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.5rem 0;
    cursor: pointer;
  }

  .setting-toggle input[type="checkbox"] {
    margin-top: 0.25rem;
    accent-color: #00ff88;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .toggle-label {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .toggle-label strong {
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
  }

  .toggle-label small {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .settings-actions {
    display: flex;
    gap: 0.5rem;
    padding-top: 0.5rem;
  }

  /* Remote Sync Section */
  .remote-sync-section {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid rgba(0, 255, 136, 0.15);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* Date Range Selector */
  .date-range-section {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
  }

  .date-range-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.7);
  }

  .date-range-select {
    padding: 0.5rem 0.75rem;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: #ffffff;
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .date-range-select:focus {
    outline: none;
    border-color: rgba(0, 255, 136, 0.5);
  }

  .date-range-select option {
    background: #1a1a2e;
    color: #ffffff;
    padding: 0.5rem;
  }

  .date-range-hint {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.4);
    font-style: italic;
  }

  .remote-sync-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1rem;
    background: linear-gradient(135deg, #4a90d9 0%, #357abd 100%);
    border: none;
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: #ffffff;
    cursor: pointer;
    transition: all 0.2s;
  }

  .remote-sync-btn:hover:not(:disabled) {
    box-shadow: 0 0 20px rgba(74, 144, 217, 0.3);
    background: linear-gradient(135deg, #5a9fe8 0%, #4589cc 100%);
  }

  .remote-sync-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sync-hint {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
  }

  /* Sync Actions Row */
  .sync-actions-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .status-check-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.2s;
  }

  .status-check-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .status-check-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinning {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Sync Comparison Display */
  .sync-comparison {
    background: rgba(0, 255, 136, 0.05);
    border: 1px solid rgba(0, 255, 136, 0.2);
    border-radius: 0.5rem;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .comparison-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .comparison-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #00ff88;
  }

  .sync-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .sync-badge.recommended {
    background: rgba(255, 193, 7, 0.2);
    color: #ffc107;
  }

  .sync-badge.up-to-date {
    background: rgba(0, 255, 136, 0.2);
    color: #00ff88;
  }

  .comparison-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .comparison-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0.375rem;
  }

  .comparison-label {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .comparison-value {
    font-size: 0.9375rem;
    font-weight: 600;
    font-family: monospace;
  }

  .comparison-value.server {
    color: #4a90d9;
  }

  .comparison-value.local {
    color: #00ff88;
  }

  .comparison-diff {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    background: rgba(255, 193, 7, 0.1);
    border-radius: 0.375rem;
  }

  .diff-icon {
    font-size: 1rem;
    color: #ffc107;
  }

  .diff-text {
    font-size: 0.75rem;
    color: #ffc107;
  }

  /* Status Error */
  .status-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem;
    background: rgba(255, 107, 107, 0.1);
    border: 1px solid rgba(255, 107, 107, 0.3);
    border-radius: 0.375rem;
    margin-bottom: 0.75rem;
  }

  .status-error .error-icon {
    font-size: 1rem;
  }

  .status-error .error-text {
    font-size: 0.75rem;
    color: #ff6b6b;
  }

  /* Sync Complete Modal */
  .sync-complete-modal {
    background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(0, 255, 136, 0.3);
    border-radius: 1rem;
    width: 90%;
    max-width: 360px;
    padding: 2rem;
    text-align: center;
    box-shadow:
      0 0 60px rgba(0, 255, 136, 0.2),
      0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .complete-icon-wrapper {
    margin-bottom: 1.5rem;
  }

  .complete-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 4rem;
    height: 4rem;
    border-radius: 50%;
    font-size: 2rem;
    font-weight: bold;
  }

  .complete-icon.success {
    background: linear-gradient(135deg, rgba(0, 255, 136, 0.2) 0%, rgba(0, 204, 106, 0.2) 100%);
    border: 2px solid #00ff88;
    color: #00ff88;
    box-shadow: 0 0 30px rgba(0, 255, 136, 0.3);
  }

  .complete-icon.error {
    background: linear-gradient(135deg, rgba(255, 107, 107, 0.2) 0%, rgba(204, 85, 85, 0.2) 100%);
    border: 2px solid #ff6b6b;
    color: #ff6b6b;
    box-shadow: 0 0 30px rgba(255, 107, 107, 0.3);
  }

  .complete-title {
    margin: 0 0 1.5rem 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: #ffffff;
  }

  .complete-stats {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(0, 255, 136, 0.05);
    border: 1px solid rgba(0, 255, 136, 0.15);
    border-radius: 0.5rem;
  }

  .stat-icon {
    font-size: 1.25rem;
  }

  .stat-value {
    font-size: 1.125rem;
    font-weight: 700;
    color: #00ff88;
    font-family: monospace;
  }

  .stat-label {
    flex: 1;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.7);
    text-align: left;
  }

  .complete-message {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.6);
    margin: 0 0 1.5rem 0;
  }

  .error-details {
    padding: 0.75rem;
    background: rgba(255, 107, 107, 0.1);
    border: 1px solid rgba(255, 107, 107, 0.3);
    border-radius: 0.375rem;
    margin-bottom: 1rem;
  }

  .error-details .error-message {
    font-size: 0.8125rem;
    color: #ff6b6b;
  }

  .complete-btn {
    width: 100%;
    padding: 0.875rem 1rem;
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
    border: none;
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: #1a1a2e;
    cursor: pointer;
    transition: all 0.2s;
  }

  .complete-btn:hover {
    box-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
  }

  .stat-item.update-available {
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(234, 88, 12, 0.2) 100%);
    border: 1px solid rgba(245, 158, 11, 0.4);
    border-radius: 0.5rem;
    padding: 0.5rem;
    animation: pulse-update 2s infinite;
  }

  .stat-item.update-downloading {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.2) 100%);
    border: 1px solid rgba(59, 130, 246, 0.4);
    border-radius: 0.5rem;
    padding: 0.5rem;
  }

  .stat-item.update-downloading .stat-icon {
    animation: bounce-download 1s infinite;
  }

  @keyframes bounce-download {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(3px); }
  }

  .stat-item.update-error {
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.2) 100%);
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 0.5rem;
    padding: 0.5rem;
  }

  .stat-item.update-error .stat-label {
    color: #fca5a5;
  }

  @keyframes pulse-update {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }

  .update-btn {
    width: 100%;
    padding: 0.75rem 1rem;
    margin-top: 0.75rem;
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    border: none;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: white;
    cursor: pointer;
    transition: all 0.2s;
  }

  .update-btn:hover {
    box-shadow: 0 0 20px rgba(245, 158, 11, 0.4);
    transform: translateY(-1px);
  }
</style>

<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { formatFileSize, updateState, checkForUpdates, downloadAndInstall } from '../lib/client/app-updater';
  import {
    configureRemoteSyncServer,
    testRemoteServerConnection,
    getRemoteSyncConfig,
    clearRemoteSyncConfig,
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
  import { runTriggerNow } from '../lib/stores/trigger-manager';

  async function triggerAgent(agentName: string, args: string[] = []): Promise<{ success: boolean; taskId?: string; error?: string }> {
    try {
      const taskId = await runTriggerNow(agentName, args);
      return { success: true, taskId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

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

  async function waitForProfileSync(maxWaitMs: number = 120000): Promise<any> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < maxWaitMs) {
      const state = await readProfileSyncState();

      if (state) {
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

  let serverUrl = '';
  let serverUsername = '';
  let serverPassword = '';
  let isServerConfigured = false;
  let isTestingConnection = false;
  let connectionTestResult: { success: boolean; message: string } | null = null;
  let isSavingConfig = false;
  let showServerConfig = false;
  let lastSyncAt: string | null = null;

  let remoteSyncPhase: RemoteSyncProgress['phase'] | null = null;
  let remoteSyncMessage = '';

  let syncSettingsData: SyncSettings | null = null;
  let showSyncSettings = false;
  let isSavingSettings = false;

  let isCheckingStatus = false;
  let syncComparison: SyncComparison | null = null;
  let statusCheckError: string | null = null;

  let showSyncComplete = false;
  let syncResult: RemoteSyncResult | null = null;

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

  let memoryDays = 7;

  interface SyncOption {
    id: string;
    label: string;
    description: string;
    enabled: boolean;
    warning?: string;
    estimatedSize?: string;
  }

  let syncOptions: SyncOption[] = [
    { id: 'persona', label: 'Persona Files', description: 'Core identity, personality traits, relationships, and decision rules', enabled: false, estimatedSize: '~50 KB' },
    { id: 'config', label: 'Configuration', description: 'Settings, preferences, model registry, and runtime config', enabled: false, estimatedSize: '~25 KB' },
    { id: 'memories', label: 'Memories', description: 'Episodic memories, conversations, and inner dialogue', enabled: true, estimatedSize: 'Variable' },
    { id: 'logs', label: 'Audit Logs', description: 'System logs and audit trail (for debugging)', enabled: false, estimatedSize: 'Large' },
    { id: 'models', label: 'LoRA Adapters', description: 'Custom fine-tuned model weights', enabled: false, warning: 'Not recommended - files can be 500MB+ each', estimatedSize: '500MB+' },
    { id: 'update', label: 'Program Update', description: 'Check for and download app updates', enabled: true, estimatedSize: '~10 MB' },
  ];

  const scifiMessages = [
    'Synchronizing the stack...', 'Backing up your ghost...', 'Preventing ghost hack vulnerabilities...',
    'Updating wetware protocols...', 'Verifying wetware integrity...', 'Jacking into the matrix...',
    'Decking through ICE barriers...', 'Flatlining countermeasures...', 'Riding the razorgirl protocol...',
    'Burning chrome signatures...', 'Replicating memory engrams...', 'Voight-Kampff verification active...',
    'Processing baseline data...', 'Retiring obsolete sectors...', 'Diving into the net...',
    'Securing Section 9 protocols...', 'Laughing Man encryption active...', 'Puppet master handshake...',
    'Stand Alone Complex sync...', 'Entering the Metaverse...', 'Gargoyle mode engaged...',
    'Snow Crash firewall active...', 'Hiro Protagonist protocol...', 'Cyberspace handshake complete...',
    'Neural link established...', 'Uploading consciousness fragments...', 'Downloading identity backup...',
    'Meat-to-metal bridge active...', 'Chrome extensions syncing...', 'Biochip verification...',
    'Street samurai mode...', 'Netrunner protocol engaged...', 'Braindance sync in progress...',
    'Augmentation sync active...', 'UNATCO uplink established...', 'Nano-augmentation verified...',
    'Red pill accepted...', 'Downloading kung fu...', 'Nebuchadnezzar uplink...',
    'Zion mainframe sync...', 'Sentinels bypassed...', 'Stack backup initiated...',
    'Cortical stack sync...', 'Sleeve transfer protocol...', 'DHF pattern verified...',
    'Envoy conditioning active...', 'fsociety protocol active...', 'Dark Army bypass engaged...',
    'E Corp firewall penetrated...', 'Ansible connection stable...', 'Gom jabbar test passed...',
    'Spice flow initiated...', 'Mentat calculations complete...', 'Holographic archive syncing...',
    'Quantum entanglement verified...', 'Tachyon burst received...', 'Subspace relay active...',
    'Warp signature locked...', 'Replicator patterns cached...', 'Meatspace tether stable...',
    'Digital exocortex syncing...', 'Neuroweave calibration...', 'Psycho-pass clearance verified...',
    'Memory palace reconstruction...', 'Synaptic bridge established...', 'Ego backup confirmed...',
    'Identity matrix verified...', 'Personality substrate sync...', 'Cognitive mesh active...',
    'Mind-state serialization...', 'Ghost protocol engaged...', 'Soul backup in progress...',
    'Digital twin synchronizing...', 'Memetic payload delivered...', 'Consciousness partition active...',
  ];

  let currentMessageIndex = 0;
  let currentMessage = scifiMessages[0];
  let messageInterval: ReturnType<typeof setInterval> | null = null;

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
      connectionTestResult = { success: result.success, message: result.success ? 'Connection successful!' : result.error || 'Connection failed' };
    } catch (err) {
      connectionTestResult = { success: false, message: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` };
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
      connectionTestResult = { success: false, message: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` };
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
    updateResult = { checked: false, available: false, version: null, downloadStarted: false, error: null };

    const wantPersona = syncOptions.find(o => o.id === 'persona')?.enabled ?? false;
    const wantConfig = syncOptions.find(o => o.id === 'config')?.enabled ?? false;
    const wantMemories = syncOptions.find(o => o.id === 'memories')?.enabled ?? false;
    const wantUpdate = syncOptions.find(o => o.id === 'update')?.enabled ?? false;
    const onlyUpdateSelected = wantUpdate && !wantPersona && !wantConfig && !wantMemories;

    const errors: string[] = [];

    try {
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
        syncResult = { success: errors.length === 0, error: errors.join('; ') || undefined };
        remoteSyncPhase = errors.length === 0 ? 'complete' : 'error';
        showSyncComplete = true;
      } else {
        const agentArgs: string[] = ['--pull-only'];
        if (wantMemories && !wantPersona && !wantConfig) {
          agentArgs.push('--memories-only');
        } else if ((wantPersona || wantConfig) && !wantMemories) {
          agentArgs.push('--profile-only');
        }
        if (memoryDays > 0) {
          agentArgs.push(`--days=${memoryDays}`);
        }

        remoteSyncMessage = 'Triggering profile-sync agent...';
        remoteSyncPhase = 'downloading';

        const agentResult = await triggerAgent('profile-sync', agentArgs);

        if (agentResult.success) {
          remoteSyncMessage = `Profile sync queued as ${agentResult.taskId}. Syncing...`;
          const finalState = await waitForProfileSync(120000);

          if (finalState.phase === 'complete') {
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

            const successParts: string[] = [];
            if (finalState.profileFiles > 0) successParts.push(`${finalState.profileFiles} profile files`);
            if (finalState.memoriesImported > 0) successParts.push(`${finalState.memoriesImported} memories`);
            if (finalState.credentialsSynced) successParts.push('credentials');
            if (updateResult.checked) successParts.push('update checked');

            remoteSyncPhase = 'complete';
            remoteSyncMessage = `Sync complete! ${successParts.join(', ')}.`;
            syncResult = { success: true, profileFiles: finalState.profileFiles || 0, memoriesImported: finalState.memoriesImported || 0, credentialsSynced: finalState.credentialsSynced || false };
          } else {
            errors.push(finalState.message || 'Sync failed');
            remoteSyncPhase = 'error';
            remoteSyncMessage = finalState.message || 'Sync failed';
            syncResult = { success: false, error: finalState.message || finalState.error || 'Sync failed' };
          }
        } else {
          errors.push(agentResult.error || 'Failed to start profile-sync agent');
          remoteSyncPhase = 'error';
          remoteSyncMessage = agentResult.error || 'Failed to start profile-sync agent';
          syncResult = { success: false, error: agentResult.error || 'Failed to start profile-sync agent' };
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
    updateResult = { checked: false, available: false, version: null, downloadStarted: false, error: null };
  }

  function toggleOption(id: string) {
    syncOptions = syncOptions.map(opt => opt.id === id ? { ...opt, enabled: !opt.enabled } : opt);
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
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] backdrop-blur-sm" on:click={handleClose}>
    <div class="bg-gradient-to-b from-[#1a1a2e] to-[#16213e] border border-emerald-500/20 rounded-2xl w-[90%] max-w-[450px] max-h-[85vh] overflow-hidden flex flex-col shadow-[0_0_40px_rgba(0,255,136,0.1),0_20px_60px_rgba(0,0,0,0.5)]" on:click|stopPropagation>
      <!-- Header -->
      <div class="flex justify-between items-start p-5 border-b border-emerald-500/15 bg-emerald-500/[0.03]">
        <div class="flex flex-col gap-1">
          <h3 class="m-0 text-lg font-semibold text-emerald-400 drop-shadow-[0_0_10px_rgba(0,255,136,0.3)]">Sync Manager</h3>
          <span class="text-xs text-white/50">Configure your synchronization</span>
        </div>
        {#if !isSyncing}
          <button class="bg-transparent border-0 text-2xl text-white/50 cursor-pointer p-1 leading-none hover:text-red-400 transition-colors" on:click={handleClose}>×</button>
        {/if}
      </div>

      {#if isSyncing}
        <!-- Syncing State -->
        <div class="p-8 flex flex-col items-center gap-6">
          <div class="relative w-20 h-20 flex items-center justify-center">
            <div class="absolute inset-0 border-2 border-emerald-500/30 rounded-full animate-pulse-ring"></div>
            <div class="absolute inset-0 border-2 border-emerald-500/30 rounded-full animate-pulse-ring delay-500"></div>
            <div class="absolute inset-0 border-2 border-emerald-500/30 rounded-full animate-pulse-ring delay-1000"></div>
            <span class="text-3xl text-emerald-400 animate-spin drop-shadow-[0_0_20px_rgba(0,255,136,0.5)]">⟳</span>
          </div>

          <div class="flex items-center gap-1 font-mono text-sm text-emerald-400 drop-shadow-[0_0_10px_rgba(0,255,136,0.3)]">
            <span>{currentMessage}</span>
            <span class="animate-blink">_</span>
          </div>

          {#if syncProgress}
            <div class="w-full flex flex-col gap-2">
              <div class="w-full h-1 bg-white/10 rounded overflow-hidden">
                <div class="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded transition-all duration-300 shadow-[0_0_10px_rgba(0,255,136,0.5)]" style="width: {getProgressPercent()}%"></div>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-white/60">{syncProgress.category}</span>
                <span class="text-emerald-400 font-mono">{getProgressPercent()}%</span>
              </div>
            </div>
          {:else}
            <div class="w-full h-1 bg-white/10 rounded overflow-hidden">
              <div class="w-[30%] h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded animate-indeterminate shadow-[0_0_10px_rgba(0,255,136,0.5)]"></div>
            </div>
          {/if}

          <p class="text-xs text-white/50 text-center">Do not close the app while syncing...</p>
        </div>
      {:else}
        <!-- Options State -->
        <div class="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          <!-- Server Configuration Section -->
          <div class="border-b border-emerald-500/15">
            <button class="w-full flex justify-between items-center p-4 cursor-pointer transition-colors hover:bg-emerald-500/5" on:click={() => showServerConfig = !showServerConfig}>
              <div class="flex items-start gap-3">
                <span class="text-xl mt-0.5">{isServerConfigured ? '🔗' : '⚙️'}</span>
                <div class="flex flex-col gap-0.5">
                  <span class="text-sm font-medium text-white">{isServerConfigured ? 'Remote Server Connected' : 'Configure Sync Server'}</span>
                  {#if isServerConfigured}
                    <span class="text-xs text-emerald-400 font-mono">{serverUrl}</span>
                    {#if lastSyncAt}
                      <span class="text-[11px] text-white/40">Last sync: {new Date(lastSyncAt).toLocaleString()}</span>
                    {/if}
                  {:else}
                    <span class="text-xs text-white/50">Set up server to sync your profile</span>
                  {/if}
                </div>
              </div>
              <span class="text-xs text-white/40">{showServerConfig ? '▼' : '▶'}</span>
            </button>

            {#if showServerConfig}
              <div class="px-5 pb-4 flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <label class="text-xs font-medium text-white/70" for="serverUrl">Server URL</label>
                  <input type="url" id="serverUrl" class="px-3 py-2.5 bg-black/30 border border-white/10 rounded-md text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="https://mh.example.com" bind:value={serverUrl} disabled={isSavingConfig || isTestingConnection} />
                </div>

                <div class="flex flex-col gap-1.5">
                  <label class="text-xs font-medium text-white/70" for="serverUsername">Username</label>
                  <input type="text" id="serverUsername" class="px-3 py-2.5 bg-black/30 border border-white/10 rounded-md text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed" placeholder="your-username" bind:value={serverUsername} disabled={isSavingConfig || isTestingConnection} />
                </div>

                <div class="flex flex-col gap-1.5">
                  <label class="text-xs font-medium text-white/70" for="serverPassword">Password</label>
                  <input type="password" id="serverPassword" class="px-3 py-2.5 bg-black/30 border border-white/10 rounded-md text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed" placeholder={isServerConfigured ? '••••••••' : 'your-password'} bind:value={serverPassword} disabled={isSavingConfig || isTestingConnection} />
                </div>

                {#if connectionTestResult}
                  <div class="flex items-center gap-2 px-3 py-2.5 rounded-md text-[13px] {connectionTestResult.success ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-red-400/10 border border-red-400/30 text-red-400'}">
                    <span class="font-bold">{connectionTestResult.success ? '✓' : '✗'}</span>
                    <span>{connectionTestResult.message}</span>
                  </div>
                {/if}

                <div class="flex gap-2 mt-1">
                  <button class="flex-1 px-3 py-2.5 rounded-md text-[13px] font-medium cursor-pointer transition-all bg-white/5 border border-white/20 text-white/80 hover:bg-white/10 hover:border-white/30 disabled:opacity-50 disabled:cursor-not-allowed" on:click={handleTestConnection} disabled={!serverUrl || !serverUsername || !serverPassword || isTestingConnection || isSavingConfig}>
                    {isTestingConnection ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button class="flex-1 px-3 py-2.5 rounded-md text-[13px] font-medium cursor-pointer transition-all bg-gradient-to-br from-emerald-500 to-emerald-600 border-0 text-[#1a1a2e] hover:shadow-[0_0_15px_rgba(0,255,136,0.3)] disabled:opacity-50 disabled:cursor-not-allowed" on:click={handleSaveConfig} disabled={!serverUrl || !serverUsername || !serverPassword || isSavingConfig}>
                    {isSavingConfig ? 'Saving...' : 'Save & Connect'}
                  </button>
                  {#if isServerConfigured}
                    <button class="flex-[0.5] px-3 py-2.5 rounded-md text-[13px] font-medium cursor-pointer transition-all bg-red-400/10 border border-red-400/30 text-red-400 hover:bg-red-400/20" on:click={handleClearConfig}>
                      Disconnect
                    </button>
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <!-- Sync Settings Section -->
          <div class="border-b border-emerald-500/15">
            <button class="w-full flex justify-between items-center p-4 cursor-pointer transition-colors hover:bg-emerald-500/5" on:click={() => showSyncSettings = !showSyncSettings}>
              <div class="flex items-start gap-3">
                <span class="text-xl mt-0.5">⚙️</span>
                <div class="flex flex-col gap-0.5">
                  <span class="text-sm font-medium text-white">Sync Behavior Settings</span>
                  <span class="text-xs text-white/50">Auto-sync, WiFi-only, and defaults</span>
                </div>
              </div>
              <span class="text-xs text-white/40">{showSyncSettings ? '▼' : '▶'}</span>
            </button>

            {#if showSyncSettings && syncSettingsData}
              <div class="px-5 pb-4 flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <h4 class="text-xs font-semibold text-emerald-400 uppercase tracking-wide m-0 pb-1.5 border-b border-emerald-500/20">Automatic Sync</h4>

                  <label class="flex items-start gap-3 py-2 cursor-pointer">
                    <input type="checkbox" class="mt-1 accent-emerald-500 w-4 h-4 cursor-pointer" bind:checked={syncSettingsData.syncOnLogin} disabled={isSavingSettings} />
                    <span class="flex flex-col gap-0.5">
                      <strong class="text-[13px] font-medium text-white/90">Sync on login</strong>
                      <small class="text-[11px] text-white/50">Pull latest memories when logging in</small>
                    </span>
                  </label>

                  <label class="flex items-start gap-3 py-2 cursor-pointer">
                    <input type="checkbox" class="mt-1 accent-emerald-500 w-4 h-4 cursor-pointer" bind:checked={syncSettingsData.syncOnWifiOnly} disabled={isSavingSettings} />
                    <span class="flex flex-col gap-0.5">
                      <strong class="text-[13px] font-medium text-white/90">WiFi only</strong>
                      <small class="text-[11px] text-white/50">Don't sync on cellular data</small>
                    </span>
                  </label>

                  <label class="flex items-start gap-3 py-2 cursor-pointer">
                    <input type="checkbox" class="mt-1 accent-emerald-500 w-4 h-4 cursor-pointer" bind:checked={syncSettingsData.manualSyncOnly} disabled={isSavingSettings} />
                    <span class="flex flex-col gap-0.5">
                      <strong class="text-[13px] font-medium text-white/90">Manual sync only</strong>
                      <small class="text-[11px] text-white/50">Disable all automatic syncing</small>
                    </span>
                  </label>
                </div>

                <div class="flex flex-col gap-2">
                  <h4 class="text-xs font-semibold text-emerald-400 uppercase tracking-wide m-0 pb-1.5 border-b border-emerald-500/20">Default Sync Content</h4>

                  <label class="flex items-start gap-3 py-2 cursor-pointer">
                    <input type="checkbox" class="mt-1 accent-emerald-500 w-4 h-4 cursor-pointer" bind:checked={syncSettingsData.syncPersona} disabled={isSavingSettings} />
                    <span class="flex flex-col gap-0.5">
                      <strong class="text-[13px] font-medium text-white/90">Sync persona</strong>
                      <small class="text-[11px] text-white/50">Identity, personality, relationships</small>
                    </span>
                  </label>

                  <label class="flex items-start gap-3 py-2 cursor-pointer">
                    <input type="checkbox" class="mt-1 accent-emerald-500 w-4 h-4 cursor-pointer" bind:checked={syncSettingsData.syncSettings} disabled={isSavingSettings} />
                    <span class="flex flex-col gap-0.5">
                      <strong class="text-[13px] font-medium text-white/90">Sync settings</strong>
                      <small class="text-[11px] text-white/50">App preferences and configuration</small>
                    </span>
                  </label>

                  <label class="flex items-start gap-3 py-2 cursor-pointer">
                    <input type="checkbox" class="mt-1 accent-emerald-500 w-4 h-4 cursor-pointer" bind:checked={syncSettingsData.syncConversationBuffer} disabled={isSavingSettings} />
                    <span class="flex flex-col gap-0.5">
                      <strong class="text-[13px] font-medium text-white/90">Sync conversation buffer</strong>
                      <small class="text-[11px] text-white/50">Recent chat history (can be large)</small>
                    </span>
                  </label>
                </div>

                <div class="flex gap-2 pt-2">
                  <button class="flex-1 px-3 py-2.5 rounded-md text-[13px] font-medium cursor-pointer transition-all bg-gradient-to-br from-emerald-500 to-emerald-600 border-0 text-[#1a1a2e] hover:shadow-[0_0_15px_rgba(0,255,136,0.3)] disabled:opacity-50 disabled:cursor-not-allowed" on:click={handleSaveSyncSettings} disabled={isSavingSettings}>
                    {isSavingSettings ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              </div>
            {/if}
          </div>

          {#if isServerConfigured}
            <!-- Remote Sync Section -->
            <div class="p-4 border-b border-emerald-500/15 flex flex-col gap-3">
              <!-- Date Range Selector -->
              <div class="flex flex-col gap-1.5 p-3 bg-black/20 border border-white/10 rounded-lg">
                <label class="text-xs font-medium text-white/70">Memory sync range:</label>
                <select class="px-3 py-2 bg-black/30 border border-white/15 rounded-md text-sm text-white cursor-pointer focus:outline-none focus:border-emerald-500/50" bind:value={memoryDays}>
                  {#each dateRangeOptions as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
                <span class="text-[11px] text-white/40 italic">{dateRangeOptions.find(o => o.value === memoryDays)?.description || ''}</span>
              </div>

              <div class="flex gap-2 mb-3">
                <button class="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-sm font-medium text-white/80 cursor-pointer transition-all hover:bg-white/10 hover:border-white/30 disabled:opacity-50 disabled:cursor-not-allowed" on:click={handleCheckStatus} disabled={isCheckingStatus || isSyncing}>
                  {#if isCheckingStatus}
                    <span class="animate-spin">↻</span> Checking...
                  {:else}
                    <span>📊</span> Check Status
                  {/if}
                </button>
              </div>

              {#if syncComparison && !syncComparison.error}
                <div class="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 mb-3">
                  <div class="flex justify-between items-center mb-3">
                    <span class="text-[13px] font-semibold text-emerald-400">Sync Status</span>
                    {#if syncComparison.differences.syncRecommended}
                      <span class="text-[11px] font-semibold px-2 py-1 rounded bg-yellow-500/20 text-yellow-400">Sync Recommended</span>
                    {:else}
                      <span class="text-[11px] font-semibold px-2 py-1 rounded bg-emerald-500/20 text-emerald-400">Up to Date</span>
                    {/if}
                  </div>

                  <div class="grid grid-cols-2 gap-2 mb-2">
                    <div class="flex flex-col gap-0.5 p-2 bg-black/20 rounded-md">
                      <span class="text-[11px] text-white/50 uppercase tracking-wider">Server</span>
                      <span class="text-[15px] font-semibold font-mono text-blue-400">{syncComparison.server.memoryCount} memories</span>
                    </div>
                    <div class="flex flex-col gap-0.5 p-2 bg-black/20 rounded-md">
                      <span class="text-[11px] text-white/50 uppercase tracking-wider">Local</span>
                      <span class="text-[15px] font-semibold font-mono text-emerald-400">{syncComparison.local.memoryCount} memories</span>
                    </div>
                  </div>

                  {#if syncComparison.differences.newMemoriesOnServer > 0}
                    <div class="flex items-center gap-2 p-2 bg-yellow-500/10 rounded-md">
                      <span class="text-base text-yellow-400">↓</span>
                      <span class="text-xs text-yellow-400">{syncComparison.differences.newMemoriesOnServer} new memories available on server</span>
                    </div>
                  {/if}
                </div>
              {/if}

              {#if statusCheckError}
                <div class="flex items-center gap-2 px-2.5 py-2.5 bg-red-400/10 border border-red-400/30 rounded-md mb-3">
                  <span class="text-base">⚠️</span>
                  <span class="text-xs text-red-400">{statusCheckError}</span>
                </div>
              {/if}

              <span class="text-[11px] text-white/40 text-center">Download profile, memories, and credentials from your server</span>
            </div>
          {/if}

          <!-- WiFi Warning -->
          <div class="flex items-start gap-3 px-5 py-4 bg-yellow-500/10 border-b border-yellow-500/20">
            <span class="text-xl">📶</span>
            <div class="flex flex-col gap-1">
              <span class="text-[13px] font-semibold text-yellow-500">WiFi Recommended</span>
              <span class="text-xs text-white/60 leading-relaxed">Sync operations can transfer significant amounts of data. We recommend using a WiFi connection to avoid mobile data charges.</span>
            </div>
          </div>

          <!-- Options Section -->
          <div class="p-4">
            <div class="flex justify-between items-center mb-3">
              <span class="text-[13px] font-medium text-white/70">Select data to sync:</span>
              <div class="flex gap-2">
                <button class="px-2 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-white/60 cursor-pointer transition-all hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400" on:click={selectAll}>All</button>
                <button class="px-2 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-white/60 cursor-pointer transition-all hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400" on:click={selectNone}>None</button>
              </div>
            </div>

            <div class="flex flex-col gap-2">
              {#each syncOptions as option}
                <label class="flex items-start gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-lg cursor-pointer transition-all hover:bg-emerald-500/5 hover:border-emerald-500/20 {option.warning ? 'border-orange-500/30' : ''}">
                  <input type="checkbox" class="mt-0.5 w-4 h-4 accent-emerald-500 cursor-pointer" checked={option.enabled} on:change={() => toggleOption(option.id)} />
                  <div class="flex flex-col gap-1 flex-1">
                    <div class="flex justify-between items-center">
                      <span class="text-sm font-medium text-white">{option.label}</span>
                      {#if option.estimatedSize}
                        <span class="text-[11px] text-white/40 font-mono">{option.estimatedSize}</span>
                      {/if}
                    </div>
                    <span class="text-xs text-white/50 leading-relaxed">{option.description}</span>
                    {#if option.warning}
                      <span class="text-[11px] text-orange-500 mt-1">⚠️ {option.warning}</span>
                    {/if}
                  </div>
                </label>
              {/each}
            </div>
          </div>
        </div>

        <!-- Action Section -->
        <div class="flex flex-col gap-2 p-5 border-t border-emerald-500/15">
          <button class="flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg text-[15px] font-semibold cursor-pointer transition-all bg-gradient-to-br from-emerald-500 to-emerald-600 border-0 text-[#1a1a2e] hover:from-emerald-400 hover:to-emerald-500 hover:shadow-[0_0_20px_rgba(0,255,136,0.3)] disabled:opacity-50 disabled:cursor-not-allowed" on:click={handleRemoteSync} disabled={!syncOptions.some(opt => opt.enabled) || !isServerConfigured}>
            <span>⟳</span>
            {isServerConfigured ? 'Start Sync' : 'Configure Server First'}
          </button>
          <button class="flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg text-[15px] font-semibold cursor-pointer transition-all bg-transparent border border-white/20 text-white/70 hover:bg-white/5 hover:border-white/30" on:click={handleClose}>
            Cancel
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Sync Complete Dialog -->
{#if showSyncComplete && syncResult}
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] backdrop-blur-sm" on:click={handleCloseSyncComplete}>
    <div class="bg-gradient-to-b from-[#1a1a2e] to-[#16213e] border border-emerald-500/30 rounded-2xl w-[90%] max-w-[360px] p-8 text-center shadow-[0_0_60px_rgba(0,255,136,0.2),0_20px_60px_rgba(0,0,0,0.5)]" on:click|stopPropagation>
      <div class="mb-6">
        {#if syncResult.success}
          <span class="inline-flex items-center justify-center w-16 h-16 rounded-full text-3xl font-bold bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 border-2 border-emerald-400 text-emerald-400 shadow-[0_0_30px_rgba(0,255,136,0.3)]">✓</span>
        {:else}
          <span class="inline-flex items-center justify-center w-16 h-16 rounded-full text-3xl font-bold bg-gradient-to-br from-red-400/20 to-red-500/20 border-2 border-red-400 text-red-400 shadow-[0_0_30px_rgba(255,107,107,0.3)]">✗</span>
        {/if}
      </div>

      <h3 class="m-0 mb-6 text-xl font-semibold text-white">{syncResult.success ? 'Sync Complete!' : 'Sync Failed'}</h3>

      {#if syncResult.success}
        <div class="flex flex-col gap-3 mb-6">
          {#if syncResult.profileFiles}
            <div class="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
              <span class="text-xl">📋</span>
              <span class="text-lg font-bold font-mono text-emerald-400">{syncResult.profileFiles}</span>
              <span class="flex-1 text-[13px] text-white/70 text-left">profile files imported</span>
            </div>
          {/if}
          {#if syncResult.memoriesImported}
            <div class="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
              <span class="text-xl">🧠</span>
              <span class="text-lg font-bold font-mono text-emerald-400">{syncResult.memoriesImported}</span>
              <span class="flex-1 text-[13px] text-white/70 text-left">memories synced</span>
            </div>
          {/if}
          {#if syncResult.credentialsSynced}
            <div class="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
              <span class="text-xl">🔑</span>
              <span class="text-lg font-bold font-mono text-emerald-400">✓</span>
              <span class="flex-1 text-[13px] text-white/70 text-left">credentials synced</span>
            </div>
          {/if}

          {#if updateResult.checked}
            {#if updateResult.downloadStarted}
              <div class="flex items-center gap-2 p-3 bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/40 rounded-lg">
                <span class="text-xl animate-bounce-download">⬇️</span>
                <span class="text-lg font-bold font-mono text-blue-400">{updateResult.version}</span>
                <span class="flex-1 text-[13px] text-white/70 text-left">update started!</span>
              </div>
            {:else if updateResult.available}
              <div class="flex items-center gap-2 p-3 bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/40 rounded-lg animate-pulse-slow">
                <span class="text-xl">🆕</span>
                <span class="text-lg font-bold font-mono text-amber-400">{updateResult.version}</span>
                <span class="flex-1 text-[13px] text-white/70 text-left">app update available!</span>
              </div>
            {:else if !updateResult.error}
              <div class="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
                <span class="text-xl">✅</span>
                <span class="text-lg font-bold font-mono text-emerald-400">v{updateResult.version || 'current'}</span>
                <span class="flex-1 text-[13px] text-white/70 text-left">app is up to date</span>
              </div>
            {/if}

            {#if updateResult.error}
              <div class="flex items-center gap-2 p-3 bg-gradient-to-br from-red-500/20 to-red-600/20 border border-red-500/40 rounded-lg">
                <span class="text-xl">⚠️</span>
                <span class="flex-1 text-[13px] text-red-300 text-left">{updateResult.error}</span>
              </div>
            {/if}
          {/if}

          {#if !syncResult.profileFiles && !syncResult.memoriesImported && !syncResult.credentialsSynced && !updateResult.checked}
            <div class="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
              <span class="text-xl">📡</span>
              <span class="flex-1 text-[13px] text-white/70 text-left">Connection verified - no new data to sync</span>
            </div>
          {/if}
        </div>

        <p class="text-[13px] text-white/60 m-0 mb-6">
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
            <button class="w-full px-4 py-3 mt-3 bg-gradient-to-br from-amber-500 to-amber-600 border-0 rounded-lg text-sm font-semibold text-white cursor-pointer transition-all hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:-translate-y-0.5" on:click={() => downloadAndInstall()}>
              ⬇ Download Update ({updateResult.version})
            </button>
          {:else if $updateState.platform === 'server'}
            <button class="w-full px-4 py-3 mt-3 bg-gradient-to-br from-amber-500 to-amber-600 border-0 rounded-lg text-sm font-semibold text-white cursor-pointer transition-all hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:-translate-y-0.5" on:click={() => downloadAndInstall()}>
              ⬆ Apply Update ({updateResult.version || 'latest'})
            </button>
          {/if}
        {/if}
      {:else}
        <div class="p-3 bg-red-400/10 border border-red-400/30 rounded-md mb-4">
          <span class="text-[13px] text-red-400">{syncResult.error || 'An unknown error occurred'}</span>
        </div>
        <p class="text-[13px] text-white/60 m-0 mb-6">Please check your server connection and try again.</p>
      {/if}

      <button class="w-full px-4 py-3.5 bg-gradient-to-br from-emerald-500 to-emerald-600 border-0 rounded-lg text-[15px] font-semibold text-[#1a1a2e] cursor-pointer transition-all hover:shadow-[0_0_20px_rgba(0,255,136,0.3)]" on:click={handleCloseSyncComplete}>
        {syncResult.success ? 'Done' : 'Close'}
      </button>
    </div>
  </div>
{/if}

<style>
  /* Keyframe animations only */
  @keyframes pulse-ring {
    0% { transform: scale(0.5); opacity: 1; }
    100% { transform: scale(1.5); opacity: 0; }
  }

  .animate-pulse-ring {
    animation: pulse-ring 2s ease-out infinite;
  }

  .delay-500 {
    animation-delay: 0.5s;
  }

  .delay-1000 {
    animation-delay: 1s;
  }

  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  .animate-blink {
    animation: blink 1s step-end infinite;
  }

  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  .animate-indeterminate {
    animation: indeterminate 1.5s ease-in-out infinite;
  }

  @keyframes bounce-download {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(3px); }
  }

  .animate-bounce-download {
    animation: bounce-download 1s infinite;
  }

  .animate-pulse-slow {
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }
</style>

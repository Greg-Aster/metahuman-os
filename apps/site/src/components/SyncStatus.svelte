<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    initMemorySync,
    stopBackgroundSync,
    syncState,
    hasPendingChanges,
    hasConflicts,
    getConflicts,
    resolveConflict,
    getSyncStatusIcon,
    getSyncStatusColor,
    type SyncState,
    type SyncableMemory,
    type ConflictResolution,
  } from '../lib/client/memory-sync';
  import { isMobileApp } from '../lib/client/api-config';
  import {
    checkForUpdates,
    downloadAndInstall,
    updateState,
    isUpdateAvailable,
    formatFileSize,
    type UpdateState,
  } from '../lib/client/app-updater';
  import { getRemoteSyncConfig, syncFromRemoteServer } from '../lib/client/profile-sync';
  import SyncManager from './SyncManager.svelte';

  export let compact = false;

  let state: SyncState = {
    lastSyncTimestamp: null,
    pendingCount: 0,
    conflictCount: 0,
    isSyncing: false,
  };
  let pending = false;
  let conflicts = false;
  let syncing = false;
  let showConflictModal = false;
  let conflictList: SyncableMemory[] = [];

  // Update state
  let appUpdate: UpdateState | null = null;
  let updateAvailable = false;
  let showUpdateModal = false;
  let isMobile = false;
  let updateDismissed = false;
  let showUpdateNotice = false;

  // Sync Manager state
  let showSyncManager = false;
  let syncProgress: { current: number; total: number; category: string } | null = null;

  // Remote server config state
  let isRemoteConfigured = false;
  let remoteServerUrl: string | null = null;
  let lastRemoteSync: string | null = null;

  // Sync report dialog
  let showSyncReport = false;
  let syncReport: {
    success: boolean;
    profileFiles?: number;
    memoriesImported?: number;
    credentialsSynced?: boolean;
    error?: string;
    timestamp: string;
  } | null = null;

  const unsubState = syncState.subscribe(s => {
    state = s;
    syncing = s.isSyncing;
  });
  const unsubPending = hasPendingChanges.subscribe(p => pending = p);
  const unsubConflicts = hasConflicts.subscribe(c => conflicts = c);
  const unsubUpdate = updateState.subscribe(s => {
    appUpdate = s;
    if (s.updateAvailable) {
      updateDismissed = false;
    }
  });
  const unsubHasUpdate = isUpdateAvailable.subscribe(u => updateAvailable = u);

  onMount(async () => {
    isMobile = isMobileApp();
    await initMemorySync();
    await loadRemoteConfig();
  });

  async function loadRemoteConfig() {
    try {
      const config = await getRemoteSyncConfig();
      isRemoteConfigured = config.configured;
      remoteServerUrl = config.serverUrl || null;
      lastRemoteSync = config.lastSyncAt || null;
    } catch (err) {
      console.warn('[SyncStatus] Failed to load remote config:', err);
    }
  }

  onDestroy(() => {
    unsubState();
    unsubPending();
    unsubConflicts();
    unsubUpdate();
    unsubHasUpdate();
    stopBackgroundSync();
  });

  $: showUpdateNotice = isMobile && updateAvailable && !updateDismissed && !!appUpdate?.latestMobileVersion;

  function handleOpenSyncManager() {
    if (syncing) return;
    showSyncManager = true;
  }

  async function handleSync() {
    if (syncing) return;

    syncing = true;
    try {
      // Use REMOTE sync which writes to filesystem via local API
      console.log('[SyncStatus] Quick sync - calling syncFromRemoteServer...');
      const result = await syncFromRemoteServer(
        (progress) => {
          syncProgress = {
            current: progress.current || 0,
            total: progress.total || 1,
            category: progress.message
          };
        },
        {
          includeMemories: true,
          includeCredentials: true,
          priorityOnly: true,
        }
      );

      // ALWAYS show sync report - never silently fail
      syncReport = {
        success: result.success,
        profileFiles: result.profileFiles,
        memoriesImported: result.memoriesImported,
        credentialsSynced: result.credentialsSynced,
        error: result.error,
        timestamp: new Date().toISOString(),
      };
      showSyncReport = true;

      if (!result.success) {
        console.error('[SyncStatus] Quick sync failed:', result.error);
      } else {
        console.log('[SyncStatus] Quick sync complete:', result);
      }

      // On mobile, also check for app updates
      if (isMobile) {
        try {
          await checkForUpdates();
        } catch (e) {
          console.warn('[SyncStatus] Update check failed:', e);
        }
      }
    } catch (e) {
      // Catch any unexpected errors and show report
      syncReport = {
        success: false,
        error: (e as Error).message,
        timestamp: new Date().toISOString(),
      };
      showSyncReport = true;
      console.error('[SyncStatus] Sync error:', e);
    } finally {
      syncing = false;
      syncProgress = null;
    }
  }

  async function handleSyncWithOptions(event: CustomEvent<{ options: string[] }>) {
    if (syncing) return;

    const { options } = event.detail;
    console.log('[SyncStatus] Starting sync with options:', options);

    // Set syncing state
    syncing = true;
    syncProgress = null;

    try {
      // Use REMOTE sync which writes to filesystem via local API
      // This is the unified approach - same code for web and mobile
      const includeMemories = options.includes('memories');
      const includeCredentials = options.includes('config');

      console.log('[SyncStatus] Calling syncFromRemoteServer...');

      const result = await syncFromRemoteServer(
        (progress) => {
          syncProgress = {
            current: progress.current || 0,
            total: progress.total || 1,
            category: progress.message
          };
        },
        {
          includeMemories,
          includeCredentials,
          priorityOnly: true, // Use priority export to avoid OOM
        }
      );

      // ALWAYS show sync report - never silently fail
      syncReport = {
        success: result.success,
        profileFiles: result.profileFiles,
        memoriesImported: result.memoriesImported,
        credentialsSynced: result.credentialsSynced,
        error: result.error,
        timestamp: new Date().toISOString(),
      };
      showSyncReport = true;

      if (result.success) {
        console.log('[SyncStatus] Sync complete:', result);
      } else {
        console.error('[SyncStatus] Sync failed:', result.error);
      }

      // Check for app updates if requested
      if (options.includes('update') && isMobile) {
        try {
          await checkForUpdates();
        } catch (e) {
          console.warn('[SyncStatus] Update check failed:', e);
        }
      }

    } catch (e) {
      // Catch any unexpected errors and show report
      syncReport = {
        success: false,
        error: (e as Error).message,
        timestamp: new Date().toISOString(),
      };
      showSyncReport = true;
      console.error('[SyncStatus] Sync error:', e);
    } finally {
      syncing = false;
      syncProgress = null;
      showSyncManager = false;
    }
  }

  async function handleCloseSyncManager() {
    if (!syncing) {
      showSyncManager = false;
      // Reload remote config in case it was changed
      await loadRemoteConfig();
    }
  }

  async function handleDownloadUpdate() {
    await downloadAndInstall();
    showUpdateModal = false;
  }

  function handleDismissUpdate() {
    updateDismissed = true;
    showUpdateModal = false;
  }

  async function handleShowConflicts() {
    conflictList = await getConflicts();
    showConflictModal = true;
  }

  async function handleResolve(memoryId: string, resolution: ConflictResolution['resolution']) {
    await resolveConflict({ memoryId, resolution });
    conflictList = await getConflicts();
    if (conflictList.length === 0) {
      showConflictModal = false;
    }
  }

  function getOverallStatus(): 'synced' | 'pending' | 'conflict' | 'offline' | 'syncing' {
    if (syncing) return 'syncing';
    if (conflicts) return 'conflict';
    if (pending) return 'pending';
    return 'synced';
  }

  function getStatusColor(): string {
    const status = getOverallStatus();
    switch (status) {
      case 'synced': return '#22c55e';
      case 'pending': return '#f59e0b';
      case 'conflict': return '#ef4444';
      case 'syncing': return '#3b82f6';
      case 'offline': return '#6b7280';
    }
  }

  function getStatusLabel(): string {
    const status = getOverallStatus();
    switch (status) {
      case 'synced': return 'Synced';
      case 'pending': return `${state.pendingCount} pending`;
      case 'conflict': return `${state.conflictCount} conflict${state.conflictCount > 1 ? 's' : ''}`;
      case 'syncing': return 'Syncing...';
      case 'offline': return 'Offline';
    }
  }

  function formatTimestamp(ts: string | null): string {
    if (!ts) return 'Never';
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  }
</script>

{#if compact}
  <!-- Compact: just icon and count -->
  <button
    class="inline-flex items-center gap-1 px-2 py-1 border-none bg-transparent cursor-pointer text-base relative disabled:cursor-wait"
    on:click={handleOpenSyncManager}
    disabled={syncing}
    title={`Sync: ${getStatusLabel()}${showUpdateNotice ? ' - Update available!' : ''}`}
  >
    <span class="text-base {syncing ? 'animate-spin' : ''}" style="color: {getStatusColor()}">
      {#if syncing}
        ↻
      {:else if conflicts}
        ⚠
      {:else if pending}
        ↻
      {:else}
        ✓
      {/if}
    </span>
    {#if state.pendingCount > 0 || state.conflictCount > 0}
      <span class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-red-500 text-white text-[0.625rem] font-semibold rounded-full flex items-center justify-center">{state.pendingCount + state.conflictCount}</span>
    {:else if showUpdateNotice}
      <span class="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 bg-green-500 text-[0.5rem] rounded-full flex items-center justify-center">⬆️</span>
    {/if}
  </button>
{:else}
  <!-- Full: detailed sync status -->
  <div class="p-4 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg">
    <div class="flex justify-between items-center mb-3">
      <h4 class="m-0 text-sm font-semibold text-gray-700 dark:text-gray-200">Sync Status</h4>
      <button
        class="px-2 py-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md text-xs cursor-pointer flex items-center gap-1 text-gray-900 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-wait"
        on:click={handleOpenSyncManager}
        disabled={syncing}
      >
        {#if syncing}
          <span class="inline-block animate-spin">↻</span> Syncing...
        {:else}
          ↻ Sync Now
        {/if}
      </button>
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full" style="background-color: {getStatusColor()}"></span>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{getStatusLabel()}</span>
      </div>

      <div class="flex justify-between text-xs">
        <span class="text-gray-500">Last sync:</span>
        <span class="text-gray-700 dark:text-gray-300">{formatTimestamp(state.lastSyncTimestamp)}</span>
      </div>

      <!-- Remote Server Status -->
      {#if isRemoteConfigured && remoteServerUrl}
        <div class="flex justify-between text-xs">
          <span class="text-gray-500">Remote:</span>
          <span class="flex items-center gap-1 font-mono text-green-500 dark:text-green-400">
            <span class="text-xs">🔗</span>
            {new URL(remoteServerUrl).hostname}
          </span>
        </div>
        {#if lastRemoteSync}
          <div class="flex justify-between text-xs">
            <span class="text-gray-500">Remote sync:</span>
            <span class="text-gray-700 dark:text-gray-300">{formatTimestamp(lastRemoteSync)}</span>
          </div>
        {/if}
      {:else if isMobile}
        <div class="flex justify-between text-xs">
          <span class="text-gray-500">Remote:</span>
          <span class="text-gray-400">
            <button class="bg-transparent border-none text-blue-500 cursor-pointer underline text-xs p-0" on:click={handleOpenSyncManager}>
              Configure server
            </button>
          </span>
        </div>
      {/if}

      {#if state.pendingCount > 0}
        <div class="flex justify-between text-xs">
          <span class="text-gray-500">Pending:</span>
          <span class="text-amber-500">{state.pendingCount} change{state.pendingCount > 1 ? 's' : ''}</span>
        </div>
      {/if}

      {#if state.conflictCount > 0}
        <div class="flex justify-between text-xs">
          <span class="text-gray-500">Conflicts:</span>
          <span class="text-red-500">
            {state.conflictCount}
            <button class="bg-transparent border-none text-blue-500 cursor-pointer underline text-xs p-0 ml-2" on:click={handleShowConflicts}>Resolve</button>
          </span>
        </div>
      {/if}

      {#if state.lastSyncError}
        <div class="text-xs text-red-500 p-2 bg-red-50 dark:bg-red-900/50 rounded">{state.lastSyncError}</div>
      {/if}

      <!-- App Update Available (mobile only) -->
      {#if isMobile && showUpdateNotice && appUpdate?.latestMobileVersion}
        <div class="mt-3 p-3 bg-gradient-to-br from-green-500/10 to-emerald-500/10 dark:from-green-500/15 dark:to-emerald-500/15 border border-green-500/30 rounded-lg">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-base">⬆️</span>
            <span class="text-sm font-semibold text-green-600 dark:text-green-400">Update Available</span>
          </div>
          <div class="text-xs text-gray-500 mb-2">
            <span class="font-mono">v{appUpdate.currentVersion} → v{appUpdate.latestMobileVersion.version}</span>
            {#if appUpdate.latestMobileVersion.fileSize}
              <span class="ml-2 text-gray-400">({formatFileSize(appUpdate.latestMobileVersion.fileSize)})</span>
            {/if}
          </div>
          <div class="flex gap-2">
            <button class="flex-1 py-1.5 px-2 bg-green-500 text-white border-none rounded text-xs cursor-pointer font-medium hover:bg-green-600" on:click={() => showUpdateModal = true}>
              View Details
            </button>
            <button class="py-1.5 px-2 bg-transparent text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded text-xs cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" on:click={handleDismissUpdate}>
              Later
            </button>
          </div>
        </div>
      {/if}

      <!-- App Version (mobile only, when no update) -->
      {#if isMobile && !showUpdateNotice && appUpdate?.currentVersion}
        <div class="flex justify-between text-xs">
          <span class="text-gray-500">App version:</span>
          <span class="text-gray-700 dark:text-gray-300">{appUpdate.currentVersion}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Conflict Resolution Modal -->
{#if showConflictModal}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" on:click={() => showConflictModal = false}>
    <div class="bg-white dark:bg-gray-800 rounded-lg w-[90%] max-w-[500px] max-h-[80vh] overflow-hidden flex flex-col" on:click|stopPropagation>
      <div class="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 class="m-0 text-base text-gray-900 dark:text-gray-50">Resolve Conflicts</h3>
        <button class="bg-transparent border-none text-2xl text-gray-500 cursor-pointer leading-none" on:click={() => showConflictModal = false}>×</button>
      </div>

      <div class="p-4 overflow-y-auto">
        {#each conflictList as memory}
          <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-md mb-3">
            <div class="flex gap-2 mb-2">
              <span class="text-xs px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300">{memory.type}</span>
              <span class="text-xs text-gray-500 font-mono">{memory.id.slice(0, 8)}...</span>
            </div>
            <div class="text-xs text-gray-500 mb-3 leading-relaxed">
              {memory.content.slice(0, 100)}...
            </div>
            <div class="flex gap-2">
              <button
                class="flex-1 py-1.5 px-2 bg-amber-500 text-white border-none rounded text-xs cursor-pointer hover:bg-amber-600"
                on:click={() => handleResolve(memory.id, 'keep-local')}
              >
                Keep Local
              </button>
              <button
                class="flex-1 py-1.5 px-2 bg-blue-500 text-white border-none rounded text-xs cursor-pointer hover:bg-blue-600"
                on:click={() => handleResolve(memory.id, 'keep-server')}
              >
                Keep Server
              </button>
            </div>
          </div>
        {:else}
          <p class="text-center text-gray-500 py-8">No conflicts to resolve</p>
        {/each}
      </div>
    </div>
  </div>
{/if}

<!-- App Update Modal -->
{#if showUpdateModal && appUpdate?.latestMobileVersion}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" on:click={() => showUpdateModal = false}>
    <div class="bg-white dark:bg-gray-800 rounded-lg w-[90%] max-w-[400px] max-h-[80vh] overflow-hidden flex flex-col" on:click|stopPropagation>
      <div class="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 class="m-0 text-base text-gray-900 dark:text-gray-50">App Update Available</h3>
        <button class="bg-transparent border-none text-2xl text-gray-500 cursor-pointer leading-none" on:click={() => showUpdateModal = false}>×</button>
      </div>

      <div class="p-6">
        <div class="flex items-center justify-center gap-4 mb-6">
          <div class="text-center p-3 rounded-lg bg-gray-500/10 border border-gray-500/20">
            <span class="block text-[0.625rem] uppercase text-gray-500 mb-1">Current</span>
            <span class="text-base font-semibold font-mono text-gray-700 dark:text-gray-200">v{appUpdate.currentVersion}</span>
          </div>
          <span class="text-xl text-gray-400">→</span>
          <div class="text-center p-3 rounded-lg bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/30">
            <span class="block text-[0.625rem] uppercase text-gray-500 mb-1">New</span>
            <span class="text-base font-semibold font-mono text-green-600 dark:text-green-400">v{appUpdate.latestMobileVersion.version}</span>
          </div>
        </div>

        {#if appUpdate.latestMobileVersion.releaseNotes && appUpdate.latestMobileVersion.releaseNotes !== 'No release notes provided.'}
          <div class="mb-4 p-3 bg-black/[0.02] dark:bg-white/[0.03] rounded-md">
            <h4 class="m-0 mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">What's New</h4>
            <p class="m-0 text-[0.8125rem] leading-relaxed text-gray-500">{appUpdate.latestMobileVersion.releaseNotes}</p>
          </div>
        {/if}

        <div class="flex flex-col gap-1 mb-4">
          {#if appUpdate.latestMobileVersion.fileSize}
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Download size:</span>
              <span class="text-gray-700 dark:text-gray-300">{formatFileSize(appUpdate.latestMobileVersion.fileSize)}</span>
            </div>
          {/if}
          {#if appUpdate.lastChecked}
            <div class="flex justify-between text-xs">
              <span class="text-gray-500">Checked:</span>
              <span class="text-gray-700 dark:text-gray-300">{formatTimestamp(appUpdate.lastChecked)}</span>
            </div>
          {/if}
        </div>

        <div class="flex flex-col gap-2 mb-4">
          <button class="w-full py-3 px-4 bg-gradient-to-br from-green-500 to-green-600 text-white border-none rounded-lg text-sm font-semibold cursor-pointer hover:from-green-600 hover:to-green-700" on:click={handleDownloadUpdate}>
            Download Update
          </button>
          <button class="w-full py-2 px-4 bg-transparent text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" on:click={handleDismissUpdate}>
            Remind Me Later
          </button>
        </div>

        <p class="m-0 text-[0.6875rem] text-gray-400 text-center leading-relaxed">
          The download will open in your browser. After downloading, open the APK to install.
        </p>
      </div>
    </div>
  </div>
{/if}

<!-- Sync Manager Modal -->
<SyncManager
  isOpen={showSyncManager}
  isSyncing={syncing}
  {syncProgress}
  on:sync={handleSyncWithOptions}
  on:close={handleCloseSyncManager}
/>

<!-- Sync Report Modal - ALWAYS shows after sync to prevent silent failures -->
{#if showSyncReport && syncReport}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" on:click={() => showSyncReport = false}>
    <div class="bg-white dark:bg-gray-800 rounded-lg w-[90%] max-w-[400px] max-h-[80vh] overflow-hidden flex flex-col" on:click|stopPropagation>
      <div class="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 class="m-0 text-base text-gray-900 dark:text-gray-50">{syncReport.success ? '✅ Sync Complete' : '❌ Sync Failed'}</h3>
        <button class="bg-transparent border-none text-2xl text-gray-500 cursor-pointer leading-none" on:click={() => showSyncReport = false}>×</button>
      </div>

      <div class="py-4 px-4">
        {#if syncReport.success}
          <div class="bg-green-500/10 rounded-lg p-4 mb-4">
            {#if syncReport.profileFiles !== undefined}
              <div class="flex justify-between py-2 border-b border-green-500/20 last:border-b-0">
                <span class="text-gray-500 dark:text-gray-400">Profile files imported:</span>
                <span class="font-semibold text-green-500 dark:text-green-400">{syncReport.profileFiles}</span>
              </div>
            {/if}
            {#if syncReport.memoriesImported !== undefined}
              <div class="flex justify-between py-2 border-b border-green-500/20 last:border-b-0">
                <span class="text-gray-500 dark:text-gray-400">Memories synced:</span>
                <span class="font-semibold text-green-500 dark:text-green-400">{syncReport.memoriesImported}</span>
              </div>
            {/if}
            {#if syncReport.credentialsSynced}
              <div class="flex justify-between py-2">
                <span class="text-gray-500 dark:text-gray-400">Credentials:</span>
                <span class="font-semibold text-green-500 dark:text-green-400">✓ Synced</span>
              </div>
            {/if}
          </div>
          <p class="text-green-500 dark:text-green-400 text-sm text-center m-0">Your profile has been synced successfully from the remote server.</p>
        {:else}
          <div class="bg-red-500/10 rounded-lg p-4 mb-4">
            <p class="font-semibold text-red-500 dark:text-red-400 m-0 mb-2">Error:</p>
            <p class="text-red-500 dark:text-red-400 m-0 font-mono text-sm break-words">{syncReport.error || 'Unknown error occurred'}</p>
          </div>
          <p class="text-gray-500 text-sm text-center m-0">
            Please check your sync server settings and try again.
          </p>
        {/if}

        <div class="text-center text-xs text-gray-400 mt-4 pt-4 border-t border-gray-400/20">
          Completed: {new Date(syncReport.timestamp).toLocaleString()}
        </div>
      </div>

      <div class="flex justify-center pt-4 pb-4">
        <button class="btn-primary px-8" on:click={() => showSyncReport = false}>
          OK
        </button>
      </div>
    </div>
  </div>
{/if}

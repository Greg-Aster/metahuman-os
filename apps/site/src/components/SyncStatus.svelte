<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    initMemorySync,
    stopBackgroundSync,
    forceSync,
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
  import { isCapacitorNative } from '../lib/client/api-config';
  import {
    checkForUpdate,
    downloadUpdate,
    dismissUpdate,
    updateState,
    hasUpdate,
    formatFileSize,
    type UpdateState,
  } from '../lib/client/app-update';
  import { getSetting } from '../lib/client/local-memory';

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

  const unsubState = syncState.subscribe(s => {
    state = s;
    syncing = s.isSyncing;
  });
  const unsubPending = hasPendingChanges.subscribe(p => pending = p);
  const unsubConflicts = hasConflicts.subscribe(c => conflicts = c);
  const unsubUpdate = updateState.subscribe(s => appUpdate = s);
  const unsubHasUpdate = hasUpdate.subscribe(u => updateAvailable = u);

  onMount(async () => {
    isMobile = isCapacitorNative();
    await initMemorySync();
  });

  onDestroy(() => {
    unsubState();
    unsubPending();
    unsubConflicts();
    unsubUpdate();
    unsubHasUpdate();
    stopBackgroundSync();
  });

  async function handleSync() {
    if (syncing) return;

    // Start sync
    await forceSync();

    // On mobile, also check for app updates
    if (isMobile) {
      try {
        // Get server URL from settings or use default
        const serverUrl = await getSetting('syncServerUrl', 'https://mh.dndiy.org');
        await checkForUpdate(serverUrl);
      } catch (e) {
        console.warn('[SyncStatus] Update check failed:', e);
      }
    }
  }

  async function handleDownloadUpdate() {
    await downloadUpdate();
    showUpdateModal = false;
  }

  function handleDismissUpdate() {
    dismissUpdate();
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
    class="sync-compact"
    on:click={handleSync}
    disabled={syncing}
    title={`Sync: ${getStatusLabel()}${updateAvailable ? ' - Update available!' : ''}`}
  >
    <span class="sync-icon" class:spinning={syncing} style="color: {getStatusColor()}">
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
      <span class="sync-badge">{state.pendingCount + state.conflictCount}</span>
    {:else if updateAvailable}
      <span class="sync-badge update-badge">⬆️</span>
    {/if}
  </button>
{:else}
  <!-- Full: detailed sync status -->
  <div class="sync-status">
    <div class="sync-header">
      <h4>Sync Status</h4>
      <button class="sync-btn" on:click={handleSync} disabled={syncing}>
        {#if syncing}
          <span class="spinning">↻</span> Syncing...
        {:else}
          ↻ Sync Now
        {/if}
      </button>
    </div>

    <div class="sync-info">
      <div class="status-row">
        <span class="status-indicator" style="background-color: {getStatusColor()}"></span>
        <span class="status-label">{getStatusLabel()}</span>
      </div>

      <div class="info-row">
        <span class="info-label">Last sync:</span>
        <span class="info-value">{formatTimestamp(state.lastSyncTimestamp)}</span>
      </div>

      {#if state.pendingCount > 0}
        <div class="info-row warning">
          <span class="info-label">Pending:</span>
          <span class="info-value">{state.pendingCount} change{state.pendingCount > 1 ? 's' : ''}</span>
        </div>
      {/if}

      {#if state.conflictCount > 0}
        <div class="info-row error">
          <span class="info-label">Conflicts:</span>
          <span class="info-value">
            {state.conflictCount}
            <button class="link-btn" on:click={handleShowConflicts}>Resolve</button>
          </span>
        </div>
      {/if}

      {#if state.lastSyncError}
        <div class="error-message">{state.lastSyncError}</div>
      {/if}

      <!-- App Update Available (mobile only) -->
      {#if isMobile && updateAvailable && appUpdate}
        <div class="update-available">
          <div class="update-header">
            <span class="update-icon">⬆️</span>
            <span class="update-text">Update Available</span>
          </div>
          <div class="update-details">
            <span class="update-version">v{appUpdate.currentVersion} → v{appUpdate.latestVersion}</span>
            {#if appUpdate.fileSize}
              <span class="update-size">({formatFileSize(appUpdate.fileSize)})</span>
            {/if}
          </div>
          <div class="update-actions">
            <button class="btn-update" on:click={() => showUpdateModal = true}>
              View Details
            </button>
            <button class="btn-dismiss" on:click={handleDismissUpdate}>
              Later
            </button>
          </div>
        </div>
      {/if}

      <!-- App Version (mobile only, when no update) -->
      {#if isMobile && !updateAvailable && appUpdate?.currentVersion}
        <div class="info-row">
          <span class="info-label">App version:</span>
          <span class="info-value">{appUpdate.currentVersion}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Conflict Resolution Modal -->
{#if showConflictModal}
  <div class="modal-overlay" on:click={() => showConflictModal = false}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h3>Resolve Conflicts</h3>
        <button class="close-btn" on:click={() => showConflictModal = false}>×</button>
      </div>

      <div class="conflict-list">
        {#each conflictList as memory}
          <div class="conflict-item">
            <div class="conflict-info">
              <span class="conflict-type">{memory.type}</span>
              <span class="conflict-id">{memory.id.slice(0, 8)}...</span>
            </div>
            <div class="conflict-preview">
              {memory.content.slice(0, 100)}...
            </div>
            <div class="conflict-actions">
              <button
                class="btn-local"
                on:click={() => handleResolve(memory.id, 'keep-local')}
              >
                Keep Local
              </button>
              <button
                class="btn-server"
                on:click={() => handleResolve(memory.id, 'keep-server')}
              >
                Keep Server
              </button>
            </div>
          </div>
        {:else}
          <p class="no-conflicts">No conflicts to resolve</p>
        {/each}
      </div>
    </div>
  </div>
{/if}

<!-- App Update Modal -->
{#if showUpdateModal && appUpdate}
  <div class="modal-overlay" on:click={() => showUpdateModal = false}>
    <div class="modal-content update-modal" on:click|stopPropagation>
      <div class="modal-header">
        <h3>App Update Available</h3>
        <button class="close-btn" on:click={() => showUpdateModal = false}>×</button>
      </div>

      <div class="update-modal-body">
        <div class="version-info">
          <div class="version-badge current">
            <span class="version-label">Current</span>
            <span class="version-number">v{appUpdate.currentVersion}</span>
          </div>
          <span class="version-arrow">→</span>
          <div class="version-badge new">
            <span class="version-label">New</span>
            <span class="version-number">v{appUpdate.latestVersion}</span>
          </div>
        </div>

        {#if appUpdate.releaseNotes && appUpdate.releaseNotes !== 'No release notes provided.'}
          <div class="release-notes">
            <h4>What's New</h4>
            <p>{appUpdate.releaseNotes}</p>
          </div>
        {/if}

        <div class="update-meta">
          {#if appUpdate.fileSize}
            <div class="meta-item">
              <span class="meta-label">Download size:</span>
              <span class="meta-value">{formatFileSize(appUpdate.fileSize)}</span>
            </div>
          {/if}
          {#if appUpdate.lastChecked}
            <div class="meta-item">
              <span class="meta-label">Checked:</span>
              <span class="meta-value">{formatTimestamp(appUpdate.lastChecked)}</span>
            </div>
          {/if}
        </div>

        <div class="update-modal-actions">
          <button class="btn-download" on:click={handleDownloadUpdate}>
            Download Update
          </button>
          <button class="btn-later" on:click={handleDismissUpdate}>
            Remind Me Later
          </button>
        </div>

        <p class="update-note">
          The download will open in your browser. After downloading, open the APK to install.
        </p>
      </div>
    </div>
  </div>
{/if}

<style>
  .sync-compact {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 1rem;
    position: relative;
  }

  .sync-compact:disabled {
    cursor: wait;
  }

  .sync-icon {
    font-size: 1rem;
  }

  .sync-icon.spinning {
    animation: spin 1s linear infinite;
  }

  .sync-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: #ef4444;
    color: white;
    font-size: 0.625rem;
    font-weight: 600;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sync-badge.update-badge {
    background: #22c55e;
    font-size: 0.5rem;
    min-width: 14px;
    height: 14px;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .sync-status {
    padding: 1rem;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 0.5rem;
  }

  :global(.dark) .sync-status {
    background: rgba(255, 255, 255, 0.03);
  }

  .sync-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .sync-header h4 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .sync-header h4 {
    color: #e5e7eb;
  }

  .sync-btn {
    padding: 0.25rem 0.5rem;
    border: 1px solid #d1d5db;
    background: white;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  :global(.dark) .sync-btn {
    background: #374151;
    border-color: #4b5563;
    color: #e5e7eb;
  }

  .sync-btn:hover:not(:disabled) {
    background: #f3f4f6;
  }

  :global(.dark) .sync-btn:hover:not(:disabled) {
    background: #4b5563;
  }

  .sync-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .sync-btn .spinning {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  .sync-info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
  }

  :global(.dark) .status-label {
    color: #e5e7eb;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
  }

  .info-label {
    color: #6b7280;
  }

  .info-value {
    color: #374151;
  }

  :global(.dark) .info-value {
    color: #d1d5db;
  }

  .info-row.warning .info-value {
    color: #f59e0b;
  }

  .info-row.error .info-value {
    color: #ef4444;
  }

  .link-btn {
    background: none;
    border: none;
    color: #3b82f6;
    cursor: pointer;
    text-decoration: underline;
    font-size: 0.75rem;
    padding: 0;
    margin-left: 0.5rem;
  }

  .error-message {
    font-size: 0.75rem;
    color: #ef4444;
    padding: 0.5rem;
    background: #fef2f2;
    border-radius: 0.25rem;
  }

  :global(.dark) .error-message {
    background: #450a0a;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: white;
    border-radius: 0.5rem;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  :global(.dark) .modal-content {
    background: #1f2937;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid #e5e7eb;
  }

  :global(.dark) .modal-header {
    border-color: #374151;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1rem;
    color: #111827;
  }

  :global(.dark) .modal-header h3 {
    color: #f9fafb;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: #6b7280;
    cursor: pointer;
    line-height: 1;
  }

  .conflict-list {
    padding: 1rem;
    overflow-y: auto;
  }

  .conflict-item {
    padding: 0.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.375rem;
    margin-bottom: 0.75rem;
  }

  :global(.dark) .conflict-item {
    border-color: #374151;
  }

  .conflict-info {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .conflict-type {
    font-size: 0.75rem;
    padding: 0.125rem 0.375rem;
    background: #e5e7eb;
    border-radius: 0.25rem;
    color: #374151;
  }

  :global(.dark) .conflict-type {
    background: #374151;
    color: #d1d5db;
  }

  .conflict-id {
    font-size: 0.75rem;
    color: #6b7280;
    font-family: monospace;
  }

  .conflict-preview {
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.75rem;
    line-height: 1.4;
  }

  .conflict-actions {
    display: flex;
    gap: 0.5rem;
  }

  .conflict-actions button {
    flex: 1;
    padding: 0.375rem 0.5rem;
    border: none;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .btn-local {
    background: #f59e0b;
    color: white;
  }

  .btn-local:hover {
    background: #d97706;
  }

  .btn-server {
    background: #3b82f6;
    color: white;
  }

  .btn-server:hover {
    background: #2563eb;
  }

  .no-conflicts {
    text-align: center;
    color: #6b7280;
    padding: 2rem;
  }

  /* Update Available Notification */
  .update-available {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(16, 185, 129, 0.1) 100%);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 0.5rem;
  }

  :global(.dark) .update-available {
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(16, 185, 129, 0.15) 100%);
  }

  .update-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .update-icon {
    font-size: 1rem;
  }

  .update-text {
    font-size: 0.875rem;
    font-weight: 600;
    color: #16a34a;
  }

  :global(.dark) .update-text {
    color: #4ade80;
  }

  .update-details {
    font-size: 0.75rem;
    color: #6b7280;
    margin-bottom: 0.5rem;
  }

  .update-version {
    font-family: monospace;
  }

  .update-size {
    margin-left: 0.5rem;
    color: #9ca3af;
  }

  .update-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-update {
    flex: 1;
    padding: 0.375rem 0.5rem;
    background: #22c55e;
    color: white;
    border: none;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-update:hover {
    background: #16a34a;
  }

  .btn-dismiss {
    padding: 0.375rem 0.5rem;
    background: transparent;
    color: #6b7280;
    border: 1px solid #d1d5db;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    cursor: pointer;
  }

  :global(.dark) .btn-dismiss {
    border-color: #4b5563;
    color: #9ca3af;
  }

  .btn-dismiss:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .btn-dismiss:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  /* Update Modal */
  .update-modal {
    max-width: 400px;
  }

  .update-modal-body {
    padding: 1.5rem;
  }

  .version-info {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .version-badge {
    text-align: center;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
  }

  .version-badge.current {
    background: rgba(107, 114, 128, 0.1);
    border: 1px solid rgba(107, 114, 128, 0.2);
  }

  .version-badge.new {
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(16, 185, 129, 0.1) 100%);
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .version-label {
    display: block;
    font-size: 0.625rem;
    text-transform: uppercase;
    color: #6b7280;
    margin-bottom: 0.25rem;
  }

  .version-number {
    font-size: 1rem;
    font-weight: 600;
    font-family: monospace;
    color: #374151;
  }

  :global(.dark) .version-number {
    color: #e5e7eb;
  }

  .version-badge.new .version-number {
    color: #16a34a;
  }

  :global(.dark) .version-badge.new .version-number {
    color: #4ade80;
  }

  .version-arrow {
    font-size: 1.25rem;
    color: #9ca3af;
  }

  .release-notes {
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 0.375rem;
  }

  :global(.dark) .release-notes {
    background: rgba(255, 255, 255, 0.03);
  }

  .release-notes h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .release-notes h4 {
    color: #e5e7eb;
  }

  .release-notes p {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: #6b7280;
  }

  .update-meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 1rem;
  }

  .meta-item {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
  }

  .meta-label {
    color: #6b7280;
  }

  .meta-value {
    color: #374151;
  }

  :global(.dark) .meta-value {
    color: #d1d5db;
  }

  .update-modal-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .btn-download {
    width: 100%;
    padding: 0.75rem 1rem;
    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-download:hover {
    background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
  }

  .btn-later {
    width: 100%;
    padding: 0.5rem 1rem;
    background: transparent;
    color: #6b7280;
    border: 1px solid #d1d5db;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    cursor: pointer;
  }

  :global(.dark) .btn-later {
    border-color: #4b5563;
    color: #9ca3af;
  }

  .btn-later:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .btn-later:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .update-note {
    margin: 0;
    font-size: 0.6875rem;
    color: #9ca3af;
    text-align: center;
    line-height: 1.4;
  }
</style>

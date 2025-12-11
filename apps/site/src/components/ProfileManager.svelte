<script lang="ts">
  import { onMount } from 'svelte';
  import { healthStatus } from '../lib/client/server-health';
  import {
    getLocalProfiles,
    getActiveProfile,
    createLocalProfile,
    downloadProfile,
    uploadChanges,
    syncProfile,
    getSyncStatus,
    exportProfile,
    importProfile,
    deleteLocalProfile,
    type ProfileMetadata,
    type SyncStatus,
    type DownloadProgress,
  } from '../lib/client/profile-sync';

  let profiles: ProfileMetadata[] = [];
  let activeProfile: ProfileMetadata | null = null;
  let syncStatus: SyncStatus | null = null;
  let loading = true;
  let error = '';
  let success = '';

  // Download state
  let downloading = false;
  let downloadProgress: DownloadProgress | null = null;

  // Sync state
  let syncing = false;

  // Create profile state
  let showCreateModal = false;
  let newProfileName = '';
  let creating = false;

  // Export/Import state
  let exporting = false;
  let importing = false;

  $: serverConnected = $healthStatus.connected;

  onMount(async () => {
    await loadProfiles();
  });

  async function loadProfiles() {
    loading = true;
    error = '';
    try {
      profiles = await getLocalProfiles();
      activeProfile = await getActiveProfile();
      syncStatus = await getSyncStatus();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load profiles';
    } finally {
      loading = false;
    }
  }

  async function handleDownload() {
    if (!serverConnected) {
      error = 'Server not connected';
      return;
    }

    downloading = true;
    error = '';
    success = '';

    try {
      const profile = await downloadProfile((progress) => {
        downloadProgress = progress;
      });

      success = `Profile "${profile.name}" downloaded successfully!`;
      await loadProfiles();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Download failed';
    } finally {
      downloading = false;
      downloadProgress = null;
    }
  }

  async function handleSync() {
    if (!serverConnected) {
      error = 'Server not connected';
      return;
    }

    syncing = true;
    error = '';
    success = '';

    try {
      const result = await syncProfile();

      if (result.errors.length > 0) {
        error = result.errors.join(', ');
      } else {
        success = `Synced: ${result.uploaded} uploaded, ${result.downloaded} downloaded`;
      }

      await loadProfiles();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Sync failed';
    } finally {
      syncing = false;
    }
  }

  async function handleUpload() {
    if (!serverConnected) {
      error = 'Server not connected';
      return;
    }

    syncing = true;
    error = '';
    success = '';

    try {
      const result = await uploadChanges();

      if (result.errors.length > 0) {
        error = result.errors.join(', ');
      } else {
        success = `Uploaded ${result.uploaded} changes`;
      }

      await loadProfiles();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Upload failed';
    } finally {
      syncing = false;
    }
  }

  async function handleCreate() {
    if (!newProfileName.trim()) {
      error = 'Profile name is required';
      return;
    }

    creating = true;
    error = '';
    success = '';

    try {
      const profile = await createLocalProfile(newProfileName.trim());
      success = `Profile "${profile.name}" created!`;
      showCreateModal = false;
      newProfileName = '';
      await loadProfiles();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create profile';
    } finally {
      creating = false;
    }
  }

  async function handleExport() {
    if (!activeProfile) {
      error = 'No active profile to export';
      return;
    }

    exporting = true;
    error = '';

    try {
      const data = await exportProfile();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeProfile.name}-profile-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      success = 'Profile exported!';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Export failed';
    } finally {
      exporting = false;
    }
  }

  async function handleImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    importing = true;
    error = '';
    success = '';

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const profile = await importProfile(data);
      success = `Profile "${profile.name}" imported!`;
      await loadProfiles();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Import failed';
    } finally {
      importing = false;
      input.value = '';
    }
  }

  async function handleDelete(profile: ProfileMetadata) {
    if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteLocalProfile(profile.id);
      success = `Profile "${profile.name}" deleted`;
      await loadProfiles();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Delete failed';
    }
  }

  function formatDate(iso: string): string {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<div class="profile-manager">
  <h2>Profile Management</h2>
  <p class="description">
    Manage your profile data locally. Download from server, create new profiles, or sync changes.
  </p>

  {#if error}
    <div class="message error">{error}</div>
  {/if}

  {#if success}
    <div class="message success">{success}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading profiles...</div>
  {:else}
    <!-- Active Profile -->
    <div class="section">
      <h3>Current Profile</h3>
      {#if activeProfile}
        <div class="profile-card active">
          <div class="profile-info">
            <span class="profile-name">{activeProfile.name}</span>
            <span class="profile-source">{activeProfile.source}</span>
          </div>
          <div class="profile-meta">
            <span>{activeProfile.memoryCount} memories</span>
            <span>Updated: {formatDate(activeProfile.updatedAt)}</span>
          </div>
          {#if activeProfile.serverUrl}
            <div class="profile-server">
              Server: {activeProfile.serverUrl}
            </div>
          {/if}
        </div>
      {:else}
        <div class="no-profile">
          <p>No profile loaded. Download from server or create a new one.</p>
        </div>
      {/if}
    </div>

    <!-- Sync Status -->
    {#if syncStatus}
      <div class="section">
        <h3>Sync Status</h3>
        <div class="sync-status">
          <div class="sync-item">
            <span class="sync-label">Last Sync:</span>
            <span class="sync-value">{formatDate(syncStatus.lastSync || '')}</span>
          </div>
          <div class="sync-item">
            <span class="sync-label">Pending Upload:</span>
            <span class="sync-value" class:has-pending={syncStatus.pendingUpload > 0}>
              {syncStatus.pendingUpload}
            </span>
          </div>
        </div>
      </div>
    {/if}

    <!-- Actions -->
    <div class="section">
      <h3>Actions</h3>
      <div class="actions">
        <!-- Download from Server -->
        <button
          class="action-btn primary"
          on:click={handleDownload}
          disabled={downloading || !serverConnected}
        >
          {#if downloading}
            <span class="spinner"></span>
            {#if downloadProgress}
              {downloadProgress.message}
            {:else}
              Downloading...
            {/if}
          {:else}
            <span class="icon">⬇️</span>
            Download from Server
          {/if}
        </button>

        <!-- Sync -->
        <button
          class="action-btn"
          on:click={handleSync}
          disabled={syncing || !serverConnected || !activeProfile}
        >
          {#if syncing}
            <span class="spinner"></span>
            Syncing...
          {:else}
            <span class="icon">🔄</span>
            Sync Changes
          {/if}
        </button>

        <!-- Upload Only -->
        <button
          class="action-btn"
          on:click={handleUpload}
          disabled={syncing || !serverConnected || !syncStatus || syncStatus.pendingUpload === 0}
        >
          <span class="icon">⬆️</span>
          Upload Local Changes
        </button>

        <!-- Create New -->
        <button
          class="action-btn secondary"
          on:click={() => showCreateModal = true}
        >
          <span class="icon">➕</span>
          Create New Profile
        </button>

        <!-- Export -->
        <button
          class="action-btn"
          on:click={handleExport}
          disabled={exporting || !activeProfile}
        >
          <span class="icon">📤</span>
          Export Profile
        </button>

        <!-- Import -->
        <label class="action-btn">
          <span class="icon">📥</span>
          Import Profile
          <input
            type="file"
            accept=".json"
            on:change={handleImport}
            disabled={importing}
            style="display: none;"
          />
        </label>
      </div>

      {#if !serverConnected}
        <p class="hint warning">
          ⚠️ Server not connected. Some actions require server connection.
        </p>
      {/if}
    </div>

    <!-- Download Progress -->
    {#if downloadProgress}
      <div class="section">
        <h3>Download Progress</h3>
        <div class="progress-container">
          <div class="progress-bar">
            <div
              class="progress-fill"
              style="width: {(downloadProgress.current / downloadProgress.total) * 100}%"
            ></div>
          </div>
          <div class="progress-text">
            {downloadProgress.message}
            ({downloadProgress.current} / {downloadProgress.total})
          </div>
        </div>
      </div>
    {/if}

    <!-- All Profiles -->
    {#if profiles.length > 1}
      <div class="section">
        <h3>All Profiles</h3>
        <div class="profiles-list">
          {#each profiles as profile}
            <div class="profile-card" class:active={profile.id === activeProfile?.id}>
              <div class="profile-info">
                <span class="profile-name">{profile.name}</span>
                <span class="profile-source">{profile.source}</span>
              </div>
              <div class="profile-actions">
                {#if profile.id !== activeProfile?.id}
                  <button
                    class="small-btn danger"
                    on:click={() => handleDelete(profile)}
                  >
                    Delete
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}

  <!-- Create Profile Modal -->
  {#if showCreateModal}
    <div class="modal-overlay" on:click={() => showCreateModal = false}>
      <div class="modal" on:click|stopPropagation>
        <h3>Create New Profile</h3>
        <p>Create a local profile that works completely offline.</p>

        <div class="form-group">
          <label for="profile-name">Profile Name</label>
          <input
            id="profile-name"
            type="text"
            bind:value={newProfileName}
            placeholder="Enter name..."
            disabled={creating}
          />
        </div>

        <div class="modal-actions">
          <button
            class="action-btn secondary"
            on:click={() => showCreateModal = false}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            class="action-btn primary"
            on:click={handleCreate}
            disabled={creating || !newProfileName.trim()}
          >
            {creating ? 'Creating...' : 'Create Profile'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .profile-manager {
    padding: 1rem;
  }

  h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.25rem;
    color: #1f2937;
  }

  :global(.dark) h2 {
    color: #f3f4f6;
  }

  h3 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    color: #374151;
  }

  :global(.dark) h3 {
    color: #d1d5db;
  }

  .description {
    color: #6b7280;
    font-size: 0.875rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .description {
    color: #9ca3af;
  }

  .section {
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: #f9fafb;
    border-radius: 0.5rem;
    border: 1px solid #e5e7eb;
  }

  :global(.dark) .section {
    background: #1f2937;
    border-color: #374151;
  }

  .message {
    padding: 0.75rem;
    border-radius: 0.375rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .message.error {
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
  }

  :global(.dark) .message.error {
    background: rgba(220, 38, 38, 0.1);
    border-color: rgba(220, 38, 38, 0.3);
  }

  .message.success {
    background: #f0fdf4;
    color: #16a34a;
    border: 1px solid #bbf7d0;
  }

  :global(.dark) .message.success {
    background: rgba(22, 163, 74, 0.1);
    border-color: rgba(22, 163, 74, 0.3);
  }

  .profile-card {
    padding: 1rem;
    background: white;
    border-radius: 0.5rem;
    border: 1px solid #e5e7eb;
  }

  :global(.dark) .profile-card {
    background: #111827;
    border-color: #374151;
  }

  .profile-card.active {
    border-color: #7c3aed;
    border-width: 2px;
  }

  .profile-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .profile-name {
    font-weight: 600;
    color: #1f2937;
  }

  :global(.dark) .profile-name {
    color: #f3f4f6;
  }

  .profile-source {
    font-size: 0.75rem;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: #e5e7eb;
    color: #4b5563;
  }

  :global(.dark) .profile-source {
    background: #374151;
    color: #9ca3af;
  }

  .profile-meta {
    display: flex;
    gap: 1rem;
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .profile-meta {
    color: #9ca3af;
  }

  .profile-server {
    font-size: 0.75rem;
    color: #6b7280;
    margin-top: 0.5rem;
  }

  .no-profile {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
  }

  .sync-status {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .sync-item {
    display: flex;
    justify-content: space-between;
  }

  .sync-label {
    color: #6b7280;
    font-size: 0.875rem;
  }

  .sync-value {
    font-weight: 500;
    color: #1f2937;
  }

  :global(.dark) .sync-value {
    color: #f3f4f6;
  }

  .sync-value.has-pending {
    color: #f59e0b;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border: 1px solid #d1d5db;
    border-radius: 0.5rem;
    background: white;
    color: #374151;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .action-btn {
    background: #1f2937;
    border-color: #374151;
    color: #d1d5db;
  }

  .action-btn:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }

  :global(.dark) .action-btn:hover:not(:disabled) {
    background: #374151;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.primary {
    background: #7c3aed;
    border-color: #7c3aed;
    color: white;
  }

  .action-btn.primary:hover:not(:disabled) {
    background: #6d28d9;
  }

  .action-btn.secondary {
    background: #f3f4f6;
    border-color: #d1d5db;
  }

  :global(.dark) .action-btn.secondary {
    background: #374151;
    border-color: #4b5563;
  }

  .icon {
    font-size: 1rem;
  }

  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .hint {
    font-size: 0.75rem;
    color: #6b7280;
    margin-top: 0.75rem;
  }

  .hint.warning {
    color: #f59e0b;
  }

  .progress-container {
    margin-top: 0.5rem;
  }

  .progress-bar {
    height: 0.5rem;
    background: #e5e7eb;
    border-radius: 9999px;
    overflow: hidden;
  }

  :global(.dark) .progress-bar {
    background: #374151;
  }

  .progress-fill {
    height: 100%;
    background: #7c3aed;
    transition: width 0.3s;
  }

  .progress-text {
    font-size: 0.75rem;
    color: #6b7280;
    margin-top: 0.25rem;
    text-align: center;
  }

  .profiles-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .profile-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }

  .small-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
  }

  .small-btn.danger {
    background: #fee2e2;
    color: #dc2626;
  }

  .small-btn.danger:hover {
    background: #fecaca;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
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

  .modal {
    background: white;
    border-radius: 0.75rem;
    padding: 1.5rem;
    width: 90%;
    max-width: 400px;
  }

  :global(.dark) .modal {
    background: #1f2937;
  }

  .form-group {
    margin: 1rem 0;
  }

  .form-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
    color: #374151;
  }

  :global(.dark) .form-group label {
    color: #d1d5db;
  }

  .form-group input {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
  }

  :global(.dark) .form-group input {
    background: #111827;
    border-color: #374151;
    color: #f3f4f6;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }
</style>

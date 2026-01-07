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

<div class="p-4">
  <h2 class="m-0 mb-2 text-xl text-gray-800 dark:text-gray-100">Profile Management</h2>
  <p class="text-gray-500 dark:text-gray-400 text-sm mb-6">
    Manage your profile data locally. Download from server, create new profiles, or sync changes.
  </p>

  {#if error}
    <div class="p-3 rounded-md mb-4 text-sm bg-red-50 dark:bg-red-500/10 text-red-600 border border-red-200 dark:border-red-500/30">{error}</div>
  {/if}

  {#if success}
    <div class="p-3 rounded-md mb-4 text-sm bg-green-50 dark:bg-green-500/10 text-green-600 border border-green-200 dark:border-green-500/30">{success}</div>
  {/if}

  {#if loading}
    <div class="text-center p-8 text-gray-500">Loading profiles...</div>
  {:else}
    <!-- Active Profile -->
    <div class="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <h3 class="m-0 mb-3 text-base text-gray-700 dark:text-gray-300">Current Profile</h3>
      {#if activeProfile}
        <div class="p-4 bg-white dark:bg-gray-900 rounded-lg border-2 border-violet-600">
          <div class="flex items-center gap-2 mb-2">
            <span class="font-semibold text-gray-800 dark:text-gray-100">{activeProfile.name}</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{activeProfile.source}</span>
          </div>
          <div class="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span>{activeProfile.memoryCount} memories</span>
            <span>Updated: {formatDate(activeProfile.updatedAt)}</span>
          </div>
          {#if activeProfile.serverUrl}
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Server: {activeProfile.serverUrl}
            </div>
          {/if}
        </div>
      {:else}
        <div class="text-center p-8 text-gray-500">
          <p>No profile loaded. Download from server or create a new one.</p>
        </div>
      {/if}
    </div>

    <!-- Sync Status -->
    {#if syncStatus}
      <div class="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <h3 class="m-0 mb-3 text-base text-gray-700 dark:text-gray-300">Sync Status</h3>
        <div class="flex flex-col gap-2">
          <div class="flex justify-between">
            <span class="text-gray-500 text-sm">Last Sync:</span>
            <span class="font-medium text-gray-800 dark:text-gray-100">{formatDate(syncStatus.lastSync || '')}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500 text-sm">Pending Upload:</span>
            <span class="font-medium {syncStatus.pendingUpload > 0 ? 'text-amber-500' : 'text-gray-800 dark:text-gray-100'}">
              {syncStatus.pendingUpload}
            </span>
          </div>
        </div>
      </div>
    {/if}

    <!-- Actions -->
    <div class="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <h3 class="m-0 mb-3 text-base text-gray-700 dark:text-gray-300">Actions</h3>
      <div class="flex flex-col gap-3">
        <!-- Download from Server -->
        <button
          class="flex items-center justify-center gap-2 px-4 py-3 border rounded-lg text-sm font-medium cursor-pointer transition-all bg-violet-600 border-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={handleDownload}
          disabled={downloading || !serverConnected}
        >
          {#if downloading}
            <span class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
            {#if downloadProgress}
              {downloadProgress.message}
            {:else}
              Downloading...
            {/if}
          {:else}
            <span>⬇️</span>
            Download from Server
          {/if}
        </button>

        <!-- Sync -->
        <button
          class="flex items-center justify-center gap-2 px-4 py-3 border rounded-lg text-sm font-medium cursor-pointer transition-all bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={handleSync}
          disabled={syncing || !serverConnected || !activeProfile}
        >
          {#if syncing}
            <span class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
            Syncing...
          {:else}
            <span>🔄</span>
            Sync Changes
          {/if}
        </button>

        <!-- Upload Only -->
        <button
          class="flex items-center justify-center gap-2 px-4 py-3 border rounded-lg text-sm font-medium cursor-pointer transition-all bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={handleUpload}
          disabled={syncing || !serverConnected || !syncStatus || syncStatus.pendingUpload === 0}
        >
          <span>⬆️</span>
          Upload Local Changes
        </button>

        <!-- Create New -->
        <button
          class="flex items-center justify-center gap-2 px-4 py-3 border rounded-lg text-sm font-medium cursor-pointer transition-all bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          on:click={() => showCreateModal = true}
        >
          <span>➕</span>
          Create New Profile
        </button>

        <!-- Export -->
        <button
          class="flex items-center justify-center gap-2 px-4 py-3 border rounded-lg text-sm font-medium cursor-pointer transition-all bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={handleExport}
          disabled={exporting || !activeProfile}
        >
          <span>📤</span>
          Export Profile
        </button>

        <!-- Import -->
        <label class="flex items-center justify-center gap-2 px-4 py-3 border rounded-lg text-sm font-medium cursor-pointer transition-all bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
          <span>📥</span>
          Import Profile
          <input
            type="file"
            accept=".json"
            on:change={handleImport}
            disabled={importing}
            class="hidden"
          />
        </label>
      </div>

      {#if !serverConnected}
        <p class="text-xs text-amber-500 mt-3">
          ⚠️ Server not connected. Some actions require server connection.
        </p>
      {/if}
    </div>

    <!-- Download Progress -->
    {#if downloadProgress}
      <div class="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <h3 class="m-0 mb-3 text-base text-gray-700 dark:text-gray-300">Download Progress</h3>
        <div class="mt-2">
          <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              class="h-full bg-violet-600 transition-all duration-300"
              style="width: {(downloadProgress.current / downloadProgress.total) * 100}%"
            ></div>
          </div>
          <div class="text-xs text-gray-500 mt-1 text-center">
            {downloadProgress.message}
            ({downloadProgress.current} / {downloadProgress.total})
          </div>
        </div>
      </div>
    {/if}

    <!-- All Profiles -->
    {#if profiles.length > 1}
      <div class="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <h3 class="m-0 mb-3 text-base text-gray-700 dark:text-gray-300">All Profiles</h3>
        <div class="flex flex-col gap-2">
          {#each profiles as profile}
            <div class="p-4 bg-white dark:bg-gray-900 rounded-lg border {profile.id === activeProfile?.id ? 'border-2 border-violet-600' : 'border-gray-200 dark:border-gray-700'}">
              <div class="flex items-center gap-2 mb-2">
                <span class="font-semibold text-gray-800 dark:text-gray-100">{profile.name}</span>
                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{profile.source}</span>
              </div>
              <div class="flex justify-end mt-2">
                {#if profile.id !== activeProfile?.id}
                  <button
                    class="px-2 py-1 text-xs border-none rounded bg-red-100 text-red-600 cursor-pointer hover:bg-red-200"
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
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" on:click={() => showCreateModal = false}>
      <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-[90%] max-w-[400px]" on:click|stopPropagation>
        <h3 class="m-0 mb-3 text-base text-gray-700 dark:text-gray-300">Create New Profile</h3>
        <p class="text-gray-500 dark:text-gray-400 text-sm">Create a local profile that works completely offline.</p>

        <div class="my-4">
          <label for="profile-name" class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Profile Name</label>
          <input
            id="profile-name"
            type="text"
            bind:value={newProfileName}
            placeholder="Enter name..."
            disabled={creating}
            class="w-full px-2.5 py-2.5 border border-gray-300 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
          />
        </div>

        <div class="flex gap-3 justify-end mt-6">
          <button
            class="flex items-center justify-center gap-2 px-4 py-3 border rounded-lg text-sm font-medium cursor-pointer transition-all bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            on:click={() => showCreateModal = false}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            class="flex items-center justify-center gap-2 px-4 py-3 border rounded-lg text-sm font-medium cursor-pointer transition-all bg-violet-600 border-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
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


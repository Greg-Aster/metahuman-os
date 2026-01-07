<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { isMobileApp } from '../lib/client/api-config';
  import {
    updateState,
    checkForUpdates,
    downloadAndInstall,
    formatFileSize,
    formatRelativeTime,
    initUpdateChecker,
    type UpdateState,
  } from '../lib/client/app-updater';

  let state: UpdateState = {
    checking: false,
    updating: false,
    updateProgress: 0,
    updateAvailable: false,
    error: null,
    lastChecked: null,
    platform: 'unknown',
    currentVersion: '0.0.0',
    currentVersionCode: 0,
    latestMobileVersion: null,
    serverUpdateInfo: null,
  };

  let isMobile = false;

  const unsubscribe = updateState.subscribe(s => {
    state = s;
  });

  onMount(async () => {
    isMobile = isMobileApp();
    if (isMobile) {
      await initUpdateChecker();
    }
  });

  onDestroy(() => {
    unsubscribe();
  });

  async function handleCheckForUpdates() {
    await checkForUpdates();
  }

  async function handleDownload() {
    try {
      await downloadAndInstall();
    } catch (e) {
      // Error already set in state
    }
  }

  function getStatusIcon(): string {
    if (state.checking) return '↻';
    if (state.updating) return '⬇';
    if (state.updateAvailable) return '🆕';
    return '✓';
  }

  function getStatusColor(): string {
    if (state.error) return '#ef4444';
    if (state.updateAvailable) return '#f59e0b';
    return '#22c55e';
  }
</script>

<div class="p-4">
  <div class="flex justify-between items-center mb-4">
    <h3 class="m-0 text-base font-semibold text-gray-700 dark:text-gray-200">App Updates</h3>
    <button
      class="px-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md text-xs cursor-pointer flex items-center gap-1 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-100 dark:hover:enabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
      on:click={handleCheckForUpdates}
      disabled={state.checking || state.updating}
    >
      {#if state.checking}
        <span class="inline-block animate-spin">↻</span> Checking...
      {:else}
        ↻ Check for Updates
      {/if}
    </button>
  </div>

  {#if !isMobile}
    <div class="p-4 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-500 rounded-lg">
      <p class="m-0 mb-2 text-blue-800 dark:text-blue-200 text-sm">App updates are only available in the mobile app.</p>
      <p class="m-0 text-blue-800 dark:text-blue-200 text-sm">Use the server's releases page to download the latest APK.</p>
    </div>
  {:else}
    <!-- Current Version -->
    <div class="mb-4">
      <div class="flex items-center gap-2 text-sm mb-1">
        <span class="text-gray-500">Installed Version:</span>
        <span class="font-medium text-gray-700 dark:text-gray-200">{state.currentVersion}</span>
        <span class="text-xs text-gray-400">(build {state.currentVersionCode})</span>
      </div>

      {#if state.lastChecked}
        <div class="flex items-center gap-2 text-sm mb-1">
          <span class="text-gray-500">Last Checked:</span>
          <span class="font-medium text-gray-700 dark:text-gray-200">{formatRelativeTime(state.lastChecked)}</span>
        </div>
      {/if}
    </div>

    <!-- Update Available -->
    {#if state.latestMobileVersion}
      <div class="p-4 rounded-lg mb-4 {state.updateAvailable ? 'bg-amber-100 dark:bg-amber-900 border border-amber-500 dark:border-amber-600' : 'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700'}">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-xl" style="color: {getStatusColor()}">{getStatusIcon()}</span>
          <span class="font-semibold text-gray-700 dark:text-gray-200 text-sm">
            {#if state.updateAvailable}
              Update Available
            {:else}
              Up to Date
            {/if}
          </span>
        </div>

        {#if state.updateAvailable}
          <div class="flex flex-col gap-2">
            <div class="flex gap-2 text-sm">
              <span class="text-gray-500">New Version:</span>
              <span class="font-medium text-gray-700 dark:text-gray-200">{state.latestMobileVersion.version}</span>
            </div>
            <div class="flex gap-2 text-sm">
              <span class="text-gray-500">Size:</span>
              <span class="font-medium text-gray-700 dark:text-gray-200">{formatFileSize(state.latestMobileVersion.fileSize)}</span>
            </div>
            <div class="flex gap-2 text-sm">
              <span class="text-gray-500">Released:</span>
              <span class="font-medium text-gray-700 dark:text-gray-200">{state.latestMobileVersion.releaseDate}</span>
            </div>

            {#if state.latestMobileVersion.releaseNotes}
              <div class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                <span class="block mb-1 font-medium text-gray-500 dark:text-gray-300">What's New:</span>
                <p class="m-0 text-xs text-gray-500 whitespace-pre-wrap">{state.latestMobileVersion.releaseNotes}</p>
              </div>
            {/if}

            <!-- Download Button / Progress -->
            <div class="mt-4">
              {#if state.updating}
                <div class="relative w-full h-8 bg-gray-200 dark:bg-gray-700 rounded-md overflow-hidden">
                  <div class="h-full bg-blue-500 transition-[width] duration-300" style="width: {state.updateProgress}%"></div>
                  <span class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-semibold text-gray-700 dark:text-gray-200">{state.updateProgress}%</span>
                </div>
                <p class="mt-2 mb-0 text-xs text-gray-500 text-center">Download will open installer when complete</p>
              {:else}
                <button
                  class="w-full py-3 border-none bg-blue-500 text-white rounded-md text-sm font-medium cursor-pointer flex items-center justify-center gap-2 hover:enabled:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  on:click={handleDownload}
                  disabled={state.updating}
                >
                  ⬇ Download & Install
                </button>
              {/if}
            </div>
          </div>
        {:else}
          <p class="m-0 text-sm text-green-600 dark:text-green-400">
            You're running the latest version of MetaHuman OS.
          </p>
        {/if}
      </div>
    {:else if !state.checking && !state.error}
      <div class="p-4 bg-gray-50 dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-center">
        <p class="m-0 text-gray-500 text-sm">Tap "Check for Updates" to see if a new version is available.</p>
      </div>
    {/if}

    <!-- Error Display -->
    {#if state.error}
      <div class="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-600 rounded-md mb-4">
        <span class="text-red-600">⚠</span>
        <span class="text-sm text-red-800 dark:text-red-200">{state.error}</span>
      </div>
    {/if}

    <!-- Help Text -->
    <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <p class="m-0 text-xs text-gray-400">Updates are downloaded from your connected server. Make sure you're connected to the correct server before updating.</p>
    </div>
  {/if}
</div>

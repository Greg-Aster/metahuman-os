<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    checkForUpdates,
    formatFileSize,
    formatRelativeTime,
    initUpdateChecker,
    performUpdate,
    restartServer,
    updateState,
    type UpdateState,
  } from '../lib/client/app-updater';

  let state: UpdateState = {
    checking: false,
    updating: false,
    updateProgress: 0,
    updateAvailable: false,
    restartRequired: false,
    error: null,
    lastChecked: null,
    platform: 'unknown',
    currentVersion: '0.0.0',
    currentVersionCode: 0,
    latestMobileVersion: null,
    serverUpdateInfo: null,
  };
  let restartError: string | null = null;
  let restarting = false;

  const unsubscribe = updateState.subscribe(next => {
    state = next;
  });

  onMount(async () => {
    try {
      await initUpdateChecker();
    } catch {
      // initUpdateChecker records the actionable error in the shared update state.
    }
  });

  onDestroy(unsubscribe);

  async function handleCheckForUpdates() {
    try {
      await checkForUpdates();
    } catch {
      // checkForUpdates records the actionable error in the shared update state.
    }
  }

  async function handleUpdate() {
    try {
      await performUpdate();
    } catch {
      // performUpdate records the actionable error in the shared update state.
    }
  }

  async function handleRestart() {
    restarting = true;
    restartError = null;
    try {
      await restartServer();
    } catch (error) {
      restarting = false;
      restartError = error instanceof Error ? error.message : 'Server restart failed';
    }
  }
</script>

<div class="p-4">
  <div class="flex justify-between items-center gap-3 mb-4">
    <h3 class="m-0 text-base font-semibold text-gray-700 dark:text-gray-200">
      {state.platform === 'mobile' ? 'App Updates' : 'Server Updates'}
    </h3>
    <button
      class="px-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md text-xs cursor-pointer text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-100 dark:hover:enabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
      on:click={handleCheckForUpdates}
      disabled={state.checking || state.updating || restarting}
    >
      {state.checking ? 'Checking…' : 'Check for Updates'}
    </button>
  </div>

  {#if state.error || restartError}
    <div class="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-600 rounded-md mb-4 text-sm text-red-800 dark:text-red-200">
      {state.error || restartError}
    </div>
  {/if}

  {#if state.lastChecked}
    <p class="mt-0 mb-3 text-xs text-gray-500">Last checked {formatRelativeTime(state.lastChecked)}</p>
  {/if}

  {#if state.platform === 'mobile'}
    <div class="mb-4 text-sm text-gray-600 dark:text-gray-300">
      Installed version {state.currentVersion} (build {state.currentVersionCode})
    </div>

    {#if state.latestMobileVersion}
      <div class="p-4 rounded-lg border {state.updateAvailable ? 'bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700' : 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700'}">
        <strong>{state.updateAvailable ? 'Update available' : 'App is up to date'}</strong>
        <p class="my-2 text-sm text-gray-600 dark:text-gray-300">
          Version {state.latestMobileVersion.version} · {formatFileSize(state.latestMobileVersion.fileSize)}
        </p>
        {#if state.latestMobileVersion.releaseNotes}
          <p class="my-2 text-xs text-gray-500 whitespace-pre-wrap">{state.latestMobileVersion.releaseNotes}</p>
        {/if}
        {#if state.updateAvailable}
          <button
            class="w-full mt-3 py-2.5 border-none bg-blue-500 text-white rounded-md text-sm font-medium cursor-pointer hover:enabled:bg-blue-600 disabled:opacity-50"
            on:click={handleUpdate}
            disabled={state.updating}
          >
            {state.updating ? `Opening download… ${state.updateProgress}%` : 'Download Signed APK'}
          </button>
        {/if}
      </div>
    {:else if !state.checking}
      <p class="text-sm text-gray-500">Check the connected server for a signed mobile release.</p>
    {/if}
  {:else if state.platform === 'server'}
    {#if state.serverUpdateInfo}
      <div class="p-4 rounded-lg border {state.updateAvailable ? 'bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700' : 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700'}">
        <strong>{state.updateAvailable ? `${state.serverUpdateInfo.commitsBehind} update commit${state.serverUpdateInfo.commitsBehind === 1 ? '' : 's'} available` : 'Server is up to date'}</strong>
        <p class="my-2 text-sm text-gray-600 dark:text-gray-300">Current {state.serverUpdateInfo.currentVersion}</p>
        {#if state.serverUpdateInfo.changesSummary.length > 0}
          <ul class="my-3 pl-5 text-xs text-gray-500">
            {#each state.serverUpdateInfo.changesSummary as change}
              <li>{change}</li>
            {/each}
          </ul>
        {/if}
        {#if state.serverUpdateInfo.reason && !state.serverUpdateInfo.canUpdate}
          <p class="my-2 text-sm text-amber-700 dark:text-amber-300">{state.serverUpdateInfo.reason}</p>
        {/if}
        {#if state.serverUpdateInfo.canUpdate}
          <button
            class="w-full mt-3 py-2.5 border-none bg-blue-500 text-white rounded-md text-sm font-medium cursor-pointer hover:enabled:bg-blue-600 disabled:opacity-50"
            on:click={handleUpdate}
            disabled={state.updating}
          >
            {state.updating ? `Validating update… ${state.updateProgress}%` : 'Install and Build Update'}
          </button>
        {/if}
      </div>
    {:else if !state.checking}
      <p class="text-sm text-gray-500">Check the configured Git upstream for a fast-forward server update.</p>
    {/if}

    {#if state.restartRequired}
      <div class="mt-4 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-300 dark:border-blue-700 rounded-lg">
        <p class="mt-0 mb-3 text-sm text-blue-800 dark:text-blue-200">The update passed its production build. Restart to activate it.</p>
        <button
          class="w-full py-2.5 border-none bg-blue-600 text-white rounded-md text-sm font-medium cursor-pointer disabled:opacity-50"
          on:click={handleRestart}
          disabled={restarting}
        >
          {restarting ? 'Restarting…' : 'Restart Server'}
        </button>
      </div>
    {/if}
  {/if}
</div>

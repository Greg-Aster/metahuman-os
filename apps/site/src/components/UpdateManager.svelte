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
  } from '../lib/client/app-updater';

  let state = {
    checking: false,
    downloading: false,
    downloadProgress: 0,
    currentVersion: '0.0.0',
    currentVersionCode: 0,
    latestVersion: null as any,
    updateAvailable: false,
    error: null as string | null,
    lastChecked: null as string | null,
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
    if (state.downloading) return '⬇';
    if (state.updateAvailable) return '🆕';
    return '✓';
  }

  function getStatusColor(): string {
    if (state.error) return '#ef4444';
    if (state.updateAvailable) return '#f59e0b';
    return '#22c55e';
  }
</script>

<div class="update-manager">
  <div class="section-header">
    <h3>App Updates</h3>
    <button
      class="check-btn"
      on:click={handleCheckForUpdates}
      disabled={state.checking || state.downloading}
    >
      {#if state.checking}
        <span class="spinner">↻</span> Checking...
      {:else}
        ↻ Check for Updates
      {/if}
    </button>
  </div>

  {#if !isMobile}
    <div class="info-box">
      <p>App updates are only available in the mobile app.</p>
      <p>Use the server's releases page to download the latest APK.</p>
    </div>
  {:else}
    <!-- Current Version -->
    <div class="version-info">
      <div class="version-row">
        <span class="label">Installed Version:</span>
        <span class="value">{state.currentVersion}</span>
        <span class="version-code">(build {state.currentVersionCode})</span>
      </div>

      {#if state.lastChecked}
        <div class="version-row">
          <span class="label">Last Checked:</span>
          <span class="value">{formatRelativeTime(state.lastChecked)}</span>
        </div>
      {/if}
    </div>

    <!-- Update Available -->
    {#if state.latestVersion}
      <div class="update-card" class:available={state.updateAvailable}>
        <div class="update-header">
          <span class="update-icon" style="color: {getStatusColor()}">{getStatusIcon()}</span>
          <span class="update-title">
            {#if state.updateAvailable}
              Update Available
            {:else}
              Up to Date
            {/if}
          </span>
        </div>

        {#if state.updateAvailable}
          <div class="update-details">
            <div class="detail-row">
              <span class="label">New Version:</span>
              <span class="value">{state.latestVersion.version}</span>
            </div>
            <div class="detail-row">
              <span class="label">Size:</span>
              <span class="value">{formatFileSize(state.latestVersion.fileSize)}</span>
            </div>
            <div class="detail-row">
              <span class="label">Released:</span>
              <span class="value">{state.latestVersion.releaseDate}</span>
            </div>

            {#if state.latestVersion.releaseNotes}
              <div class="release-notes">
                <span class="label">What's New:</span>
                <p>{state.latestVersion.releaseNotes}</p>
              </div>
            {/if}

            <!-- Download Button / Progress -->
            <div class="download-section">
              {#if state.downloading}
                <div class="download-progress">
                  <div class="progress-bar" style="width: {state.downloadProgress}%"></div>
                  <span class="progress-text">{state.downloadProgress}%</span>
                </div>
                <p class="download-hint">Download will open installer when complete</p>
              {:else}
                <button
                  class="download-btn"
                  on:click={handleDownload}
                  disabled={state.downloading}
                >
                  ⬇ Download & Install
                </button>
              {/if}
            </div>
          </div>
        {:else}
          <p class="up-to-date-msg">
            You're running the latest version of MetaHuman OS.
          </p>
        {/if}
      </div>
    {:else if !state.checking && !state.error}
      <div class="no-check">
        <p>Tap "Check for Updates" to see if a new version is available.</p>
      </div>
    {/if}

    <!-- Error Display -->
    {#if state.error}
      <div class="error-message">
        <span class="error-icon">⚠</span>
        <span>{state.error}</span>
      </div>
    {/if}

    <!-- Help Text -->
    <div class="help-text">
      <p>Updates are downloaded from your connected server. Make sure you're connected to the correct server before updating.</p>
    </div>
  {/if}
</div>

<style>
  .update-manager {
    padding: 1rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .section-header h3 {
    color: #e5e7eb;
  }

  .check-btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid #d1d5db;
    background: white;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  :global(.dark) .check-btn {
    background: #374151;
    border-color: #4b5563;
    color: #e5e7eb;
  }

  .check-btn:hover:not(:disabled) {
    background: #f3f4f6;
  }

  :global(.dark) .check-btn:hover:not(:disabled) {
    background: #4b5563;
  }

  .check-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .info-box {
    padding: 1rem;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 0.5rem;
  }

  :global(.dark) .info-box {
    background: #1e3a8a;
    border-color: #3b82f6;
  }

  .info-box p {
    margin: 0 0 0.5rem 0;
    color: #1e40af;
    font-size: 0.875rem;
  }

  :global(.dark) .info-box p {
    color: #bfdbfe;
  }

  .info-box p:last-child {
    margin-bottom: 0;
  }

  .version-info {
    margin-bottom: 1rem;
  }

  .version-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    margin-bottom: 0.25rem;
  }

  .label {
    color: #6b7280;
  }

  .value {
    font-weight: 500;
    color: #374151;
  }

  :global(.dark) .value {
    color: #e5e7eb;
  }

  .version-code {
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .update-card {
    padding: 1rem;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .update-card {
    background: #1f2937;
    border-color: #374151;
  }

  .update-card.available {
    background: #fef3c7;
    border-color: #f59e0b;
  }

  :global(.dark) .update-card.available {
    background: #78350f;
    border-color: #d97706;
  }

  .update-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .update-icon {
    font-size: 1.25rem;
  }

  .update-title {
    font-weight: 600;
    color: #374151;
    font-size: 0.875rem;
  }

  :global(.dark) .update-title {
    color: #e5e7eb;
  }

  .update-details {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .detail-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .release-notes {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .release-notes {
    border-top-color: #4b5563;
  }

  .release-notes .label {
    display: block;
    margin-bottom: 0.25rem;
    font-weight: 500;
    color: #374151;
  }

  :global(.dark) .release-notes .label {
    color: #d1d5db;
  }

  .release-notes p {
    margin: 0;
    font-size: 0.75rem;
    color: #6b7280;
    white-space: pre-wrap;
  }

  .download-section {
    margin-top: 1rem;
  }

  .download-btn {
    width: 100%;
    padding: 0.75rem;
    border: none;
    background: #3b82f6;
    color: white;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .download-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .download-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .download-progress {
    position: relative;
    width: 100%;
    height: 32px;
    background: #e5e7eb;
    border-radius: 0.375rem;
    overflow: hidden;
  }

  :global(.dark) .download-progress {
    background: #374151;
  }

  .progress-bar {
    height: 100%;
    background: #3b82f6;
    transition: width 0.3s;
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 0.75rem;
    font-weight: 600;
    color: #374151;
  }

  :global(.dark) .progress-text {
    color: #e5e7eb;
  }

  .download-hint {
    margin: 0.5rem 0 0 0;
    font-size: 0.75rem;
    color: #6b7280;
    text-align: center;
  }

  .up-to-date-msg {
    margin: 0;
    font-size: 0.875rem;
    color: #059669;
  }

  :global(.dark) .up-to-date-msg {
    color: #34d399;
  }

  .no-check {
    padding: 1rem;
    background: #f9fafb;
    border: 1px dashed #d1d5db;
    border-radius: 0.5rem;
    text-align: center;
  }

  :global(.dark) .no-check {
    background: #111827;
    border-color: #4b5563;
  }

  .no-check p {
    margin: 0;
    color: #6b7280;
    font-size: 0.875rem;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 0.375rem;
    margin-bottom: 1rem;
  }

  :global(.dark) .error-message {
    background: #450a0a;
    border-color: #dc2626;
  }

  .error-icon {
    color: #dc2626;
  }

  .error-message span:last-child {
    font-size: 0.875rem;
    color: #991b1b;
  }

  :global(.dark) .error-message span:last-child {
    color: #fecaca;
  }

  .help-text {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .help-text {
    border-top-color: #374151;
  }

  .help-text p {
    margin: 0;
    font-size: 0.75rem;
    color: #9ca3af;
  }
</style>

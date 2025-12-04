<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface RVCStatus {
    installed: boolean;
    venvExists?: boolean;
    inferScriptExists?: boolean;
    diskUsage?: number;
    modelsCount?: number;
  }

  let status: RVCStatus | null = null;
  let loading = true;
  let installing = false;
  let uninstalling = false;
  let error: string | null = null;
  let success: string | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function fetchStatus() {
    try {
      const response = await apiFetch('/api/rvc-addon');
      if (!response.ok) throw new Error('Failed to fetch RVC status');
      status = await response.json();
      loading = false;
      error = null;
    } catch (e) {
      error = String(e);
      loading = false;
      console.error('[RVCAddonInstaller] Error fetching status:', e);
    }
  }

  async function installRVC() {
    installing = true;
    error = null;
    success = null;

    try {
      const response = await apiFetch('/api/rvc-addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install' })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        success = data.message || 'RVC installed successfully!';
        await fetchStatus();
      } else {
        error = data.error || 'Installation failed';
      }
    } catch (e) {
      error = String(e);
      console.error('[RVCAddonInstaller] Install error:', e);
    } finally {
      installing = false;
    }
  }

  async function uninstallRVC() {
    const confirmed = confirm(
      'Are you sure you want to uninstall RVC?\n\n' +
      'This will remove:\n' +
      '- RVC codebase and dependencies\n' +
      '- Python virtual environment\n\n' +
      'Your trained models will NOT be deleted.'
    );

    if (!confirmed) return;

    uninstalling = true;
    error = null;
    success = null;

    try {
      const response = await apiFetch('/api/rvc-addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'uninstall' })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        success = data.message || 'RVC uninstalled successfully';
        await fetchStatus();
      } else {
        error = data.error || 'Uninstall failed';
      }
    } catch (e) {
      error = String(e);
      console.error('[RVCAddonInstaller] Uninstall error:', e);
    } finally {
      uninstalling = false;
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  onMount(() => {
    fetchStatus();
    pollInterval = setInterval(fetchStatus, 60000); // Poll every minute
  });

  onDestroy(() => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });
</script>

<div class="rvc-addon-installer">
  <div class="addon-header">
    <div class="addon-title">
      <span class="addon-icon">🎭</span>
      <div>
        <h3>RVC Voice Cloning</h3>
        <p class="addon-subtitle">High-quality voice cloning with Retrieval-based Voice Conversion</p>
      </div>
    </div>
    {#if status?.installed}
      <span class="status-badge installed">✓ Installed</span>
    {:else}
      <span class="status-badge not-installed">Not Installed</span>
    {/if}
  </div>

  {#if error}
    <div class="message error">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if success}
    <div class="message success">
      <strong>Success:</strong> {success}
    </div>
  {/if}

  <div class="addon-description">
    <p>
      <strong>RVC (Retrieval-based Voice Conversion)</strong> provides high-fidelity voice cloning using
      advanced neural voice conversion technology. Unlike GPT-SoVITS, RVC requires training a custom model
      but delivers exceptional quality.
    </p>

    <div class="features">
      <h4>Features:</h4>
      <ul>
        <li>⭐ Highest quality voice cloning available</li>
        <li>🎯 Fine-grained pitch control (-12 to +12 semitones)</li>
        <li>🔄 Two-stage synthesis (Piper TTS → RVC conversion)</li>
        <li>💾 Per-user model isolation</li>
        <li>🛡️ Auto-fallback to Piper if model unavailable</li>
      </ul>
    </div>

    <div class="requirements">
      <h4>Requirements:</h4>
      <ul>
        <li>Python 3.9+ (auto-detected during install)</li>
        <li>10-15 minutes of clean voice audio for training</li>
        <li>~2GB disk space for installation</li>
        <li>NVIDIA GPU recommended (CPU works but slower)</li>
      </ul>
    </div>
  </div>

  {#if loading}
    <div class="loading">Checking installation status...</div>
  {:else if status?.installed}
    <div class="addon-details">
      <div class="detail-row">
        <span class="detail-label">Python Environment:</span>
        <span class="detail-value">
          {status.venvExists ? '✓ Virtual environment configured' : '✗ Missing'}
        </span>
      </div>

      <div class="detail-row">
        <span class="detail-label">Inference Script:</span>
        <span class="detail-value">
          {status.inferScriptExists ? '✓ Ready' : '✗ Missing'}
        </span>
      </div>

      <div class="detail-row">
        <span class="detail-label">Disk Usage:</span>
        <span class="detail-value">
          {status.diskUsage ? formatBytes(status.diskUsage) : 'Unknown'}
        </span>
      </div>

      <div class="detail-row">
        <span class="detail-label">Trained Models:</span>
        <span class="detail-value">
          {status.modelsCount || 0} model{status.modelsCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>

    <div class="addon-actions">
      <button
        class="btn secondary-btn"
        on:click={uninstallRVC}
        disabled={uninstalling}
      >
        {uninstalling ? 'Uninstalling...' : 'Uninstall RVC'}
      </button>
    </div>

    <div class="addon-note">
      <strong>💡 Next Steps:</strong>
      <ol>
        <li>Go to <strong>Voice → Training</strong> tab</li>
        <li>Collect voice samples during conversations</li>
        <li>Train RVC model with: <code>mh rvc train --name your-name</code></li>
        <li>Select RVC provider in Voice Settings</li>
      </ol>
    </div>
  {:else}
    <div class="addon-actions">
      <button
        class="btn primary-btn"
        on:click={installRVC}
        disabled={installing}
      >
        {installing ? 'Installing...' : 'Install RVC'}
      </button>
    </div>

    <div class="addon-note">
      <strong>⏱️ Installation Time:</strong> ~5-10 minutes depending on your internet connection.
      This will download Python dependencies and the Applio RVC framework.
    </div>
  {/if}
</div>

<style>
  .rvc-addon-installer {
    padding: 20px;
    background: #f9f9f9;
    border: 1px solid #ddd;
    border-radius: 8px;
    max-width: 800px;
  }

  :global(.dark) .rvc-addon-installer {
    background: #2a2a2a;
    border-color: #444;
  }

  .addon-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 15px;
    border-bottom: 2px solid #ddd;
  }

  :global(.dark) .addon-header {
    border-color: #444;
  }

  .addon-title {
    display: flex;
    align-items: center;
    gap: 15px;
  }

  .addon-icon {
    font-size: 2.5rem;
  }

  h3 {
    margin: 0;
    font-size: 1.5rem;
    color: #1a1a1a;
  }

  :global(.dark) h3 {
    color: #e0e0e0;
  }

  .addon-subtitle {
    margin: 5px 0 0 0;
    font-size: 0.9rem;
    color: #666;
  }

  :global(.dark) .addon-subtitle {
    color: #999;
  }

  .status-badge {
    padding: 6px 12px;
    border-radius: 16px;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .status-badge.installed {
    background: #4CAF50;
    color: white;
  }

  .status-badge.not-installed {
    background: #FF9800;
    color: white;
  }

  .message {
    padding: 12px 15px;
    margin-bottom: 15px;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .message.error {
    background: #fee;
    border: 1px solid #fcc;
    color: #c00;
  }

  :global(.dark) .message.error {
    background: #400;
    border-color: #600;
    color: #fcc;
  }

  .message.success {
    background: #efe;
    border: 1px solid #cfc;
    color: #060;
  }

  :global(.dark) .message.success {
    background: #040;
    border-color: #060;
    color: #cfc;
  }

  .addon-description {
    margin-bottom: 20px;
  }

  .addon-description p {
    line-height: 1.6;
    color: #333;
    margin-bottom: 15px;
  }

  :global(.dark) .addon-description p {
    color: #ccc;
  }

  .features, .requirements {
    margin: 15px 0;
  }

  h4 {
    margin: 0 0 10px 0;
    font-size: 1.1rem;
    color: #1565c0;
  }

  :global(.dark) h4 {
    color: #93c5fd;
  }

  ul {
    margin: 0;
    padding-left: 1.5rem;
    line-height: 1.8;
  }

  .addon-details {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 15px;
    margin-bottom: 15px;
  }

  :global(.dark) .addon-details {
    background: #1a1a1a;
    border-color: #444;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #f0f0f0;
  }

  :global(.dark) .detail-row {
    border-color: #333;
  }

  .detail-row:last-child {
    border-bottom: none;
  }

  .detail-label {
    font-weight: 600;
    color: #555;
  }

  :global(.dark) .detail-label {
    color: #aaa;
  }

  .detail-value {
    color: #1a1a1a;
  }

  :global(.dark) .detail-value {
    color: #e0e0e0;
  }

  .addon-actions {
    margin: 20px 0;
  }

  .btn {
    padding: 12px 24px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .primary-btn {
    background: #2196F3;
    color: white;
  }

  .primary-btn:hover:not(:disabled) {
    background: #1976D2;
  }

  .secondary-btn {
    background: #757575;
    color: white;
  }

  .secondary-btn:hover:not(:disabled) {
    background: #616161;
  }

  .addon-note {
    padding: 15px;
    background: #e3f2fd;
    border-left: 4px solid #2196F3;
    border-radius: 4px;
    font-size: 0.9rem;
    line-height: 1.6;
  }

  :global(.dark) .addon-note {
    background: #1a3a5a;
    border-color: #4a9eff;
  }

  .addon-note strong {
    color: #1565c0;
  }

  :global(.dark) .addon-note strong {
    color: #93c5fd;
  }

  .addon-note ol {
    margin: 10px 0 0 0;
    padding-left: 1.5rem;
  }

  .addon-note code {
    background: rgba(0, 0, 0, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
  }

  :global(.dark) .addon-note code {
    background: rgba(255, 255, 255, 0.1);
  }

  .loading {
    padding: 20px;
    text-align: center;
    color: #666;
    font-style: italic;
  }

  :global(.dark) .loading {
    color: #999;
  }
</style>

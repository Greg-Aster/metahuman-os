<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface TrainingProgress {
    samplesCollected: number;
    totalDuration: number;
    targetDuration: number;
    percentComplete: number;
    readyForTraining: boolean;
  }

  interface VoiceSample {
    id: string;
    timestamp: number;
    duration: number;
    quality: number;
    transcript?: string;
  }

  let progress: TrainingProgress | null = null;
  let samples: VoiceSample[] = [];
  let loading = true;
  let error: string | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let exporting = false;
  let trainingEnabled = false;
  let togglingTraining = false;
  let purging = false;

  async function fetchProgress() {
    try {
      const response = await fetch('/api/voice-training?action=progress');
      if (!response.ok) throw new Error('Failed to fetch progress');
      progress = await response.json();
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error fetching progress:', e);
    }
  }

  async function fetchSamples() {
    try {
      const response = await fetch('/api/voice-training?action=samples&limit=10');
      if (!response.ok) throw new Error('Failed to fetch samples');
      const data = await response.json();
      samples = data.samples || [];
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error fetching samples:', e);
    }
  }

  async function deleteSample(sampleId: string) {
    try {
      const response = await fetch('/api/voice-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', sampleId })
      });

      if (!response.ok) throw new Error('Failed to delete sample');

      // Refresh data
      await Promise.all([fetchProgress(), fetchSamples()]);
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error deleting sample:', e);
    }
  }

  async function exportDataset() {
    exporting = true;
    try {
      const response = await fetch('/api/voice-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export' })
      });

      if (!response.ok) throw new Error('Failed to export dataset');

      const data = await response.json();
      alert(`Dataset exported to: ${data.exportPath}`);
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error exporting dataset:', e);
    } finally {
      exporting = false;
    }
  }

  async function toggleTraining() {
    togglingTraining = true;
    // Note: bind:checked has already updated trainingEnabled when this is called
    const newState = trainingEnabled;
    try {
      const response = await fetch('/api/voice-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', enabled: newState })
      });

      if (!response.ok) throw new Error('Failed to toggle voice training');

      const data = await response.json();
      trainingEnabled = data.enabled;
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error toggling training:', e);
      // Revert the toggle on error
      trainingEnabled = !newState;
    } finally {
      togglingTraining = false;
    }
  }

  async function purgeAllData() {
    const confirmed = confirm(
      'Are you sure you want to delete ALL voice clone training data?\n\n' +
      'This will permanently delete:\n' +
      '- All voice samples\n' +
      '- Training progress\n' +
      '- Exported datasets\n\n' +
      'This action cannot be undone!'
    );

    if (!confirmed) return;

    purging = true;
    try {
      const response = await fetch('/api/voice-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purge' })
      });

      if (!response.ok) throw new Error('Failed to purge voice data');

      const data = await response.json();
      alert(`Successfully deleted ${data.deletedCount || 0} samples and all training data.`);

      // Refresh data
      await loadData();
    } catch (e) {
      error = String(e);
      console.error('[VoiceTrainingWidget] Error purging data:', e);
    } finally {
      purging = false;
    }
  }

  async function fetchTrainingStatus() {
    try {
      const response = await fetch('/api/voice-training?action=status');
      if (!response.ok) throw new Error('Failed to fetch training status');
      const data = await response.json();
      trainingEnabled = data.enabled || false;
    } catch (e) {
      console.error('[VoiceTrainingWidget] Error fetching training status:', e);
    }
  }

  function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  async function loadData() {
    loading = true;
    await Promise.all([fetchProgress(), fetchSamples(), fetchTrainingStatus()]);
    loading = false;
  }

  onMount(() => {
    loadData();
    // Poll every 30 seconds
    pollInterval = setInterval(loadData, 30000);
  });

  onDestroy(() => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });
</script>

<div class="voice-training-widget">
  <div class="header">
    <h2>Voice Clone Training</h2>
    <div class="training-controls">
      <div class="toggle-container">
        <label class="toggle-switch">
          <input
            type="checkbox"
            bind:checked={trainingEnabled}
            on:change={toggleTraining}
            disabled={togglingTraining}
          />
          <span class="slider"></span>
        </label>
        <span class="toggle-label">{trainingEnabled ? 'Enabled' : 'Disabled'}</span>
      </div>
    </div>
  </div>

  {#if error}
    <div class="error">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if !trainingEnabled}
    <div class="disabled-notice">
      <p>Voice clone training is currently disabled.</p>
      <p>Enable it above to start collecting voice samples during conversations.</p>
    </div>
  {/if}

  {#if loading && !progress}
    <div class="loading">Loading training data...</div>
  {:else if progress}
    <div class="progress-section">
      <div class="stats">
        <div class="stat">
          <span class="label">Samples:</span>
          <span class="value">{progress.samplesCollected}</span>
        </div>
        <div class="stat">
          <span class="label">Duration:</span>
          <span class="value">{formatDuration(progress.totalDuration)}</span>
        </div>
        <div class="stat">
          <span class="label">Target:</span>
          <span class="value">{formatDuration(progress.targetDuration)}</span>
        </div>
      </div>

      <div class="progress-bar-container">
        <div class="progress-bar" style="width: {progress.percentComplete}%"></div>
        <span class="progress-text">{progress.percentComplete.toFixed(1)}%</span>
      </div>

      {#if progress.readyForTraining}
        <div class="ready-badge">Ready for training!</div>
      {:else}
        <div class="info">
          Continue having voice conversations to collect more training data.
          Need {formatDuration(progress.targetDuration - progress.totalDuration)} more.
        </div>
      {/if}

      <div class="actions">
        <button on:click={exportDataset} disabled={exporting || !progress.readyForTraining}>
          {exporting ? 'Exporting...' : 'Export Dataset'}
        </button>
        <button class="danger-btn" on:click={purgeAllData} disabled={purging}>
          {purging ? 'Purging...' : 'Purge All Data'}
        </button>
      </div>
    </div>

    <div class="samples-section">
      <h3>Recent Samples</h3>
      {#if samples.length === 0}
        <p class="no-samples">No samples collected yet. Start a voice conversation to begin!</p>
      {:else}
        <div class="samples-list">
          {#each samples as sample (sample.id)}
            <div class="sample">
              <div class="sample-header">
                <span class="sample-time">{formatTimestamp(sample.timestamp)}</span>
                <span class="sample-duration">{formatDuration(sample.duration)}</span>
                <span class="sample-quality" class:high={sample.quality >= 0.8} class:medium={sample.quality >= 0.6 && sample.quality < 0.8} class:low={sample.quality < 0.6}>
                  {(sample.quality * 100).toFixed(0)}%
                </span>
              </div>
              <div class="sample-transcript">
                "{(sample.transcript || '').substring(0, 100)}{(sample.transcript || '').length > 100 ? '...' : ''}"
              </div>
              <button class="delete-btn" on:click={() => deleteSample(sample.id)}>
                Delete
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .voice-training-widget {
    padding: 20px;
    max-width: 800px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #1a1a1a;
  }

  :global(.dark) h2 {
    color: #e0e0e0;
  }

  .training-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .toggle-container {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* Toggle Switch Styles */
  .toggle-switch {
    position: relative;
    display: inline-block;
    cursor: pointer;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }

  .slider {
    position: relative;
    display: block;
    width: 50px;
    height: 24px;
    background-color: #ccc;
    border-radius: 24px;
    transition: background-color 0.3s;
  }

  .slider::before {
    content: '';
    position: absolute;
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.3s;
  }

  .toggle-switch input:checked + .slider {
    background-color: #4CAF50;
  }

  .toggle-switch input:checked + .slider::before {
    transform: translateX(26px);
  }

  .toggle-switch input:disabled + .slider {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.dark) .slider {
    background-color: #555;
  }

  :global(.dark) .slider::before {
    background-color: #ddd;
  }

  :global(.dark) .toggle-switch input:checked + .slider {
    background-color: #66BB6A;
  }

  .toggle-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: #333;
    min-width: 65px;
  }

  :global(.dark) .toggle-label {
    color: #ccc;
  }

  .disabled-notice {
    padding: 20px;
    margin-bottom: 20px;
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 8px;
    text-align: center;
  }

  .disabled-notice p {
    margin: 5px 0;
    color: #666;
  }

  :global(.dark) .disabled-notice {
    background: #2a2a2a;
    border-color: #444;
  }

  :global(.dark) .disabled-notice p {
    color: #999;
  }

  h3 {
    margin: 20px 0 10px 0;
    font-size: 1.2rem;
    color: #333;
  }

  :global(.dark) h3 {
    color: #ccc;
  }

  .error {
    padding: 10px;
    margin-bottom: 15px;
    background: #fee;
    border: 1px solid #fcc;
    border-radius: 4px;
    color: #c00;
  }

  :global(.dark) .error {
    background: #400;
    border-color: #600;
    color: #fcc;
  }

  .loading {
    padding: 20px;
    text-align: center;
    color: #666;
  }

  :global(.dark) .loading {
    color: #999;
  }

  .progress-section {
    margin-bottom: 30px;
  }

  .stats {
    display: flex;
    gap: 20px;
    margin-bottom: 15px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .stat .label {
    font-size: 0.85rem;
    color: #666;
  }

  :global(.dark) .stat .label {
    color: #999;
  }

  .stat .value {
    font-size: 1.2rem;
    font-weight: bold;
    color: #1a1a1a;
  }

  :global(.dark) .stat .value {
    color: #e0e0e0;
  }

  .progress-bar-container {
    position: relative;
    width: 100%;
    height: 30px;
    background: #e0e0e0;
    border-radius: 15px;
    overflow: hidden;
    margin-bottom: 15px;
  }

  :global(.dark) .progress-bar-container {
    background: #333;
  }

  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #4CAF50, #8BC34A);
    transition: width 0.5s ease;
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-weight: bold;
    color: #1a1a1a;
    font-size: 0.9rem;
  }

  :global(.dark) .progress-text {
    color: #fff;
  }

  .ready-badge {
    display: inline-block;
    padding: 8px 16px;
    background: #4CAF50;
    color: white;
    border-radius: 20px;
    font-weight: bold;
    margin-bottom: 10px;
  }

  .info {
    padding: 10px;
    background: #f0f0f0;
    border-radius: 4px;
    color: #666;
    font-size: 0.9rem;
  }

  :global(.dark) .info {
    background: #2a2a2a;
    color: #999;
  }

  .actions {
    margin-top: 15px;
    display: flex;
    gap: 10px;
  }

  button {
    padding: 10px 20px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
  }

  button:hover:not(:disabled) {
    background: #1976D2;
  }

  button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  :global(.dark) button:disabled {
    background: #444;
  }

  .danger-btn {
    background: #f44336;
  }

  .danger-btn:hover:not(:disabled) {
    background: #d32f2f;
  }

  :global(.dark) .danger-btn {
    background: #e53935;
  }

  :global(.dark) .danger-btn:hover:not(:disabled) {
    background: #c62828;
  }

  .samples-section {
    margin-top: 30px;
  }

  .no-samples {
    padding: 20px;
    text-align: center;
    color: #666;
    font-style: italic;
  }

  :global(.dark) .no-samples {
    color: #999;
  }

  .samples-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sample {
    padding: 15px;
    background: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
  }

  :global(.dark) .sample {
    background: #2a2a2a;
    border-color: #444;
  }

  .sample-header {
    display: flex;
    gap: 15px;
    margin-bottom: 8px;
    font-size: 0.85rem;
  }

  .sample-time {
    color: #666;
  }

  :global(.dark) .sample-time {
    color: #999;
  }

  .sample-duration {
    color: #2196F3;
    font-weight: bold;
  }

  .sample-quality {
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: bold;
  }

  .sample-quality.high {
    background: #4CAF50;
    color: white;
  }

  .sample-quality.medium {
    background: #FF9800;
    color: white;
  }

  .sample-quality.low {
    background: #F44336;
    color: white;
  }

  .sample-transcript {
    margin-bottom: 10px;
    color: #333;
    font-style: italic;
  }

  :global(.dark) .sample-transcript {
    color: #ccc;
  }

  .delete-btn {
    padding: 5px 10px;
    background: #f44336;
    color: white;
    font-size: 0.85rem;
  }

  .delete-btn:hover {
    background: #d32f2f;
  }
</style>

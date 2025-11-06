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
    await Promise.all([fetchProgress(), fetchSamples()]);
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
  <h2>Voice Training</h2>

  {#if error}
    <div class="error">
      <strong>Error:</strong> {error}
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

  h2 {
    margin: 0 0 20px 0;
    font-size: 1.5rem;
    color: #1a1a1a;
  }

  :global(.dark) h2 {
    color: #e0e0e0;
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

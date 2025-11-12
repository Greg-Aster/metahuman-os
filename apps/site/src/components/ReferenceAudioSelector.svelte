<script lang="ts">
  /**
   * ReferenceAudioSelector
   * UI for selecting voice samples to use as reference audio
   */

  import { onMount } from 'svelte';

  export let provider: 'piper' | 'gpt-sovits' = 'gpt-sovits';
  export let speakerId: string = 'default';
  export let minQuality: number = 0.8;
  export let onSelectionChange: (selectedIds: string[]) => void = () => {};

  interface VoiceSample {
    id: string;
    audioPath: string;
    transcriptPath: string;
    duration: number;
    timestamp: string;
    quality: number;
  }

  let samples: VoiceSample[] = [];
  let selectedIds: Set<string> = new Set();
  let loading = false;
  let error = '';
  let totalDuration = 0;
  let avgQuality = 0;

  onMount(() => {
    loadSamples();
  });

  async function loadSamples() {
    loading = true;
    error = '';
    try {
      const response = await fetch(
        `/api/sovits-training?action=available-samples&provider=${provider}&minQuality=${minQuality}&limit=100`
      );
      if (!response.ok) throw new Error('Failed to load samples');

      const data = await response.json();
      samples = data.samples || [];

      // Calculate stats
      totalDuration = samples.reduce((sum, s) => sum + s.duration, 0);
      avgQuality = samples.length > 0
        ? samples.reduce((sum, s) => sum + s.quality, 0) / samples.length
        : 0;
    } catch (err) {
      error = String(err);
      console.error('[ReferenceAudioSelector] Error loading samples:', err);
    } finally {
      loading = false;
    }
  }

  function toggleSelection(id: string) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    selectedIds = selectedIds; // Trigger reactivity
    onSelectionChange(Array.from(selectedIds));
  }

  function selectAll() {
    selectedIds = new Set(samples.map(s => s.id));
    onSelectionChange(Array.from(selectedIds));
  }

  function clearSelection() {
    selectedIds = new Set();
    onSelectionChange(Array.from(selectedIds));
  }

  function selectBest(count: number = 5) {
    // Sort by quality and select top N
    const sorted = [...samples].sort((a, b) => b.quality - a.quality);
    selectedIds = new Set(sorted.slice(0, count).map(s => s.id));
    onSelectionChange(Array.from(selectedIds));
  }

  function formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  }

  function formatTimestamp(timestamp: string): string {
    try {
      return new Date(timestamp).toLocaleDateString();
    } catch {
      return timestamp;
    }
  }

  $: selectedSamples = samples.filter(s => selectedIds.has(s.id));
  $: selectedDuration = selectedSamples.reduce((sum, s) => sum + s.duration, 0);
  $: selectedQuality = selectedSamples.length > 0
    ? selectedSamples.reduce((sum, s) => sum + s.quality, 0) / selectedSamples.length
    : 0;
</script>

<div class="reference-audio-selector">
  <div class="selector-header">
    <h3>Select Reference Audio Samples</h3>
    <p class="help-text">
      {#if provider === 'gpt-sovits'}
        Select 3-5 high-quality samples (5-10 seconds total) for best results
      {:else}
        Select samples for Piper voice training (more is better)
      {/if}
    </p>
  </div>

  {#if loading}
    <div class="loading">Loading samples...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <div class="selector-controls">
      <div class="control-buttons">
        <button on:click={selectAll} class="btn-sm">Select All ({samples.length})</button>
        <button on:click={clearSelection} class="btn-sm">Clear</button>
        <button on:click={() => selectBest(5)} class="btn-sm">Select Top 5</button>
        <button on:click={() => selectBest(10)} class="btn-sm">Select Top 10</button>
      </div>

      <div class="selection-stats">
        <div class="stat">
          <label>Selected:</label>
          <span class="value">{selectedIds.size} samples</span>
        </div>
        <div class="stat">
          <label>Duration:</label>
          <span class="value">{formatDuration(selectedDuration)}</span>
        </div>
        <div class="stat">
          <label>Avg Quality:</label>
          <span class="value quality-{Math.floor(selectedQuality * 10)}">
            {(selectedQuality * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>

    <div class="sample-list">
      {#if samples.length === 0}
        <div class="no-samples">
          No samples found above quality threshold ({minQuality}).
          <br>Try recording more voice samples or lowering the quality threshold.
        </div>
      {:else}
        {#each samples as sample (sample.id)}
          <div
            class="sample-item"
            class:selected={selectedIds.has(sample.id)}
            on:click={() => toggleSelection(sample.id)}
          >
            <div class="sample-checkbox">
              <input
                type="checkbox"
                checked={selectedIds.has(sample.id)}
                on:change={() => toggleSelection(sample.id)}
              />
            </div>

            <div class="sample-info">
              <div class="sample-id">{sample.id}</div>
              <div class="sample-meta">
                <span class="meta-item">
                  <span class="meta-label">Duration:</span>
                  <span class="meta-value">{formatDuration(sample.duration)}</span>
                </span>
                <span class="meta-item">
                  <span class="meta-label">Quality:</span>
                  <span class="meta-value quality-{Math.floor(sample.quality * 10)}">
                    {(sample.quality * 100).toFixed(0)}%
                  </span>
                </span>
                <span class="meta-item">
                  <span class="meta-label">Date:</span>
                  <span class="meta-value">{formatTimestamp(sample.timestamp)}</span>
                </span>
              </div>
            </div>

            <div class="sample-quality-bar">
              <div class="quality-fill" style="width: {sample.quality * 100}%"></div>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="selector-footer">
      <div class="total-stats">
        <div class="stat-item">
          <label>Total Available:</label>
          <span>{samples.length} samples</span>
        </div>
        <div class="stat-item">
          <label>Total Duration:</label>
          <span>{formatDuration(totalDuration)}</span>
        </div>
        <div class="stat-item">
          <label>Avg Quality:</label>
          <span>{(avgQuality * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .reference-audio-selector {
    background: var(--bg-secondary, #1a1a1a);
    border-radius: 8px;
    padding: 1.5rem;
    color: var(--text-primary, #ffffff);
  }

  :global(.dark) .reference-audio-selector {
    background: #1a1a1a;
    color: #ffffff;
  }

  .selector-header {
    margin-bottom: 1.5rem;
  }

  .selector-header h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.2rem;
    color: var(--text-primary, #ffffff);
  }

  .help-text {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-secondary, #888);
    opacity: 0.8;
  }

  .loading,
  .error {
    padding: 2rem;
    text-align: center;
  }

  .error {
    color: var(--error, #ff4444);
  }

  .selector-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border, #333);
  }

  .control-buttons {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .btn-sm {
    padding: 0.4rem 0.8rem;
    font-size: 0.85rem;
    background: var(--bg-button, #333);
    color: var(--text-primary, #fff);
    border: 1px solid var(--border, #444);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-sm:hover {
    background: var(--bg-button-hover, #444);
    border-color: var(--border-hover, #555);
  }

  .selection-stats {
    display: flex;
    gap: 1rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .stat label {
    font-size: 0.75rem;
    color: var(--text-secondary, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .stat .value {
    font-size: 1rem;
    font-weight: 600;
    margin-top: 0.2rem;
  }

  .sample-list {
    max-height: 400px;
    overflow-y: auto;
    border: 1px solid var(--border, #333);
    border-radius: 6px;
    background: var(--bg-tertiary, #0f0f0f);
  }

  :global(.dark) .sample-list {
    background: #0f0f0f;
    border-color: #333;
  }

  .no-samples {
    padding: 2rem;
    text-align: center;
    color: var(--text-secondary, #888);
  }

  .sample-item {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border, #2a2a2a);
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .sample-item:hover {
    background: var(--bg-hover, #222);
  }

  .sample-item.selected {
    background: var(--bg-selected, #1a3a5a);
    border-left: 3px solid var(--accent, #4a9eff);
  }

  :global(.dark) .sample-item.selected {
    background: #1a3a5a;
  }

  .sample-checkbox {
    margin-right: 0.75rem;
  }

  .sample-checkbox input[type="checkbox"] {
    width: 1.2rem;
    height: 1.2rem;
    cursor: pointer;
  }

  .sample-info {
    flex: 1;
  }

  .sample-id {
    font-weight: 500;
    margin-bottom: 0.3rem;
    font-size: 0.95rem;
  }

  .sample-meta {
    display: flex;
    gap: 1rem;
    font-size: 0.85rem;
  }

  .meta-item {
    display: flex;
    gap: 0.3rem;
  }

  .meta-label {
    color: var(--text-secondary, #888);
  }

  .meta-value {
    color: var(--text-primary, #fff);
    font-weight: 500;
  }

  .sample-quality-bar {
    width: 80px;
    height: 6px;
    background: var(--bg-bar, #2a2a2a);
    border-radius: 3px;
    overflow: hidden;
    margin-left: 1rem;
  }

  .quality-fill {
    height: 100%;
    background: linear-gradient(90deg, #ff4444, #ffaa44, #44ff44);
    transition: width 0.3s;
  }

  .selector-footer {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border, #333);
  }

  .total-stats {
    display: flex;
    justify-content: space-around;
    gap: 1rem;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .stat-item label {
    font-size: 0.75rem;
    color: var(--text-secondary, #888);
    margin-bottom: 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .stat-item span {
    font-size: 1rem;
    font-weight: 600;
  }

  /* Quality color classes */
  .quality-10, .quality-9 {
    color: #44ff44;
  }
  .quality-8 {
    color: #88ff44;
  }
  .quality-7 {
    color: #ffaa44;
  }
  .quality-6, .quality-5, .quality-4 {
    color: #ff8844;
  }
  .quality-3, .quality-2, .quality-1, .quality-0 {
    color: #ff4444;
  }

  @media (max-width: 768px) {
    .selector-controls {
      flex-direction: column;
      align-items: stretch;
      gap: 1rem;
    }

    .selection-stats {
      justify-content: space-between;
      width: 100%;
    }

    .sample-meta {
      flex-direction: column;
      gap: 0.3rem;
    }

    .sample-quality-bar {
      display: none;
    }
  }
</style>

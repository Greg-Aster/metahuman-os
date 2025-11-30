<script lang="ts">
  /**
   * ReferenceAudioSelector
   * UI for selecting voice samples to use as reference audio
   * For GPT-SoVITS: Allows setting specific samples as the active reference
   */

  import { onMount } from 'svelte';

  export let provider: 'piper' | 'sovits' | 'gpt-sovits' | 'rvc' = 'gpt-sovits';
  export let speakerId: string = 'default';
  export let minQuality: number = 0.8;
  export let onSelectionChange: (selectedIds: string[]) => void = () => {};
  export let onReferenceSet: (sampleId: string) => void = () => {};

  interface VoiceSample {
    id: string;
    audioPath: string;
    transcriptPath: string;
    duration: number;
    timestamp: string;
    quality: number;
  }

  interface CurrentReference {
    sampleId: string | null;
    referencePath: string | null;
    transcript: string | null;
  }

  let samples: VoiceSample[] = [];
  let selectedIds: Set<string> = new Set();
  let loading = false;
  let error = '';
  let totalDuration = 0;
  let avgQuality = 0;
  let playingId: string | null = null;
  let audioElement: HTMLAudioElement | null = null;
  let currentReference: CurrentReference | null = null;
  let settingReference = false;
  let testingVoice = false;

  onMount(() => {
    loadSamples();
    if (provider === 'gpt-sovits' || provider === 'sovits') {
      loadCurrentReference();
    }
  });

  async function loadSamples() {
    loading = true;
    error = '';
    try {
      const response = await fetch(
        `/api/sovits-training?action=available-samples&provider=${provider}&minQuality=${minQuality}&limit=1000`
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

  async function loadCurrentReference() {
    try {
      const response = await fetch(
        `/api/sovits-training?action=current-reference&provider=gpt-sovits&speakerId=${speakerId}`
      );
      if (response.ok) {
        currentReference = await response.json();
      }
    } catch (err) {
      console.error('[ReferenceAudioSelector] Error loading current reference:', err);
    }
  }

  async function setAsReference(sampleId: string, event: Event) {
    event.stopPropagation();
    settingReference = true;
    error = '';

    try {
      const response = await fetch('/api/sovits-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-reference',
          provider: 'gpt-sovits',
          speakerId,
          sampleId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to set reference');
      }

      // Reload current reference
      await loadCurrentReference();
      onReferenceSet(sampleId);
    } catch (err) {
      error = String(err);
      console.error('[ReferenceAudioSelector] Error setting reference:', err);
    } finally {
      settingReference = false;
    }
  }

  async function testVoiceWithSample(sampleId: string, event: Event) {
    event.stopPropagation();
    testingVoice = true;
    error = '';

    try {
      // First set this sample as the reference
      await setAsReference(sampleId, event);

      // Then trigger a voice test via TTS API
      const testText = 'Testing voice with this reference sample.';
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: testText,
          provider: 'gpt-sovits',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate test audio');
      }

      // Play the generated audio
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.play();

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
      };
    } catch (err) {
      error = String(err);
      console.error('[ReferenceAudioSelector] Error testing voice:', err);
    } finally {
      testingVoice = false;
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

  function togglePlayAudio(sample: VoiceSample, event: Event) {
    event.stopPropagation(); // Prevent checkbox toggle

    // If already playing this sample, stop it
    if (playingId === sample.id) {
      if (audioElement) {
        audioElement.pause();
        audioElement = null;
      }
      playingId = null;
      return;
    }

    // Stop any currently playing audio
    if (audioElement) {
      audioElement.pause();
      audioElement = null;
    }

    // Start playing the selected sample via API endpoint
    playingId = sample.id;
    // Use API endpoint to serve the audio file
    const audioUrl = `/api/voice-samples/${sample.id}`;
    audioElement = new Audio(audioUrl);

    audioElement.addEventListener('ended', () => {
      playingId = null;
      audioElement = null;
    });

    audioElement.addEventListener('error', (e) => {
      error = `Failed to play audio: ${sample.id}`;
      playingId = null;
      audioElement = null;
      console.error('[ReferenceAudioSelector] Audio playback error:', e);
    });

    audioElement.play().catch(err => {
      error = `Failed to play audio: ${err.message}`;
      playingId = null;
      audioElement = null;
      console.error('[ReferenceAudioSelector] Audio play() failed:', err);
    });
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
      {#if provider === 'gpt-sovits' || provider === 'sovits'}
        GPT-SoVITS voice cloning - Select a sample and click "🎯 Set Reference" to use it, then "🔊 Test" to hear your cloned voice
      {:else}
        Select samples for voice training (more is better)
      {/if}
    </p>
  </div>

  <!-- Current Reference Display for GPT-SoVITS -->
  {#if (provider === 'gpt-sovits' || provider === 'sovits') && currentReference?.sampleId}
    <div class="current-reference">
      <div class="current-reference-header">
        <span class="reference-icon">🎯</span>
        <strong>Active Reference:</strong>
        <span class="reference-id">{currentReference.sampleId}</span>
      </div>
      {#if currentReference.transcript}
        <div class="reference-transcript">"{currentReference.transcript}"</div>
      {/if}
    </div>
  {:else if (provider === 'gpt-sovits' || provider === 'sovits')}
    <div class="current-reference no-reference">
      <span class="reference-icon">⚠️</span>
      <span>No reference set. Select a sample below and click "🎯 Set Reference"</span>
    </div>
  {/if}

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

            <div class="sample-actions">
              <button
                class="play-button"
                on:click={(e) => togglePlayAudio(sample, e)}
                title={playingId === sample.id ? 'Stop' : 'Play sample'}
              >
                {playingId === sample.id ? '⏸️' : '▶️'}
              </button>

              {#if provider === 'gpt-sovits' || provider === 'sovits'}
                <button
                  class="action-button set-reference"
                  class:active={currentReference?.sampleId === sample.id}
                  on:click={(e) => setAsReference(sample.id, e)}
                  disabled={settingReference}
                  title="Set as active reference for voice cloning"
                >
                  {currentReference?.sampleId === sample.id ? '✓' : '🎯'}
                </button>
                <button
                  class="action-button test-voice"
                  on:click={(e) => testVoiceWithSample(sample.id, e)}
                  disabled={testingVoice}
                  title="Test voice with this sample"
                >
                  {testingVoice ? '...' : '🔊'}
                </button>
              {/if}
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

  /* Current Reference Display */
  .current-reference {
    background: var(--bg-accent, #1a3a5a);
    border: 1px solid var(--border-accent, #2a5a8a);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .current-reference.no-reference {
    background: var(--bg-warning, #3a3a1a);
    border-color: var(--border-warning, #8a8a2a);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  :global(.dark) .current-reference {
    background: #1a3a5a;
    border-color: #2a5a8a;
  }

  :global(.dark) .current-reference.no-reference {
    background: #3a3a1a;
    border-color: #5a5a2a;
  }

  .current-reference-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
  }

  .reference-icon {
    font-size: 1.2rem;
  }

  .reference-id {
    color: var(--text-accent, #8ab4ff);
    font-family: monospace;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
  }

  .reference-transcript {
    margin-top: 0.5rem;
    font-style: italic;
    color: var(--text-secondary, #aaa);
    font-size: 0.9rem;
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

  .play-button {
    padding: 0.5rem;
    background: var(--bg-button, #3b82f6);
    color: white;
    border: none;
    border-radius: 50%;
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
    margin-right: 0.5rem;
  }

  .play-button:hover {
    background: var(--bg-button-hover, #2563eb);
    transform: scale(1.1);
  }

  :global(.dark) .play-button {
    background: #1e40af;
  }

  :global(.dark) .play-button:hover {
    background: #1e3a8a;
  }

  /* Sample Actions Container */
  .sample-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-right: 0.5rem;
  }

  .action-button {
    padding: 0.4rem;
    background: var(--bg-button, #333);
    color: white;
    border: 1px solid var(--border, #444);
    border-radius: 6px;
    width: 2.2rem;
    height: 2.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .action-button:hover:not(:disabled) {
    transform: scale(1.1);
  }

  .action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-button.set-reference {
    background: var(--bg-success, #1a4a3a);
    border-color: var(--border-success, #2a6a4a);
  }

  .action-button.set-reference:hover:not(:disabled) {
    background: var(--bg-success-hover, #2a5a4a);
  }

  .action-button.set-reference.active {
    background: #22c55e;
    border-color: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
  }

  .action-button.test-voice {
    background: var(--bg-info, #1a3a6a);
    border-color: var(--border-info, #2a5a8a);
  }

  .action-button.test-voice:hover:not(:disabled) {
    background: var(--bg-info-hover, #2a4a7a);
  }

  :global(.dark) .action-button.set-reference {
    background: #1a4a3a;
    border-color: #2a6a4a;
  }

  :global(.dark) .action-button.set-reference:hover:not(:disabled) {
    background: #2a5a4a;
  }

  :global(.dark) .action-button.test-voice {
    background: #1a3a6a;
    border-color: #2a5a8a;
  }

  :global(.dark) .action-button.test-voice:hover:not(:disabled) {
    background: #2a4a7a;
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

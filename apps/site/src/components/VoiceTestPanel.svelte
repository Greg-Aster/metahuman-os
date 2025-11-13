<script lang="ts">
  /**
   * VoiceTestPanel
   * Test voice synthesis with text input and playback
   */

  export let provider: 'piper' | 'gpt-sovits' = 'piper';
  export let voiceId: string = '';
  export let apiEndpoint: string = '/api/tts';

  let testText: string = 'Hello! This is a test of the voice synthesis system.';
  let generating = false;
  let playing = false;
  let error: string | null = null;
  let audioUrl: string | null = null;
  let audioElement: HTMLAudioElement | null = null;

  const sampleTexts = [
    'Hello! This is a test of the voice synthesis system.',
    'The quick brown fox jumps over the lazy dog.',
    'How are you doing today? I hope you\'re having a wonderful day!',
    'Artificial intelligence is transforming the way we interact with technology.',
  ];

  async function generateVoice() {
    if (!testText.trim()) {
      error = 'Please enter some text to synthesize';
      return;
    }

    generating = true;
    error = null;

    // Clean up previous audio
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: testText,
          provider,
          voiceId,
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || `Server returned ${response.status}`);
      }

      const audioBlob = await response.blob();
      audioUrl = URL.createObjectURL(audioBlob);
    } catch (e) {
      error = String(e);
      console.error('[VoiceTestPanel] Error generating voice:', e);
    } finally {
      generating = false;
    }
  }

  function playAudio() {
    if (!audioUrl || !audioElement) return;

    playing = true;
    audioElement.play();
  }

  function pauseAudio() {
    if (!audioElement) return;

    playing = false;
    audioElement.pause();
  }

  function handleAudioEnded() {
    playing = false;
  }

  function useSampleText(text: string) {
    testText = text;
  }

  function downloadAudio() {
    if (!audioUrl) return;

    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `voice-test-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
</script>

<div class="voice-test-panel">
  <div class="panel-header">
    <h3>Voice Test</h3>
    <div class="provider-badge provider-{provider}">
      {provider === 'gpt-sovits' ? 'GPT-SoVITS' : 'Piper'}
    </div>
  </div>

  <div class="test-input">
    <label for="test-text">Test Text:</label>
    <textarea
      id="test-text"
      bind:value={testText}
      placeholder="Enter text to synthesize..."
      rows="3"
      disabled={generating}
    ></textarea>

    <div class="sample-texts">
      <span class="samples-label">Quick samples:</span>
      <div class="sample-buttons">
        {#each sampleTexts as sample}
          <button
            class="sample-btn"
            on:click={() => useSampleText(sample)}
            disabled={generating}
          >
            {sample.substring(0, 30)}...
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="controls">
    <button
      class="generate-btn"
      on:click={generateVoice}
      disabled={generating || !testText.trim()}
    >
      {generating ? '⏳ Generating...' : '🎤 Generate Voice'}
    </button>

    {#if audioUrl}
      <div class="playback-controls">
        {#if playing}
          <button class="playback-btn pause-btn" on:click={pauseAudio}>
            ⏸️ Pause
          </button>
        {:else}
          <button class="playback-btn play-btn" on:click={playAudio}>
            ▶️ Play
          </button>
        {/if}

        <button class="playback-btn download-btn" on:click={downloadAudio}>
          💾 Download
        </button>
      </div>
    {/if}
  </div>

  {#if error}
    <div class="error-message">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if audioUrl}
    <!-- Hidden audio element for playback -->
    <audio
      bind:this={audioElement}
      src={audioUrl}
      on:ended={handleAudioEnded}
      style="display: none;"
    ></audio>

    <div class="audio-info">
      <span class="info-icon">✓</span>
      <span>Audio generated successfully! Use the controls above to play or download.</span>
    </div>
  {/if}
</div>

<style>
  .voice-test-panel {
    background: var(--bg-secondary, #f9f9f9);
    border: 1px solid var(--border, #e0e0e0);
    border-radius: 8px;
    padding: 1.5rem;
  }

  :global(.dark) .voice-test-panel {
    background: #1a1a1a;
    border-color: #333;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  h3 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) h3 {
    color: #e0e0e0;
  }

  .provider-badge {
    padding: 4px 10px;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .provider-badge.provider-gpt-sovits {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .provider-badge.provider-piper {
    background: #134e4a;
    color: #5eead4;
  }

  :global(.dark) .provider-badge.provider-gpt-sovits {
    background: #1e40af;
    color: #bfdbfe;
  }

  :global(.dark) .provider-badge.provider-piper {
    background: #115e59;
    color: #99f6e4;
  }

  .test-input {
    margin-bottom: 1rem;
  }

  label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text-primary, #333);
  }

  :global(.dark) label {
    color: #ccc;
  }

  textarea {
    width: 100%;
    padding: 10px;
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
    resize: vertical;
    background: var(--bg-input, #fff);
    color: var(--text-primary, #1a1a1a);
  }

  :global(.dark) textarea {
    background: #0f0f0f;
    border-color: #444;
    color: #e0e0e0;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent, #2196F3);
  }

  textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .sample-texts {
    margin-top: 0.75rem;
  }

  .samples-label {
    display: block;
    font-size: 0.8rem;
    color: var(--text-secondary, #666);
    margin-bottom: 0.5rem;
  }

  :global(.dark) .samples-label {
    color: #999;
  }

  .sample-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .sample-btn {
    padding: 4px 8px;
    font-size: 0.75rem;
    background: var(--bg-tertiary, #f0f0f0);
    color: var(--text-secondary, #666);
    border: 1px solid var(--border, #ddd);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .sample-btn:hover:not(:disabled) {
    background: var(--bg-hover, #e0e0e0);
    border-color: var(--border-hover, #bbb);
  }

  .sample-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.dark) .sample-btn {
    background: #2a2a2a;
    border-color: #444;
    color: #999;
  }

  :global(.dark) .sample-btn:hover:not(:disabled) {
    background: #333;
    border-color: #555;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .generate-btn {
    padding: 10px 20px;
    font-size: 1rem;
    font-weight: 600;
    background: #10b981;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .generate-btn:hover:not(:disabled) {
    background: #059669;
  }

  .generate-btn:disabled {
    background: #ccc;
    cursor: not-allowed;
    opacity: 0.6;
  }

  :global(.dark) .generate-btn {
    background: #047857;
  }

  :global(.dark) .generate-btn:hover:not(:disabled) {
    background: #065f46;
  }

  :global(.dark) .generate-btn:disabled {
    background: #444;
  }

  .playback-controls {
    display: flex;
    gap: 0.5rem;
  }

  .playback-btn {
    padding: 8px 16px;
    font-size: 0.9rem;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .play-btn {
    background: #3b82f6;
    color: white;
  }

  .play-btn:hover {
    background: #2563eb;
  }

  :global(.dark) .play-btn {
    background: #1e40af;
  }

  :global(.dark) .play-btn:hover {
    background: #1e3a8a;
  }

  .pause-btn {
    background: #f59e0b;
    color: white;
  }

  .pause-btn:hover {
    background: #d97706;
  }

  :global(.dark) .pause-btn {
    background: #b45309;
  }

  :global(.dark) .pause-btn:hover {
    background: #92400e;
  }

  .download-btn {
    background: #6b7280;
    color: white;
  }

  .download-btn:hover {
    background: #4b5563;
  }

  :global(.dark) .download-btn {
    background: #374151;
  }

  :global(.dark) .download-btn:hover {
    background: #1f2937;
  }

  .error-message {
    padding: 10px 12px;
    background: #fee2e2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    color: #991b1b;
    font-size: 0.9rem;
  }

  :global(.dark) .error-message {
    background: #7f1d1d;
    border-color: #991b1b;
    color: #fca5a5;
  }

  .audio-info {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: #d1fae5;
    border: 1px solid #a7f3d0;
    border-radius: 6px;
    color: #065f46;
    font-size: 0.9rem;
  }

  :global(.dark) .audio-info {
    background: #064e3b;
    border-color: #047857;
    color: #6ee7b7;
  }

  .info-icon {
    font-size: 1.1rem;
  }

  @media (max-width: 640px) {
    .controls {
      flex-direction: column;
    }

    .generate-btn,
    .playback-controls {
      width: 100%;
    }

    .playback-controls {
      justify-content: space-between;
    }

    .playback-btn {
      flex: 1;
      justify-content: center;
    }
  }
</style>

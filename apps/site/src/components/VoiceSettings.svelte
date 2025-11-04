<script lang="ts">
  import { onMount } from 'svelte';

  interface VoiceModel {
    id: string;
    name: string;
    language: string;
    quality: string;
    modelPath: string;
    configPath: string;
  }

  let voices: VoiceModel[] = [];
  let currentVoice: string = '';
  let speakingRate: number = 1.0;
  let loading = true;
  let saving = false;
  let error: string | null = null;
  let successMessage: string | null = null;
  let testText = 'Hello! This is a test of the text to speech system.';
  let testingVoice = false;
  let testAudio: HTMLAudioElement | null = null;

  async function loadSettings() {
    try {
      loading = true;
      const response = await fetch('/api/voice-settings');
      if (!response.ok) throw new Error('Failed to load voice settings');

      const data = await response.json();
      voices = data.voices || [];
      currentVoice = data.currentVoice || '';
      speakingRate = data.speakingRate || 1.0;
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[VoiceSettings] Error loading settings:', e);
    } finally {
      loading = false;
    }
  }

  async function saveSettings() {
    try {
      saving = true;
      successMessage = null;
      error = null;

      const response = await fetch('/api/voice-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: currentVoice,
          speakingRate,
        }),
      });

      if (!response.ok) throw new Error('Failed to save voice settings');

      const data = await response.json();
      successMessage = 'Voice settings saved successfully!';

      // Clear success message after 3 seconds
      setTimeout(() => {
        successMessage = null;
      }, 3000);
    } catch (e) {
      error = String(e);
      console.error('[VoiceSettings] Error saving settings:', e);
    } finally {
      saving = false;
    }
  }

  async function testVoice() {
    try {
      testingVoice = true;
      error = null;

      // Stop any currently playing audio
      if (testAudio) {
        testAudio.pause();
        testAudio = null;
      }

      // Find the selected voice details
      const selectedVoice = voices.find(v => v.id === currentVoice);
      if (!selectedVoice) {
        error = 'Please select a voice';
        testingVoice = false;
        return;
      }

      // Send TTS request with selected voice and speed
      const requestBody = {
        text: testText,
        model: selectedVoice.modelPath,
        config: selectedVoice.configPath,
        speakingRate: speakingRate,
      };
      console.log('[VoiceSettings] Sending TTS request:', requestBody);

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) throw new Error('Failed to generate test audio');

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      testAudio = new Audio(audioUrl);
      testAudio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        testingVoice = false;
      };
      testAudio.onerror = () => {
        error = 'Failed to play test audio';
        testingVoice = false;
      };

      await testAudio.play();
    } catch (e) {
      error = String(e);
      console.error('[VoiceSettings] Error testing voice:', e);
      testingVoice = false;
    }
  }

  onMount(() => {
    loadSettings();
  });

  $: selectedVoice = voices.find(v => v.id === currentVoice);
</script>

<div class="voice-settings">
  <h3 class="section-title">🎙️ Voice Settings</h3>

  {#if loading}
    <div class="loading">Loading voice settings...</div>
  {:else if error}
    <div class="error-message">{error}</div>
  {:else}
    {#if successMessage}
      <div class="success-message">{successMessage}</div>
    {/if}

    <!-- Voice Selection -->
    <div class="setting-group">
      <label for="voice-select">Voice Model</label>
      <select id="voice-select" bind:value={currentVoice} disabled={saving}>
        {#if voices.length === 0}
          <option value="">No voices available</option>
        {:else}
          {#each voices as voice}
            <option value={voice.id}>
              {voice.name} ({voice.language}) - {voice.quality}
            </option>
          {/each}
        {/if}
      </select>

      {#if selectedVoice}
        <div class="voice-details">
          <span class="detail-label">Language:</span> {selectedVoice.language} |
          <span class="detail-label">Quality:</span> {selectedVoice.quality}
        </div>
      {/if}
    </div>

    <!-- Speaking Rate -->
    <div class="setting-group">
      <label for="speaking-rate">Speaking Rate: {speakingRate.toFixed(2)}x</label>
      <input
        id="speaking-rate"
        type="range"
        min="0.5"
        max="2.0"
        step="0.05"
        bind:value={speakingRate}
        disabled={saving}
      />
      <div class="range-labels">
        <span>0.5x (Slower)</span>
        <span>1.0x (Normal)</span>
        <span>2.0x (Faster)</span>
      </div>
    </div>

    <!-- Test Voice -->
    <div class="setting-group">
      <label for="test-text">Test Voice</label>
      <textarea
        id="test-text"
        bind:value={testText}
        placeholder="Enter text to test the voice..."
        rows="3"
        disabled={testingVoice}
      ></textarea>
      <button
        class="test-button"
        on:click={testVoice}
        disabled={testingVoice || !testText.trim()}
      >
        {testingVoice ? '🔊 Playing...' : '🔊 Test Voice'}
      </button>
    </div>

    <!-- Save Button -->
    <div class="actions">
      <button
        class="save-button"
        on:click={saveSettings}
        disabled={saving || voices.length === 0}
      >
        {saving ? 'Saving...' : '💾 Save Settings'}
      </button>
    </div>

    <!-- Info Box -->
    <div class="info-box">
      <p><strong>ℹ️ About Piper Voices</strong></p>
      <p>
        Piper uses neural TTS models for natural-sounding speech. Place additional voice models
        (.onnx files) in <code>out/voices/</code> to make them available for selection.
      </p>
      <p>
        Download more voices from:
        <a href="https://github.com/rhasspy/piper/releases" target="_blank" rel="noopener">
          Piper Releases
        </a>
      </p>
    </div>
  {/if}
</div>

<style>
  .voice-settings {
    padding: 1.5rem;
    max-width: 700px;
  }

  .section-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: #1f2937;
    margin: 0 0 1.5rem 0;
  }

  :global(.dark) .section-title {
    color: #f3f4f6;
  }

  .loading {
    padding: 2rem;
    text-align: center;
    color: #6b7280;
  }

  .error-message {
    padding: 0.75rem 1rem;
    background: #fee2e2;
    border: 1px solid #ef4444;
    border-radius: 0.375rem;
    color: #dc2626;
    margin-bottom: 1rem;
  }

  :global(.dark) .error-message {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
  }

  .success-message {
    padding: 0.75rem 1rem;
    background: #d1fae5;
    border: 1px solid #10b981;
    border-radius: 0.375rem;
    color: #059669;
    margin-bottom: 1rem;
    animation: slideIn 0.3s ease-out;
  }

  :global(.dark) .success-message {
    background: rgba(16, 185, 129, 0.1);
    color: #34d399;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .setting-group {
    margin-bottom: 1.5rem;
  }

  label {
    display: block;
    font-weight: 500;
    color: #374151;
    margin-bottom: 0.5rem;
  }

  :global(.dark) label {
    color: #d1d5db;
  }

  select,
  textarea {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
  }

  :global(.dark) select,
  :global(.dark) textarea {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  select:focus,
  textarea:focus {
    outline: none;
    border-color: #7c3aed;
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }

  select:disabled,
  textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .voice-details {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: #6b7280;
  }

  :global(.dark) .voice-details {
    color: #9ca3af;
  }

  .detail-label {
    font-weight: 500;
  }

  input[type="range"] {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: #e5e7eb;
    outline: none;
    -webkit-appearance: none;
  }

  :global(.dark) input[type="range"] {
    background: #374151;
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #7c3aed;
    cursor: pointer;
  }

  input[type="range"]::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #7c3aed;
    cursor: pointer;
    border: none;
  }

  .range-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #6b7280;
    margin-top: 0.25rem;
  }

  :global(.dark) .range-labels {
    color: #9ca3af;
  }

  .test-button,
  .save-button {
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .test-button {
    background: #3b82f6;
    color: white;
    width: 100%;
    margin-top: 0.5rem;
  }

  .test-button:hover:not(:disabled) {
    background: #2563eb;
  }

  .test-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-button {
    background: #7c3aed;
    color: white;
    width: 100%;
  }

  .save-button:hover:not(:disabled) {
    background: #6d28d9;
  }

  .save-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .actions {
    margin-top: 2rem;
  }

  .info-box {
    margin-top: 2rem;
    padding: 1rem;
    background: #f3f4f6;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: #4b5563;
  }

  :global(.dark) .info-box {
    background: #1f2937;
    color: #d1d5db;
  }

  .info-box p {
    margin: 0 0 0.5rem 0;
  }

  .info-box p:last-child {
    margin-bottom: 0;
  }

  .info-box code {
    background: #e5e7eb;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: monospace;
  }

  :global(.dark) .info-box code {
    background: #374151;
  }

  .info-box a {
    color: #7c3aed;
    text-decoration: none;
  }

  .info-box a:hover {
    text-decoration: underline;
  }

  :global(.dark) .info-box a {
    color: #a78bfa;
  }
</style>

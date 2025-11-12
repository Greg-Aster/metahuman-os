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
  let provider: 'piper' | 'gpt-sovits' = 'piper';
  let sovitsServerUrl: string = 'http://127.0.0.1:9880';
  let sovitsSpeakerId: string = 'default';
  let sovitsTemperature: number = 0.6;
  let sovitsSpeed: number = 1.0;
  let sovitsAutoFallback: boolean = true;
  let loading = true;
  let saving = false;
  let error: string | null = null;
  let successMessage: string | null = null;
  let testText = 'Hello! This is a test of the text to speech system.';
  let testingVoice = false;
  let testAudio: HTMLAudioElement | null = null;
  let serverStatus: any = null;
  let checkingServer = false;
  let serverAction = '';

  async function loadSettings() {
    try {
      loading = true;
      const response = await fetch('/api/voice-settings');
      if (!response.ok) throw new Error('Failed to load voice settings');

      const data = await response.json();
      voices = data.voices || [];
      currentVoice = data.currentVoice || '';
      speakingRate = data.speakingRate || 1.0;
      provider = data.provider || 'piper';
      if (data.sovits) {
        sovitsServerUrl = data.sovits.serverUrl || 'http://127.0.0.1:9880';
        sovitsSpeakerId = data.sovits.speakerId || 'default';
        sovitsTemperature = data.sovits.temperature || 0.6;
        sovitsSpeed = data.sovits.speed || 1.0;
        sovitsAutoFallback = data.sovits.autoFallbackToPiper ?? true;
      }
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
          provider,
          voiceId: currentVoice,
          speakingRate,
          sovits: {
            serverUrl: sovitsServerUrl,
            speakerId: sovitsSpeakerId,
            temperature: sovitsTemperature,
            speed: sovitsSpeed,
            autoFallbackToPiper: sovitsAutoFallback,
          },
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

      // Check if GPT-SoVITS server is running when that provider is selected
      if (provider === 'gpt-sovits') {
        await checkServerStatus();
        if (!serverStatus?.running || !serverStatus?.healthy) {
          if (sovitsAutoFallback) {
            error = 'GPT-SoVITS server not available. Using Piper fallback...';
            // Will continue with Piper fallback
          } else {
            error = 'GPT-SoVITS server is not running. Please start the server first.';
            testingVoice = false;
            return;
          }
        }
      }

      // Find the selected voice details (for Piper)
      const selectedVoice = voices.find(v => v.id === currentVoice);
      if (provider === 'piper' && !selectedVoice) {
        error = 'Please select a voice';
        testingVoice = false;
        return;
      }

      // Send TTS request with selected provider and settings
      const requestBody = provider === 'piper'
        ? {
            text: testText,
            provider: 'piper',
            model: selectedVoice.modelPath,
            config: selectedVoice.configPath,
            speakingRate: speakingRate,
          }
        : {
            text: testText,
            provider: 'gpt-sovits',
            model: sovitsSpeakerId,
            speakingRate: sovitsSpeed,
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

  async function checkServerStatus() {
    if (provider !== 'gpt-sovits') return;

    try {
      checkingServer = true;
      const response = await fetch('/api/sovits-server');
      if (response.ok) {
        serverStatus = await response.json();
      }
    } catch (e) {
      console.error('[VoiceSettings] Error checking server status:', e);
    } finally {
      checkingServer = false;
    }
  }

  async function toggleServer(action: 'start' | 'stop') {
    try {
      serverAction = action;
      const response = await fetch('/api/sovits-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, port: 9880 }),
      });

      const result = await response.json();

      if (result.success) {
        successMessage = result.message || `Server ${action}ed successfully`;
        setTimeout(() => { successMessage = null; }, 3000);
      } else {
        error = result.error || `Failed to ${action} server`;
      }

      // Refresh status
      await checkServerStatus();
    } catch (e) {
      error = `Failed to ${action} server: ${String(e)}`;
    } finally {
      serverAction = '';
    }
  }

  onMount(() => {
    loadSettings();
  });

  $: selectedVoice = voices.find(v => v.id === currentVoice);
  $: if (provider === 'gpt-sovits') {
    checkServerStatus();
  }
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

    <!-- Provider Selection -->
    <div class="setting-group">
      <label>Voice Provider</label>
      <div class="provider-toggle">
        <button
          class="provider-button"
          class:active={provider === 'piper'}
          on:click={() => (provider = 'piper')}
          disabled={saving}
        >
          🎙️ Piper
        </button>
        <button
          class="provider-button"
          class:active={provider === 'gpt-sovits'}
          on:click={() => (provider = 'gpt-sovits')}
          disabled={saving}
        >
          🤖 GPT-SoVITS
        </button>
      </div>
    </div>

    {#if provider === 'piper'}
    <!-- Piper-Specific Settings -->
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
    {:else}
    <!-- GPT-SoVITS Settings -->
    <!-- Server Status -->
    <div class="setting-group server-status-section">
      <label>Server Status</label>
      {#if checkingServer}
        <div class="status-indicator checking">
          <span class="status-dot"></span>
          Checking server...
        </div>
      {:else if serverStatus}
        {#if serverStatus.running && serverStatus.healthy}
          <div class="status-indicator running">
            <span class="status-dot"></span>
            Running (PID: {serverStatus.pid})
          </div>
        {:else if serverStatus.running && !serverStatus.healthy}
          <div class="status-indicator warning">
            <span class="status-dot"></span>
            Process running but not responding
          </div>
        {:else if !serverStatus.installed}
          <div class="status-indicator error">
            <span class="status-dot"></span>
            Not installed - Install from Addons tab
          </div>
        {:else}
          <div class="status-indicator stopped">
            <span class="status-dot"></span>
            Stopped
          </div>
        {/if}
      {/if}

      <!-- Server Controls -->
      <div class="server-controls">
        {#if serverStatus?.running}
          <button
            class="server-control-btn stop"
            on:click={() => toggleServer('stop')}
            disabled={serverAction === 'stop'}
          >
            {serverAction === 'stop' ? '⏸️ Stopping...' : '⏹️ Stop Server'}
          </button>
        {:else if serverStatus?.installed}
          <button
            class="server-control-btn start"
            on:click={() => toggleServer('start')}
            disabled={serverAction === 'start'}
          >
            {serverAction === 'start' ? '▶️ Starting...' : '▶️ Start Server'}
          </button>
        {/if}
        <button
          class="server-control-btn refresh"
          on:click={checkServerStatus}
          disabled={checkingServer}
        >
          🔄 Refresh
        </button>
      </div>
    </div>

    <div class="setting-group">
      <label for="sovits-server">Server URL</label>
      <div class="url-input-group">
        <input
          id="sovits-server"
          type="text"
          bind:value={sovitsServerUrl}
          placeholder="http://127.0.0.1:9880"
          disabled={saving}
        />
        <a
          href={sovitsServerUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="url-link-btn"
          title="Open server URL in new tab"
        >
          🔗
        </a>
      </div>
    </div>

    <div class="setting-group">
      <label for="sovits-speaker">Speaker ID</label>
      <input
        id="sovits-speaker"
        type="text"
        bind:value={sovitsSpeakerId}
        placeholder="default"
        disabled={saving}
      />
    </div>

    <div class="setting-group">
      <label for="sovits-temperature">Temperature: {sovitsTemperature.toFixed(2)}</label>
      <input
        id="sovits-temperature"
        type="range"
        min="0.1"
        max="1.0"
        step="0.05"
        bind:value={sovitsTemperature}
        disabled={saving}
      />
      <div class="range-labels">
        <span>0.1 (Stable)</span>
        <span>0.6 (Balanced)</span>
        <span>1.0 (Creative)</span>
      </div>
    </div>

    <div class="setting-group">
      <label for="sovits-speed">Speed: {sovitsSpeed.toFixed(2)}x</label>
      <input
        id="sovits-speed"
        type="range"
        min="0.5"
        max="2.0"
        step="0.05"
        bind:value={sovitsSpeed}
        disabled={saving}
      />
      <div class="range-labels">
        <span>0.5x (Slower)</span>
        <span>1.0x (Normal)</span>
        <span>2.0x (Faster)</span>
      </div>
    </div>

    <div class="setting-group">
      <label class="checkbox-label">
        <input
          type="checkbox"
          bind:checked={sovitsAutoFallback}
          disabled={saving}
        />
        Auto-fallback to Piper if SoVITS unavailable
      </label>
    </div>
    {/if}

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
      {#if provider === 'piper'}
      <p><strong>ℹ️ About Piper</strong></p>
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
      {:else}
      <p><strong>ℹ️ About GPT-SoVITS</strong></p>
      <p>
        GPT-SoVITS is a few-shot voice cloning system that can generate natural-sounding speech
        with minimal training data (just 5-10 seconds of reference audio).
      </p>
      <p>
        <strong>Setup Steps:</strong>
      </p>
      <ol style="margin: 0.5rem 0; padding-left: 1.5rem;">
        <li>Install GPT-SoVITS from the <strong>Addons</strong> tab (if not already installed)</li>
        <li>Place reference audio files (WAV/MP3) in <code>out/voices/sovits/[speaker-id]/</code></li>
        <li>Start the server using the <strong>▶️ Start Server</strong> button above</li>
        <li>Test voice synthesis with your reference audio</li>
      </ol>
      <p>
        The <strong>Speaker ID</strong> determines which reference audio to use. For example,
        setting it to "john" will use audio from <code>out/voices/sovits/john/</code>.
      </p>
      <p>
        <strong>Performance Note:</strong> GPT-SoVITS requires significant VRAM (12GB+ recommended).
        Enable auto-fallback to Piper if the server becomes unavailable.
      </p>
      {/if}
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
  textarea,
  input[type="text"] {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: white;
    color: #1f2937;
  }

  :global(.dark) select,
  :global(.dark) textarea,
  :global(.dark) input[type="text"] {
    background: #1f2937;
    border-color: #374151;
    color: #f3f4f6;
  }

  select:focus,
  textarea:focus,
  input[type="text"]:focus {
    outline: none;
    border-color: #7c3aed;
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }

  select:disabled,
  textarea:disabled,
  input[type="text"]:disabled {
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

  .provider-toggle {
    display: flex;
    gap: 0.5rem;
  }

  .provider-button {
    flex: 1;
    padding: 0.625rem 1rem;
    border: 2px solid #d1d5db;
    border-radius: 0.375rem;
    background: white;
    color: #6b7280;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .provider-button {
    background: #1f2937;
    border-color: #374151;
    color: #9ca3af;
  }

  .provider-button:hover:not(:disabled) {
    border-color: #7c3aed;
    color: #7c3aed;
  }

  .provider-button.active {
    border-color: #7c3aed;
    background: #7c3aed;
    color: white;
  }

  :global(.dark) .provider-button.active {
    border-color: #7c3aed;
    background: #7c3aed;
    color: white;
  }

  .provider-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-weight: 400;
  }

  input[type="checkbox"] {
    width: auto;
    cursor: pointer;
  }

  input[type="checkbox"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Server Status Styles */
  .server-status-section {
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1rem;
    background: #f9fafb;
  }

  :global(.dark) .server-status-section {
    background: #111827;
    border-color: #374151;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 0.375rem;
    font-weight: 500;
    margin-bottom: 0.75rem;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  .status-indicator.running {
    background: #d1fae5;
    color: #065f46;
  }

  .status-indicator.running .status-dot {
    background: #10b981;
  }

  :global(.dark) .status-indicator.running {
    background: rgba(16, 185, 129, 0.1);
    color: #34d399;
  }

  .status-indicator.stopped {
    background: #f3f4f6;
    color: #6b7280;
  }

  .status-indicator.stopped .status-dot {
    background: #9ca3af;
  }

  :global(.dark) .status-indicator.stopped {
    background: rgba(107, 114, 128, 0.1);
    color: #9ca3af;
  }

  .status-indicator.warning {
    background: #fef3c7;
    color: #92400e;
  }

  .status-indicator.warning .status-dot {
    background: #f59e0b;
  }

  :global(.dark) .status-indicator.warning {
    background: rgba(245, 158, 11, 0.1);
    color: #fbbf24;
  }

  .status-indicator.error {
    background: #fee2e2;
    color: #991b1b;
  }

  .status-indicator.error .status-dot {
    background: #ef4444;
  }

  :global(.dark) .status-indicator.error {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
  }

  .status-indicator.checking {
    background: #e0e7ff;
    color: #3730a3;
  }

  .status-indicator.checking .status-dot {
    background: #6366f1;
  }

  :global(.dark) .status-indicator.checking {
    background: rgba(99, 102, 241, 0.1);
    color: #a5b4fc;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .server-controls {
    display: flex;
    gap: 0.5rem;
  }

  .server-control-btn {
    flex: 1;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .server-control-btn.start {
    background: #10b981;
    color: white;
  }

  .server-control-btn.start:hover:not(:disabled) {
    background: #059669;
  }

  .server-control-btn.stop {
    background: #ef4444;
    color: white;
  }

  .server-control-btn.stop:hover:not(:disabled) {
    background: #dc2626;
  }

  .server-control-btn.refresh {
    background: #6366f1;
    color: white;
  }

  .server-control-btn.refresh:hover:not(:disabled) {
    background: #4f46e5;
  }

  .server-control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .url-input-group {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .url-input-group input {
    flex: 1;
  }

  .url-link-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    background: #7c3aed;
    color: white;
    border-radius: 0.375rem;
    text-decoration: none;
    font-size: 1.125rem;
    transition: all 0.2s;
  }

  .url-link-btn:hover {
    background: #6d28d9;
    transform: scale(1.05);
  }

  :global(.dark) .url-link-btn {
    background: #7c3aed;
  }

  :global(.dark) .url-link-btn:hover {
    background: #6d28d9;
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import ServerStatusIndicator from './ServerStatusIndicator.svelte';

  interface VoiceConfig {
    provider: 'piper' | 'sovits' | 'rvc';
    piper?: {
      voices: { id: string; name: string; language: string; quality: string }[];
      currentVoice: string;
      speakingRate: number;
    };
    sovits?: {
      serverUrl: string;
      speakerId: string;
      temperature: number;
      speed: number;
      autoFallbackToPiper: boolean;
    };
    rvc?: {
      speakerId: string;
      pitchShift: number;
      speed: number;
      autoFallbackToPiper: boolean;
    };
  }

  let config: VoiceConfig | null = null;
  let loading = true;
  let saving = false;
  let error: string | null = null;
  let successMessage: string | null = null;
  let testText = 'Hello! This is a test of the text to speech system.';
  let testingVoice = false;
  let testAudio: HTMLAudioElement | null = null;

  // Provider metadata
  const providerInfo = {
    piper: {
      name: 'Piper TTS',
      icon: '🎙️',
      description: 'Fast, neural text-to-speech with multiple voice models',
      color: '#3b82f6',
    },
    sovits: {
      name: 'GPT-SoVITS',
      icon: '🤖',
      description: 'Few-shot voice cloning using reference audio',
      color: '#10b981',
    },
    rvc: {
      name: 'RVC',
      icon: '🎭',
      description: 'High-fidelity voice conversion with pitch control',
      color: '#8b5cf6',
    },
  };

  type Provider = keyof typeof providerInfo;
  type ProviderInfo = (typeof providerInfo)[Provider];
  const providerEntries = Object.entries(providerInfo) as [Provider, ProviderInfo][];

  async function loadSettings() {
    try {
      loading = true;
      const response = await fetch('/api/voice-settings');
      if (!response.ok) throw new Error('Failed to load voice settings');
      config = await response.json();
      error = null;
    } catch (e) {
      error = String(e);
      console.error('[VoiceSettings] Load error:', e);
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
        body: JSON.stringify(config),
      });

      if (!response.ok) throw new Error('Failed to save settings');

      successMessage = 'Settings saved successfully!';
      setTimeout(() => { successMessage = null; }, 3000);
    } catch (e) {
      error = String(e);
      console.error('[VoiceSettings] Save error:', e);
    } finally {
      saving = false;
    }
  }

  async function testVoice() {
    if (!config) return;

    try {
      testingVoice = true;
      error = null;

      if (testAudio) {
        testAudio.pause();
        testAudio = null;
      }

      let requestBody: any = { text: testText, provider: config.provider };

      if (config.provider === 'piper' && config.piper) {
        const voice = config.piper.voices.find(v => v.id === config.piper!.currentVoice);
        if (!voice) {
          error = 'Please select a voice';
          testingVoice = false;
          return;
        }
        // Use full model path instead of just ID
        requestBody.voiceId = voice.modelPath;
        requestBody.speakingRate = config.piper.speakingRate;
      } else if (config.provider === 'sovits' && config.sovits) {
        // TTS API expects voiceId, not speakerId
        requestBody.voiceId = config.sovits.speakerId;
        requestBody.speed = config.sovits.speed;
      } else if (config.provider === 'rvc' && config.rvc) {
        // TTS API expects voiceId, not speakerId
        requestBody.voiceId = config.rvc.speakerId;
        requestBody.pitchShift = config.rvc.pitchShift;
        requestBody.speed = config.rvc.speed;
      }

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) throw new Error('Failed to generate audio');

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      testAudio = new Audio(audioUrl);
      testAudio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        testingVoice = false;
      };
      testAudio.onerror = () => {
        error = 'Failed to play audio';
        testingVoice = false;
      };

      await testAudio.play();
    } catch (e) {
      error = String(e);
      console.error('[VoiceSettings] Test error:', e);
      testingVoice = false;
    }
  }

  function switchProvider(newProvider: Provider) {
    if (config) {
      config.provider = newProvider;
      config = config; // Trigger reactivity
    }
  }

  onMount(loadSettings);
</script>

<div class="voice-settings">
  <h3 class="section-title">🎙️ Voice Settings</h3>

  {#if loading}
    <div class="loading">Loading voice settings...</div>
  {:else if error}
    <div class="error-message">{error}</div>
  {:else if config}
    {#if successMessage}
      <div class="success-message">{successMessage}</div>
    {/if}

    <!-- Provider Selection -->
    <div class="setting-group">
      <label>Voice Provider</label>
      <div class="provider-grid">
        {#each providerEntries as [key, info]}
          <button
            class="provider-card"
            class:active={config.provider === key}
            style="--provider-color: {info.color}"
            on:click={() => switchProvider(key)}
            disabled={saving}
          >
            <div class="provider-icon">{info.icon}</div>
            <div class="provider-name">{info.name}</div>
            <div class="provider-desc">{info.description}</div>
          </button>
        {/each}
      </div>
    </div>

    <!-- Provider-Specific Settings -->
    {#if config.provider === 'piper' && config.piper}
      <div class="provider-settings">
        <h4>Piper Settings</h4>

        <div class="setting-group">
          <label for="piper-voice">Voice Model</label>
          <select id="piper-voice" bind:value={config.piper.currentVoice} disabled={saving}>
            {#each config.piper.voices as voice}
              <option value={voice.id}>{voice.name} ({voice.language})</option>
            {/each}
          </select>
        </div>

        <div class="setting-group">
          <label for="piper-rate">
            Speaking Rate: {config.piper.speakingRate.toFixed(2)}x
          </label>
          <input
            id="piper-rate"
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            bind:value={config.piper.speakingRate}
            disabled={saving}
          />
          <div class="range-labels">
            <span>Slower</span>
            <span>Normal</span>
            <span>Faster</span>
          </div>
        </div>
      </div>

    {:else if config.provider === 'sovits' && config.sovits}
      <div class="provider-settings">
        <h4>GPT-SoVITS Settings</h4>

        <div class="setting-group">
          <label>Server Status</label>
          <ServerStatusIndicator
            serverName="GPT-SoVITS"
            statusEndpoint="/api/sovits-server"
            controlEndpoint="/api/sovits-server"
            autoRefresh={true}
            refreshInterval={15000}
          />
        </div>

        <div class="setting-group">
          <label for="sovits-url">Server URL</label>
          <input
            id="sovits-url"
            type="text"
            bind:value={config.sovits.serverUrl}
            disabled={saving}
          />
        </div>

        <div class="setting-group">
          <label for="sovits-speaker">Speaker ID</label>
          <input
            id="sovits-speaker"
            type="text"
            bind:value={config.sovits.speakerId}
            placeholder="default"
            disabled={saving}
          />
        </div>

        <div class="setting-group">
          <label for="sovits-temp">
            Temperature: {config.sovits.temperature.toFixed(2)}
          </label>
          <input
            id="sovits-temp"
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            bind:value={config.sovits.temperature}
            disabled={saving}
          />
          <div class="range-labels">
            <span>Stable</span>
            <span>Balanced</span>
            <span>Creative</span>
          </div>
        </div>

        <div class="setting-group">
          <label for="sovits-speed">
            Speed: {config.sovits.speed.toFixed(2)}x
          </label>
          <input
            id="sovits-speed"
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            bind:value={config.sovits.speed}
            disabled={saving}
          />
          <div class="range-labels">
            <span>Slower</span>
            <span>Normal</span>
            <span>Faster</span>
          </div>
        </div>

        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={config.sovits.autoFallbackToPiper} disabled={saving} />
            Auto-fallback to Piper if unavailable
          </label>
        </div>
      </div>

    {:else if config.provider === 'rvc' && config.rvc}
      <div class="provider-settings">
        <h4>RVC Settings</h4>

        <div class="setting-group">
          <label for="rvc-speaker">Speaker ID</label>
          <input
            id="rvc-speaker"
            type="text"
            bind:value={config.rvc.speakerId}
            placeholder="default"
            disabled={saving}
          />
          <p class="hint">References voice model in profiles/[user]/out/voices/rvc/[speaker-id]/</p>
        </div>

        <div class="setting-group">
          <label for="rvc-pitch">
            Pitch Shift: {config.rvc.pitchShift > 0 ? '+' : ''}{config.rvc.pitchShift} semitones
          </label>
          <input
            id="rvc-pitch"
            type="range"
            min="-12"
            max="12"
            step="1"
            bind:value={config.rvc.pitchShift}
            disabled={saving}
          />
          <div class="range-labels">
            <span>-12 (Lower)</span>
            <span>0 (Normal)</span>
            <span>+12 (Higher)</span>
          </div>
        </div>

        <div class="setting-group">
          <label for="rvc-speed">
            Speed: {config.rvc.speed.toFixed(2)}x
          </label>
          <input
            id="rvc-speed"
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            bind:value={config.rvc.speed}
            disabled={saving}
          />
          <div class="range-labels">
            <span>Slower</span>
            <span>Normal</span>
            <span>Faster</span>
          </div>
        </div>

        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={config.rvc.autoFallbackToPiper} disabled={saving} />
            Auto-fallback to Piper if model unavailable
          </label>
        </div>
      </div>
    {/if}

    <!-- Test Voice -->
    <div class="test-section">
      <label for="test-text">Test Text</label>
      <textarea
        id="test-text"
        bind:value={testText}
        rows="2"
        placeholder="Enter text to test the voice..."
        disabled={testingVoice || saving}
      ></textarea>
      <button
        class="test-button"
        on:click={testVoice}
        disabled={testingVoice || saving}
      >
        {testingVoice ? '🔊 Playing...' : '▶️ Test Voice'}
      </button>
    </div>

    <!-- Actions -->
    <div class="actions">
      <button class="save-button" on:click={saveSettings} disabled={saving}>
        {saving ? 'Saving...' : '💾 Save Settings'}
      </button>
    </div>
  {/if}
</div>

<style>
  .voice-settings {
    padding: 1.5rem;
    max-width: 800px;
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
    border-radius: 0.5rem;
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
    border-radius: 0.5rem;
    color: #059669;
    margin-bottom: 1rem;
  }

  :global(.dark) .success-message {
    background: rgba(16, 185, 129, 0.1);
    color: #34d399;
  }

  .setting-group {
    margin-bottom: 1.5rem;
  }

  label {
    display: block;
    font-weight: 500;
    color: #374151;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  :global(.dark) label {
    color: #d1d5db;
  }

  .provider-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .provider-card {
    padding: 1.25rem;
    border: 2px solid #e5e7eb;
    border-radius: 0.75rem;
    background: white;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
  }

  :global(.dark) .provider-card {
    background: #1f2937;
    border-color: #374151;
  }

  .provider-card:hover:not(:disabled) {
    border-color: var(--provider-color);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .provider-card.active {
    border-color: var(--provider-color);
    background: linear-gradient(135deg, rgba(124, 58, 237, 0.15), transparent);
  }

  :global(.dark) .provider-card.active {
    background: linear-gradient(135deg, rgba(124, 58, 237, 0.25), transparent);
  }

  .provider-card:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .provider-icon {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }

  .provider-name {
    font-weight: 600;
    color: #1f2937;
    margin-bottom: 0.25rem;
  }

  :global(.dark) .provider-name {
    color: #f3f4f6;
  }

  .provider-desc {
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .provider-desc {
    color: #9ca3af;
  }

  .provider-settings {
    background: #f9fafb;
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .provider-settings {
    background: #111827;
  }

  .provider-settings h4 {
    margin: 0 0 1rem 0;
    font-size: 1.125rem;
    color: #1f2937;
  }

  :global(.dark) .provider-settings h4 {
    color: #f3f4f6;
  }

  select,
  textarea,
  input[type="text"] {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid #d1d5db;
    border-radius: 0.5rem;
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

  .hint {
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: #6b7280;
  }

  :global(.dark) .hint {
    color: #9ca3af;
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

  .test-section {
    background: #f3f4f6;
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  :global(.dark) .test-section {
    background: #1f2937;
  }

  .test-button,
  .save-button {
    width: 100%;
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .test-button {
    background: #3b82f6;
    color: white;
    margin-top: 0.75rem;
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
  }

  .save-button:hover:not(:disabled) {
    background: #6d28d9;
  }

  .save-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .actions {
    margin-top: 1.5rem;
  }
</style>

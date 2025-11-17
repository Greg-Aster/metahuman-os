<script lang="ts">
  import { onMount } from 'svelte';
  import ServerStatusIndicator from './ServerStatusIndicator.svelte';

  interface PiperVoice {
    id: string;
    name: string;
    language: string;
    quality: string;
    modelPath: string;
    configPath: string;
  }

  interface KokoroVoice {
    id: string;
    name: string;
    lang: string;
    gender: string;
    quality: string;
  }

  interface VoiceConfig {
    provider: 'piper' | 'sovits' | 'rvc' | 'kokoro';
    piper?: {
      voices: PiperVoice[];
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
      indexRate?: number;
      volumeEnvelope?: number;
      protect?: number;
      f0Method?: string;
      device?: 'cuda' | 'cpu';
    };
    kokoro?: {
      langCode: string;
      voice: string;
      speed: number;
      autoFallbackToPiper: boolean;
      useCustomVoicepack: boolean;
      voices?: KokoroVoice[];
      device?: 'cuda' | 'cpu';
    };
    stt?: {
      model: string;
      device: 'cpu' | 'cuda';
      computeType: 'int8' | 'float16' | 'float32';
      language: string;
      useServer: boolean;
      autoStart: boolean;
      serverStatus?: string;
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
  let generatingReference = false;

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
    kokoro: {
      name: 'Kokoro TTS',
      icon: '🫀',
      description: '54 pre-built voices across 8 languages (StyleTTS2)',
      color: '#f59e0b',
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

      // Set RVC defaults if not present
      if (config && config.rvc) {
        config.rvc.indexRate = config.rvc.indexRate ?? 1.0;
        config.rvc.volumeEnvelope = config.rvc.volumeEnvelope ?? 0.0;
        config.rvc.protect = config.rvc.protect ?? 0.15;
        config.rvc.f0Method = config.rvc.f0Method || 'rmvpe';
        config.rvc.device = config.rvc.device || 'cuda';
      }

      if (config && config.kokoro) {
        config.kokoro.device = config.kokoro.device || 'cpu';
      }

      // Set STT defaults if not present
      if (config && config.stt) {
        config.stt.model = config.stt.model || 'base.en';
        config.stt.device = config.stt.device || 'cpu';
        config.stt.computeType = config.stt.computeType || 'int8';
        config.stt.language = config.stt.language || 'en';
        config.stt.useServer = config.stt.useServer ?? true;
        config.stt.autoStart = config.stt.autoStart ?? true;
        config.stt.serverStatus = config.stt.serverStatus || 'unknown';
      }

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

      console.log('[VoiceSettings] Saving config:', { provider: config?.provider });

      const response = await fetch('/api/voice-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save settings');
      }

      successMessage = result.message || 'Settings saved successfully!';
      setTimeout(() => { successMessage = null; }, 5000);
    } catch (e) {
      error = String(e);
      console.error('[VoiceSettings] Save error:', e);
    } finally {
      saving = false;
    }
  }

  async function generateReference() {
    if (!config || config.provider !== 'sovits') return;

    try {
      generatingReference = true;
      successMessage = null;
      error = null;

      const response = await fetch('/api/sovits-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-reference-latest',
          provider: 'gpt-sovits',
          speakerId: config.sovits?.speakerId || 'default',
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate reference audio');
      }

      successMessage = result.message || 'Reference audio regenerated successfully!';
      setTimeout(() => { successMessage = null; }, 5000);
    } catch (e) {
      error = String(e);
      console.error('[VoiceSettings] Generate reference error:', e);
    } finally {
      generatingReference = false;
    }
  }

  async function testVoice(forceProvider?: Provider) {
    if (!config) return;

    // Use explicit provider or fall back to current selection
    const providerToTest = forceProvider || config.provider;

    try {
      testingVoice = true;
      error = null;

      if (testAudio) {
        testAudio.pause();
        testAudio = null;
      }

      console.log('[VoiceSettings] Testing voice with provider:', providerToTest);
      let requestBody: any = { text: testText, provider: providerToTest };

      if (providerToTest === 'piper' && config.piper) {
        const voice = config.piper.voices.find(v => v.id === config.piper!.currentVoice);
        if (!voice) {
          error = 'Please select a voice';
          testingVoice = false;
          return;
        }
        // Use full model path instead of just ID
        requestBody.voiceId = voice.modelPath;
        requestBody.speakingRate = config.piper.speakingRate;
      } else if (providerToTest === 'sovits' && config.sovits) {
        // TTS API expects voiceId, not speakerId
        requestBody.voiceId = config.sovits.speakerId;
        requestBody.speed = config.sovits.speed;
      } else if (providerToTest === 'rvc' && config.rvc) {
        // TTS API expects voiceId, not speakerId
        requestBody.voiceId = config.rvc.speakerId;
        requestBody.pitchShift = config.rvc.pitchShift;
        requestBody.speed = config.rvc.speed;
      } else if (providerToTest === 'kokoro' && config.kokoro) {
        // Kokoro-specific parameters
        requestBody.voiceId = config.kokoro.voice;  // e.g., 'af_heart', 'af_bella'
        requestBody.langCode = config.kokoro.langCode;  // e.g., 'a' for auto-detect
        requestBody.speed = config.kokoro.speed;  // 0.5-2.0
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
      console.log('[VoiceSettings] Switching provider:', config.provider, '→', newProvider);
      config = { ...config, provider: newProvider }; // Create new object to trigger reactivity
      console.log('[VoiceSettings] Provider switched. Current:', config.provider);
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

        <!-- Piper Test Section -->
        <div class="provider-test-section">
          <label for="piper-test-text">Test Piper Voice</label>
          <textarea
            id="piper-test-text"
            bind:value={testText}
            rows="2"
            placeholder="Enter text to test Piper..."
            disabled={testingVoice || saving}
          ></textarea>
          <button
            class="test-button piper-test"
            on:click={() => testVoice('piper')}
            disabled={testingVoice || saving}
          >
            {testingVoice ? '🔊 Playing...' : '▶️ Test Piper'}
          </button>
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

        <div class="setting-group">
          <label>Reference Audio Management</label>
          <p class="hint">Generate reference.wav from the latest recorded sample in your voice profile.</p>
          <button
            class="btn-generate-reference"
            on:click={generateReference}
            disabled={generatingReference || saving}
          >
            {generatingReference ? '🔄 Generating...' : '🎯 Generate Reference Audio'}
          </button>
        </div>

        <!-- SoVITS Test Section -->
        <div class="provider-test-section">
          <label for="sovits-test-text">Test Cloned Voice</label>
          <textarea
            id="sovits-test-text"
            bind:value={testText}
            rows="2"
            placeholder="Enter text to test your cloned voice..."
            disabled={testingVoice || saving}
          ></textarea>
          <button
            class="test-button sovits-test"
            on:click={() => testVoice('sovits')}
            disabled={testingVoice || saving}
          >
            {testingVoice ? '🔊 Playing...' : '▶️ Test SoVITS'}
          </button>
        </div>
      </div>

    {:else if config.provider === 'rvc' && config.rvc}
      <div class="provider-settings">
        <h4>RVC Settings</h4>

        <div class="setting-group">
          <label>Server Status</label>
          <ServerStatusIndicator
            serverName="RVC"
            statusEndpoint="/api/rvc-server"
            controlEndpoint="/api/rvc-server"
            autoRefresh={true}
            refreshInterval={15000}
          />
        </div>

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

        <!-- Advanced Quality Settings -->
        <div class="advanced-settings">
          <h5 style="margin: 1rem 0 0.5rem 0; color: #6b7280; font-size: 0.875rem;">⚙️ Advanced Quality Settings</h5>

          <div class="setting-group">
            <label for="rvc-index-rate">
              Index Rate: {(config.rvc.indexRate ?? 1.0).toFixed(2)}
            </label>
            <input
              id="rvc-index-rate"
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              bind:value={config.rvc.indexRate}
              disabled={saving}
            />
            <p class="hint">Voice retrieval strength (higher = more voice characteristics, 1.0 recommended)</p>
          </div>

          <div class="setting-group">
            <label for="rvc-volume-envelope">
              Volume Envelope: {(config.rvc.volumeEnvelope ?? 0.0).toFixed(2)}
            </label>
            <input
              id="rvc-volume-envelope"
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              bind:value={config.rvc.volumeEnvelope}
              disabled={saving}
            />
            <p class="hint">RMS mix rate (0.0 = pure conversion, 1.0 = blend with original)</p>
          </div>

          <div class="setting-group">
            <label for="rvc-protect">
              Consonant Protection: {(config.rvc.protect ?? 0.15).toFixed(2)}
            </label>
            <input
              id="rvc-protect"
              type="range"
              min="0.0"
              max="0.5"
              step="0.01"
              bind:value={config.rvc.protect}
              disabled={saving}
            />
            <p class="hint">Protect voiceless consonants (0.15-0.20 recommended for clarity)</p>
          </div>

          <div class="setting-group">
            <label for="rvc-f0-method">Pitch Detection Method</label>
            <select
              id="rvc-f0-method"
              bind:value={config.rvc.f0Method}
              disabled={saving}
            >
              <option value="rmvpe">RMVPE (Recommended)</option>
              <option value="crepe">CREPE (High Quality)</option>
              <option value="harvest">Harvest (Fast)</option>
              <option value="dio">DIO (Fastest)</option>
            </select>
            <p class="hint">RMVPE is the most accurate for most voices</p>
          </div>

          <div class="setting-group">
            <label for="rvc-device">Device for Inference</label>
            <select
              id="rvc-device"
              bind:value={config.rvc.device}
              disabled={saving}
            >
              <option value="cuda">GPU (CUDA) - Faster</option>
              <option value="cpu">CPU - Slower, no GPU conflicts</option>
            </select>
            <p class="hint" style="color: #f59e0b; font-weight: 500;">
              ⚠️ Restart server required: Device changes only take effect after restarting the RVC server (use the restart button in Server Status above).
            </p>
            <p class="hint">
              CPU mode eliminates GPU VRAM conflicts with Ollama but is 10-40x slower.
              Recommended: GPU (CUDA) for conversation, CPU only if GPU unavailable.
            </p>
          </div>

          <div class="quality-tips">
            <strong>💡 Quality Tips:</strong>
            <ul>
              <li>For grainy voice: Keep Index Rate at 1.0, Volume Envelope at 0.0</li>
              <li>For robotic voice: Increase Consonant Protection to 0.20-0.25</li>
              <li>For muffled voice: Decrease Consonant Protection to 0.10-0.15</li>
              <li>Test after each adjustment to hear the difference</li>
            </ul>
          </div>
        </div>

        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={config.rvc.autoFallbackToPiper} disabled={saving} />
            Auto-fallback to Piper if model unavailable
          </label>
        </div>

        <!-- RVC Test Section -->
        <div class="provider-test-section">
          <label for="rvc-test-text">Test RVC Voice</label>
          <textarea
            id="rvc-test-text"
            bind:value={testText}
            rows="2"
            placeholder="Enter text to test RVC voice conversion..."
            disabled={testingVoice || saving}
          ></textarea>
          <button
            class="test-button rvc-test"
            on:click={() => testVoice('rvc')}
            disabled={testingVoice || saving}
          >
            {testingVoice ? '🔊 Playing...' : '▶️ Test RVC'}
          </button>
        </div>
      </div>

    {:else if config.provider === 'kokoro' && config.kokoro}
      <div class="provider-settings">
        <h4>Kokoro TTS Settings</h4>

        <div class="setting-group">
          <label>Server Status</label>
          <ServerStatusIndicator
            serverName="Kokoro"
            statusEndpoint="/api/kokoro-server"
            controlEndpoint="/api/kokoro-server"
            autoRefresh={true}
            refreshInterval={15000}
          />
        </div>

        <div class="setting-group">
          <label for="kokoro-voice">Voice</label>
          <select id="kokoro-voice" bind:value={config.kokoro.voice} disabled={saving}>
            {#if config.kokoro.voices && config.kokoro.voices.length > 0}
              {#each config.kokoro.voices as voice}
                <option value={voice.id}>
                  {voice.name} ({voice.lang}, {voice.gender}, {voice.quality})
                </option>
              {/each}
            {:else}
              <option value="af_heart">Heart (English, Female, High)</option>
              <option value="af_bella">Bella (English, Female, High)</option>
              <option value="af_sarah">Sarah (English, Female, High)</option>
              <option value="am_adam">Adam (English, Male, High)</option>
              <option value="am_michael">Michael (English, Male, High)</option>
            {/if}
          </select>
          <p class="hint">Choose from 54 built-in voices across 8 languages</p>
        </div>

        <div class="setting-group">
          <label for="kokoro-lang">Language Code</label>
          <select id="kokoro-lang" bind:value={config.kokoro.langCode} disabled={saving}>
            <option value="a">Auto-detect</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="ko">Korean</option>
          </select>
          <p class="hint">Language for text processing (auto-detect recommended)</p>
        </div>

        <div class="setting-group">
          <label for="kokoro-speed">
            Speed: {config.kokoro.speed.toFixed(2)}x
          </label>
          <input
            id="kokoro-speed"
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            bind:value={config.kokoro.speed}
            disabled={saving}
          />
          <div class="range-labels">
            <span>Slower</span>
            <span>Normal</span>
            <span>Faster</span>
          </div>
        </div>

        <div class="setting-group">
          <label for="kokoro-device">Device for Inference</label>
          <select
            id="kokoro-device"
            bind:value={config.kokoro.device}
            disabled={saving}
          >
            <option value="cpu">CPU - Fast & no GPU conflicts</option>
            <option value="cuda">GPU (CUDA) - Faster (requires GPU)</option>
          </select>
          <p class="hint">Kokoro is optimized for CPU inference. GPU recommended only if CPU is slow.</p>
        </div>

        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={config.kokoro.useCustomVoicepack} disabled={saving} />
            Use custom trained voicepack (not yet implemented)
          </label>
          <p class="hint">Custom voice training requires StyleTTS2 fine-tuning</p>
        </div>

        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={config.kokoro.autoFallbackToPiper} disabled={saving} />
            Auto-fallback to Piper if unavailable
          </label>
        </div>

        <!-- Kokoro Test Section -->
        <div class="provider-test-section">
          <label for="kokoro-test-text">Test Kokoro Voice</label>
          <textarea
            id="kokoro-test-text"
            bind:value={testText}
            rows="2"
            placeholder="Enter text to test Kokoro synthesis..."
            disabled={testingVoice || saving}
          ></textarea>
          <button
            class="test-button kokoro-test"
            on:click={() => testVoice('kokoro')}
            disabled={testingVoice || saving}
          >
            {testingVoice ? '🔊 Playing...' : '▶️ Test Kokoro'}
          </button>
        </div>
      </div>
    {/if}

    <!-- STT (Speech-to-Text) Settings -->
    {#if config.stt}
      <div class="stt-section">
        <h4 class="subsection-title">🎤 Speech-to-Text (Whisper)</h4>

        <div class="setting-group">
          <label>Model Size</label>
          <select bind:value={config.stt.model} disabled={saving}>
            <option value="tiny.en">Tiny (~75MB, fastest)</option>
            <option value="base.en">Base (~140MB, balanced)</option>
            <option value="small.en">Small (~460MB, more accurate)</option>
            <option value="medium.en">Medium (~1.5GB, most accurate)</option>
          </select>
          <p class="hint">Smaller models are faster but less accurate. GPU recommended for medium/large models.</p>
        </div>

        <div class="setting-group">
          <label>Processing Device</label>
          <select bind:value={config.stt.device} disabled={saving}>
            <option value="cpu">CPU</option>
            <option value="cuda">GPU (CUDA)</option>
          </select>
          <p class="hint">GPU processing is 10-50x faster than CPU. Requires NVIDIA GPU with CUDA support.</p>
        </div>

        <div class="setting-group">
          <label>Compute Type</label>
          <select bind:value={config.stt.computeType} disabled={saving}>
            <option value="int8">INT8 (fastest, CPU-friendly)</option>
            <option value="float16">FLOAT16 (balanced, GPU-optimized)</option>
            <option value="float32">FLOAT32 (highest precision)</option>
          </select>
          <p class="hint">Use INT8 for CPU, FLOAT16 for GPU. FLOAT32 only if precision is critical.</p>
        </div>

        <div class="setting-group">
          <label>Language</label>
          <select bind:value={config.stt.language} disabled={saving}>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="it">Italian</option>
            <option value="pt">Portuguese</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
            <option value="zh">Chinese</option>
          </select>
        </div>

        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={config.stt.useServer} disabled={saving} />
            Use persistent Whisper server (recommended)
          </label>
          <p class="hint">Persistent server keeps model in memory for instant transcription (~1-3 second speedup per request)</p>
        </div>

        {#if config.stt.useServer}
          <div class="setting-group">
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={config.stt.autoStart} disabled={saving} />
              Auto-start server on boot
            </label>
            <p class="hint">Automatically start Whisper server when MetaHuman starts</p>
          </div>

          <div class="setting-group">
            <label>Server Status</label>
            <ServerStatusIndicator
              serverName="Whisper STT"
              statusEndpoint="/api/whisper-server"
              controlEndpoint="/api/whisper-server"
              autoRefresh={true}
              refreshInterval={15000}
            />
          </div>
        {/if}
      </div>
    {/if}

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

  .btn-generate-reference {
    width: 100%;
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    background: #10b981;
    color: white;
    margin-top: 0.5rem;
  }

  .btn-generate-reference:hover:not(:disabled) {
    background: #059669;
  }

  .btn-generate-reference:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .provider-test-section {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 2px solid #e5e7eb;
  }

  :global(.dark) .provider-test-section {
    border-top-color: #374151;
  }

  .provider-test-section label {
    font-size: 0.95rem;
    font-weight: 600;
    color: #1f2937;
  }

  :global(.dark) .provider-test-section label {
    color: #f3f4f6;
  }

  .test-button.piper-test {
    background: #3b82f6;
  }

  .test-button.piper-test:hover:not(:disabled) {
    background: #2563eb;
  }

  .test-button.sovits-test {
    background: #10b981;
  }

  .test-button.sovits-test:hover:not(:disabled) {
    background: #059669;
  }

  .test-button.rvc-test {
    background: #8b5cf6;
  }

  .test-button.rvc-test:hover:not(:disabled) {
    background: #7c3aed;
  }

  /* Advanced settings section */
  .advanced-settings {
    margin: 1.5rem 0;
    padding: 1rem;
    background: #f9fafb;
    border-radius: 0.5rem;
    border: 1px solid #e5e7eb;
  }

  :global(.dark) .advanced-settings {
    background: #111827;
    border-color: #374151;
  }

  .advanced-settings h5 {
    margin: 0.5rem 0;
    color: #6b7280;
    font-size: 0.875rem;
    font-weight: 600;
  }

  :global(.dark) .advanced-settings h5 {
    color: #9ca3af;
  }

  .quality-tips {
    margin-top: 1rem;
    padding: 0.75rem;
    background: #eff6ff;
    border-left: 3px solid #3b82f6;
    border-radius: 0.25rem;
    font-size: 0.875rem;
  }

  :global(.dark) .quality-tips {
    background: #1e3a5f;
    border-color: #60a5fa;
  }

  .quality-tips strong {
    color: #1f2937;
  }

  :global(.dark) .quality-tips strong {
    color: #f3f4f6;
  }

  .quality-tips ul {
    margin: 0.5rem 0 0 0;
    padding-left: 1.25rem;
    color: #374151;
  }

  :global(.dark) .quality-tips ul {
    color: #d1d5db;
  }

  .quality-tips li {
    margin: 0.25rem 0;
  }

  /* STT Section Styles */
  .stt-section {
    margin-top: 2rem;
    padding: 1.5rem;
    background: #f9fafb;
    border: 2px solid #e5e7eb;
    border-radius: 0.75rem;
  }

  :global(.dark) .stt-section {
    background: #1f2937;
    border-color: #374151;
  }

  .subsection-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: #1f2937;
    margin: 0 0 1.25rem 0;
  }

  :global(.dark) .subsection-title {
    color: #f3f4f6;
  }
</style>

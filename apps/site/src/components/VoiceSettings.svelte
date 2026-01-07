<script lang="ts">
  import { onMount } from 'svelte';
  import { calculateVoiceVolume } from '../lib/client/utils/audio-utils.js';
  import { apiFetch } from '../lib/client/api-config';
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
    isCustom?: boolean;
    voicepackPath?: string;
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
      speakers?: Array<{id: string; name: string; hasModel: boolean; hasIndex: boolean}>;
    };
    kokoro?: {
      langCode: string;
      voice: string;
      speed: number;
      autoFallbackToPiper: boolean;
      useCustomVoicepack: boolean;
      normalizeCustomVoicepacks?: boolean;
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
      vad?: {
        voiceThreshold: number;
        silenceDelay: number;
        minDuration: number;
      };
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
  let isGuest = false;

  let hardwareButtonsEnabled = false;
  let nativeVoiceModeEnabled = false;
  let isCapacitorApp = false;

  let vadTestRecording = false;
  let vadTestVolume = 0;
  let vadTestSpeaking = false;
  let vadTestTranscription = '';
  let vadTestError: string | null = null;
  let vadMediaRecorder: MediaRecorder | null = null;
  let vadAudioChunks: Blob[] = [];
  let vadAnalyser: AnalyserNode | null = null;
  let vadSilenceTimer: number | null = null;
  let vadStartTime: number | null = null;

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
      isCapacitorApp = typeof window !== 'undefined' &&
        !!(window as any).Capacitor &&
        (window as any).Capacitor.isNativePlatform?.() === true;

      hardwareButtonsEnabled = localStorage.getItem('mh-hardware-buttons') === 'true';
      nativeVoiceModeEnabled = localStorage.getItem('mh-native-voice-mode') === 'true';

      const response = await apiFetch('/api/voice-settings');
      if (!response.ok) throw new Error('Failed to load voice settings');
      config = await response.json();
      isGuest = false;

      if (config && config.rvc) {
        config.rvc.indexRate = config.rvc.indexRate ?? 1.0;
        config.rvc.volumeEnvelope = config.rvc.volumeEnvelope ?? 0.0;
        config.rvc.protect = config.rvc.protect ?? 0.15;
        config.rvc.f0Method = config.rvc.f0Method || 'rmvpe';
        config.rvc.device = config.rvc.device || 'cuda';
      }

      if (config && config.kokoro) {
        config.kokoro.device = config.kokoro.device || 'cpu';
        config.kokoro.normalizeCustomVoicepacks = config.kokoro.normalizeCustomVoicepacks ?? true;
      }

      if (config && config.stt) {
        config.stt.model = config.stt.model || 'base.en';
        config.stt.device = config.stt.device || 'cpu';
        config.stt.computeType = config.stt.computeType || 'int8';
        config.stt.language = config.stt.language || 'en';
        config.stt.useServer = config.stt.useServer ?? true;
        config.stt.autoStart = config.stt.autoStart ?? true;
        config.stt.serverStatus = config.stt.serverStatus || 'unknown';
        config.stt.vad = config.stt.vad ?? {
          voiceThreshold: 12,
          silenceDelay: 5000,
          minDuration: 500,
        };
      }

      error = null;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function saveSettings() {
    try {
      saving = true;
      successMessage = null;
      error = null;

      const response = await apiFetch('/api/voice-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.error?.includes('Authentication required')) {
          isGuest = true;
          error = "We apologize! You're viewing this profile as a guest and can't save settings. You can still test the voice to hear how it sounds! 🎙️";
          throw new Error(error);
        }
        throw new Error(result.error || 'Failed to save settings');
      }

      successMessage = result.message || 'Settings saved successfully!';
      setTimeout(() => { successMessage = null; }, 5000);
      window.dispatchEvent(new CustomEvent('voice-settings-updated'));
    } catch (e) {
      if (!error) error = String(e);
    } finally {
      saving = false;
    }
  }

  async function generateReference() {
    if (!config || config.provider !== 'sovits') return;
    if (isGuest) {
      error = "We apologize! You're viewing this profile as a guest and can't modify voice settings. Only the profile owner can generate reference audio. 🎙️";
      return;
    }

    try {
      generatingReference = true;
      successMessage = null;
      error = null;

      const response = await apiFetch('/api/sovits-training', {
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
        if (result.error?.includes('Authentication required')) {
          isGuest = true;
          error = "We apologize! You're viewing this profile as a guest and can't modify voice settings. Only the profile owner can generate reference audio. 🎙️";
          return;
        }
        throw new Error(result.error || 'Failed to generate reference audio');
      }

      successMessage = result.message || 'Reference audio regenerated successfully!';
      setTimeout(() => { successMessage = null; }, 5000);
    } catch (e) {
      if (!error) error = String(e);
    } finally {
      generatingReference = false;
    }
  }

  async function testVoiceStreaming(requestBody: any): Promise<void> {
    const response = await apiFetch('/api/tts-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) throw new Error('Failed to start streaming audio');
    if (!response.body) throw new Error('No response body for streaming');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const audioQueue: HTMLAudioElement[] = [];
    let currentAudioIndex = 0;
    let isPlaying = false;
    let streamComplete = false;

    const playNext = () => {
      if (currentAudioIndex >= audioQueue.length) {
        if (streamComplete) testingVoice = false;
        return;
      }

      isPlaying = true;
      const audio = audioQueue[currentAudioIndex];
      audio.onended = () => {
        URL.revokeObjectURL(audio.src);
        currentAudioIndex++;
        isPlaying = false;
        playNext();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audio.src);
        currentAudioIndex++;
        isPlaying = false;
        playNext();
      };
      audio.play().catch(() => {
        currentAudioIndex++;
        isPlaying = false;
        playNext();
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        if (!event.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(event.slice(6));

          if (data.event === 'complete') {
            streamComplete = true;
            if (!isPlaying && currentAudioIndex >= audioQueue.length) testingVoice = false;
            continue;
          }

          if (data.event === 'error') throw new Error(data.error);

          if (data.audio_base64) {
            const audioBytes = Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
            const audioBlob = new Blob([audioBytes], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audioQueue.push(audio);
            if (!isPlaying) playNext();
          }
        } catch (e) {
          console.warn('[VoiceSettings] Error parsing SSE event:', e);
        }
      }
    }
  }

  async function testVoice(forceProvider?: Provider) {
    if (!config) return;
    const providerToTest = forceProvider || config.provider;

    try {
      testingVoice = true;
      error = null;

      if (testAudio) {
        testAudio.pause();
        testAudio = null;
      }

      const cacheBustedText = `${testText} [${Date.now()}]`;
      let requestBody: any = { text: cacheBustedText, provider: providerToTest };
      const useStreaming = providerToTest === 'rvc' || providerToTest === 'kokoro';

      if (providerToTest === 'piper' && config.piper) {
        const voice = config.piper.voices.find(v => v.id === config.piper!.currentVoice);
        if (!voice) {
          error = 'Please select a voice';
          testingVoice = false;
          return;
        }
        requestBody.voiceId = voice.modelPath;
        requestBody.speakingRate = config.piper.speakingRate;
      } else if (providerToTest === 'sovits' && config.sovits) {
        requestBody.voiceId = config.sovits.speakerId;
        requestBody.speed = config.sovits.speed;
      } else if (providerToTest === 'rvc' && config.rvc) {
        requestBody.voiceId = config.rvc.speakerId;
        requestBody.pitchShift = config.rvc.pitchShift;
        requestBody.speed = config.rvc.speed;
      } else if (providerToTest === 'kokoro' && config.kokoro) {
        if (config.kokoro.voice.startsWith('custom_')) {
          try {
            await saveSettings();
          } catch (e) {
            const errorMsg = String(e);
            if (!errorMsg.includes('Authentication required')) {
              error = 'Failed to save custom voicepack settings before testing';
              testingVoice = false;
              return;
            }
            isGuest = true;
          }
          requestBody.langCode = config.kokoro.langCode;
          requestBody.speed = config.kokoro.speed;
        } else {
          requestBody.voiceId = config.kokoro.voice;
          requestBody.langCode = config.kokoro.langCode;
          requestBody.speed = config.kokoro.speed;
        }
      }

      if (useStreaming) {
        await testVoiceStreaming(requestBody);
        return;
      }

      const response = await apiFetch('/api/tts', {
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
      testingVoice = false;
    }
  }

  function switchProvider(newProvider: Provider) {
    if (config) {
      config = { ...config, provider: newProvider };
    }
  }

  async function startVADTest() {
    if (!config?.stt?.vad) return;

    try {
      vadTestError = null;
      vadTestTranscription = '';
      vadTestSpeaking = false;
      vadTestVolume = 0;
      vadAudioChunks = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      vadAnalyser = audioContext.createAnalyser();
      vadAnalyser.fftSize = 2048;
      vadAnalyser.smoothingTimeConstant = 0.8;
      source.connect(vadAnalyser);

      vadMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      vadMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) vadAudioChunks.push(e.data);
      };

      vadMediaRecorder.start();
      vadTestRecording = true;
      vadStartTime = Date.now();
      runVADAnalysis();
    } catch (err) {
      vadTestError = `Failed to start recording: ${(err as Error).message}`;
    }
  }

  function runVADAnalysis() {
    if (!vadTestRecording || !vadAnalyser || !config?.stt?.vad) return;

    const tick = () => {
      if (!vadTestRecording || !vadAnalyser) return;

      vadTestVolume = calculateVoiceVolume(vadAnalyser, 150);
      const threshold = config?.stt?.vad?.voiceThreshold ?? 12;
      const silenceDelay = config?.stt?.vad?.silenceDelay ?? 5000;

      if (vadTestVolume > threshold) {
        if (!vadTestSpeaking) vadTestSpeaking = true;
        if (vadSilenceTimer) {
          clearTimeout(vadSilenceTimer);
          vadSilenceTimer = null;
        }
      } else if (vadTestSpeaking && !vadSilenceTimer) {
        vadSilenceTimer = window.setTimeout(() => {
          vadTestSpeaking = false;
          stopVADTest();
        }, silenceDelay);
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  async function stopVADTest() {
    if (!vadMediaRecorder || !config?.stt?.vad) return;

    try {
      vadTestRecording = false;
      vadTestSpeaking = false;

      if (vadSilenceTimer) {
        clearTimeout(vadSilenceTimer);
        vadSilenceTimer = null;
      }

      const duration = vadStartTime ? (Date.now() - vadStartTime) : 0;
      const minDuration = config.stt.vad.minDuration ?? 500;

      if (duration < minDuration) {
        vadTestError = `Recording too short (${duration}ms). Minimum: ${minDuration}ms`;
        if (vadMediaRecorder.state !== 'inactive') vadMediaRecorder.stop();
        vadMediaRecorder.stream.getTracks().forEach(track => track.stop());
        return;
      }

      const audioBlob = await new Promise<Blob>((resolve, reject) => {
        const recorder = vadMediaRecorder!;
        const chunks = vadAudioChunks;

        recorder.onstop = () => {
          if (chunks.length === 0) {
            reject(new Error('No audio data recorded'));
            return;
          }
          resolve(new Blob(chunks, { type: 'audio/webm' }));
        };

        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          if (chunks.length === 0) {
            reject(new Error('No audio data recorded'));
            return;
          }
          resolve(new Blob(chunks, { type: 'audio/webm' }));
        }
      });

      vadMediaRecorder.stream.getTracks().forEach(track => track.stop());

      vadTestTranscription = 'Transcribing...';
      const buf = await audioBlob.arrayBuffer();

      const response = await apiFetch('/api/stt?format=webm', {
        method: 'POST',
        body: buf,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`STT failed: ${response.status} - ${errorBody}`);
      }

      const result = await response.json();
      vadTestTranscription = result.transcript || result.text || '(no speech detected)';
    } catch (err) {
      vadTestError = `${(err as Error).message}`;
      vadTestTranscription = '';
    } finally {
      vadTestVolume = 0;
    }
  }

  function cancelVADTest() {
    vadTestRecording = false;
    vadTestSpeaking = false;

    if (vadSilenceTimer) {
      clearTimeout(vadSilenceTimer);
      vadSilenceTimer = null;
    }

    if (vadMediaRecorder && vadMediaRecorder.state !== 'inactive') {
      vadMediaRecorder.stop();
      vadMediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    vadTestVolume = 0;
    vadTestTranscription = '';
  }

  onMount(loadSettings);
</script>

<div class="p-6 max-w-[800px]">
  <h3 class="text-2xl font-semibold text-gray-800 dark:text-gray-100 m-0 mb-6">🎙️ Voice Settings</h3>

  {#if loading}
    <div class="py-8 text-center text-gray-500">Loading voice settings...</div>
  {:else if error}
    <div class="p-3 bg-red-100 dark:bg-red-500/10 border border-red-500 rounded-lg text-red-600 dark:text-red-400 mb-4">{error}</div>
  {:else if config}
    {#if isGuest}
      <div class="p-4 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-500/15 dark:to-indigo-500/15 border-2 border-blue-500 dark:border-blue-400 rounded-xl text-blue-800 dark:text-blue-300 mb-6 text-sm leading-relaxed text-center font-medium">
        👋 You're viewing these voice settings as a guest! You can test how the voice sounds, but only the profile owner can make changes. Feel free to explore and listen! 🎧
      </div>
    {/if}
    {#if successMessage}
      <div class="p-3 bg-green-100 dark:bg-green-500/10 border border-emerald-500 rounded-lg text-emerald-600 dark:text-emerald-400 mb-4">{successMessage}</div>
    {/if}

    <!-- Provider Selection -->
    <div class="mb-6">
      <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Voice Provider</label>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {#each providerEntries as [key, info]}
          <button
            class="p-5 border-2 rounded-xl bg-white dark:bg-gray-800 cursor-pointer transition-all text-center hover:translate-y-[-2px] hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed {config.provider === key ? 'bg-gradient-to-br from-violet-500/15 dark:from-violet-500/25' : 'border-gray-200 dark:border-gray-700'}"
            style="border-color: {config.provider === key ? info.color : ''}; --provider-color: {info.color}"
            on:click={() => switchProvider(key)}
            disabled={saving}
          >
            <div class="text-3xl mb-2">{info.icon}</div>
            <div class="font-semibold text-gray-800 dark:text-gray-100 mb-1">{info.name}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{info.description}</div>
          </button>
        {/each}
      </div>
    </div>

    <!-- Provider-Specific Settings -->
    {#if config.provider === 'piper' && config.piper}
      <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 mb-6">
        <h4 class="m-0 mb-4 text-lg text-gray-800 dark:text-gray-100">Piper Settings</h4>

        <div class="mb-6">
          <label for="piper-voice" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Voice Model</label>
          <select id="piper-voice" bind:value={config.piper.currentVoice} disabled={saving} class="select-field">
            {#each config.piper.voices as voice}
              <option value={voice.id}>{voice.name} ({voice.language})</option>
            {/each}
          </select>
        </div>

        <div class="mb-6">
          <label for="piper-rate" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">
            Speaking Rate: {config.piper.speakingRate.toFixed(2)}x
          </label>
          <input id="piper-rate" type="range" min="0.5" max="2.0" step="0.05" bind:value={config.piper.speakingRate} disabled={saving} class="range-slider" />
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>Slower</span><span>Normal</span><span>Faster</span>
          </div>
        </div>

        <div class="mt-6 pt-6 border-t-2 border-gray-200 dark:border-gray-700">
          <label for="piper-test-text" class="block text-[0.95rem] font-semibold text-gray-800 dark:text-gray-100 mb-2">Test Piper Voice</label>
          <textarea id="piper-test-text" bind:value={testText} rows="2" placeholder="Enter text to test Piper..." disabled={testingVoice || saving} class="input-field"></textarea>
          <button class="w-full py-3 px-6 border-none rounded-lg font-semibold cursor-pointer transition-all mt-3 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => testVoice('piper')} disabled={testingVoice || saving}>
            {testingVoice ? '🔊 Playing...' : '▶️ Test Piper'}
          </button>
        </div>
      </div>

    {:else if config.provider === 'sovits' && config.sovits}
      <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 mb-6">
        <h4 class="m-0 mb-4 text-lg text-gray-800 dark:text-gray-100">GPT-SoVITS Settings</h4>

        <div class="mb-6">
          <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Server Status</label>
          <ServerStatusIndicator serverName="GPT-SoVITS" statusEndpoint="/api/sovits-server" controlEndpoint="/api/sovits-server" autoRefresh={true} refreshInterval={15000} />
        </div>

        <div class="mb-6">
          <label for="sovits-url" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Server URL</label>
          <input id="sovits-url" type="text" bind:value={config.sovits.serverUrl} disabled={saving} class="input-field" />
        </div>

        <div class="mb-6">
          <label for="sovits-speaker" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Speaker ID</label>
          <input id="sovits-speaker" type="text" bind:value={config.sovits.speakerId} placeholder="default" disabled={saving} class="input-field" />
        </div>

        <div class="mb-6">
          <label for="sovits-temp" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Temperature: {config.sovits.temperature.toFixed(2)}</label>
          <input id="sovits-temp" type="range" min="0.1" max="1.0" step="0.05" bind:value={config.sovits.temperature} disabled={saving} class="range-slider" />
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>Stable</span><span>Balanced</span><span>Creative</span>
          </div>
        </div>

        <div class="mb-6">
          <label for="sovits-speed" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Speed: {config.sovits.speed.toFixed(2)}x</label>
          <input id="sovits-speed" type="range" min="0.5" max="2.0" step="0.05" bind:value={config.sovits.speed} disabled={saving} class="range-slider" />
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>Slower</span><span>Normal</span><span>Faster</span>
          </div>
        </div>

        <div class="mb-6">
          <label class="flex items-center gap-2 cursor-pointer font-normal">
            <input type="checkbox" bind:checked={config.sovits.autoFallbackToPiper} disabled={saving} />
            Auto-fallback to Piper if unavailable
          </label>
        </div>

        <div class="mb-6">
          <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Reference Audio Management</label>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Generate reference.wav from the latest recorded sample in your voice profile.</p>
          <button class="w-full py-3 px-6 border-none rounded-lg font-semibold cursor-pointer transition-all mt-2 bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={generateReference} disabled={generatingReference || saving}>
            {generatingReference ? '🔄 Generating...' : '🎯 Generate Reference Audio'}
          </button>
        </div>

        <div class="mt-6 pt-6 border-t-2 border-gray-200 dark:border-gray-700">
          <label for="sovits-test-text" class="block text-[0.95rem] font-semibold text-gray-800 dark:text-gray-100 mb-2">Test Cloned Voice</label>
          <textarea id="sovits-test-text" bind:value={testText} rows="2" placeholder="Enter text to test your cloned voice..." disabled={testingVoice || saving} class="input-field"></textarea>
          <button class="w-full py-3 px-6 border-none rounded-lg font-semibold cursor-pointer transition-all mt-3 bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => testVoice('sovits')} disabled={testingVoice || saving}>
            {testingVoice ? '🔊 Playing...' : '▶️ Test SoVITS'}
          </button>
        </div>
      </div>

    {:else if config.provider === 'rvc' && config.rvc}
      <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 mb-6">
        <h4 class="m-0 mb-4 text-lg text-gray-800 dark:text-gray-100">RVC Settings</h4>

        <div class="mb-6">
          <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Server Status</label>
          <ServerStatusIndicator serverName="RVC" statusEndpoint="/api/rvc-server" controlEndpoint="/api/rvc-server" autoRefresh={true} refreshInterval={15000} />
        </div>

        <div class="mb-6">
          <label for="rvc-speaker" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Voice Model</label>
          {#if config.rvc.speakers && config.rvc.speakers.length > 0}
            <select id="rvc-speaker" bind:value={config.rvc.speakerId} disabled={saving} class="select-field">
              {#each config.rvc.speakers as speaker}
                <option value={speaker.id}>{speaker.name} {speaker.hasIndex ? '✓' : ''}</option>
              {/each}
            </select>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Select a trained voice model. ✓ indicates index file available for better quality.</p>
          {:else}
            <input id="rvc-speaker" type="text" bind:value={config.rvc.speakerId} placeholder="default" disabled={saving} class="input-field" />
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">No trained models found. Train a model first or enter speaker ID manually.</p>
          {/if}
        </div>

        <div class="mb-6">
          <label for="rvc-pitch" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Pitch Shift: {config.rvc.pitchShift > 0 ? '+' : ''}{config.rvc.pitchShift} semitones</label>
          <input id="rvc-pitch" type="range" min="-12" max="12" step="1" bind:value={config.rvc.pitchShift} disabled={saving} class="range-slider" />
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>-12 (Lower)</span><span>0 (Normal)</span><span>+12 (Higher)</span>
          </div>
        </div>

        <div class="mb-6">
          <label for="rvc-speed" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Speed: {config.rvc.speed.toFixed(2)}x</label>
          <input id="rvc-speed" type="range" min="0.5" max="2.0" step="0.05" bind:value={config.rvc.speed} disabled={saving} class="range-slider" />
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>Slower</span><span>Normal</span><span>Faster</span>
          </div>
        </div>

        <!-- Advanced Quality Settings -->
        <div class="my-6 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <h5 class="my-2 text-gray-500 dark:text-gray-400 text-sm font-semibold">⚙️ Advanced Quality Settings</h5>

          <div class="mb-6">
            <label for="rvc-index-rate" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Index Rate: {(config.rvc.indexRate ?? 1.0).toFixed(2)}</label>
            <input id="rvc-index-rate" type="range" min="0.0" max="1.0" step="0.05" bind:value={config.rvc.indexRate} disabled={saving} class="range-slider" />
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Voice retrieval strength (higher = more voice characteristics, 1.0 recommended)</p>
          </div>

          <div class="mb-6">
            <label for="rvc-volume-envelope" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Volume Envelope: {(config.rvc.volumeEnvelope ?? 0.0).toFixed(2)}</label>
            <input id="rvc-volume-envelope" type="range" min="0.0" max="1.0" step="0.05" bind:value={config.rvc.volumeEnvelope} disabled={saving} class="range-slider" />
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">RMS mix rate (0.0 = pure conversion, 1.0 = blend with original)</p>
          </div>

          <div class="mb-6">
            <label for="rvc-protect" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Consonant Protection: {(config.rvc.protect ?? 0.15).toFixed(2)}</label>
            <input id="rvc-protect" type="range" min="0.0" max="0.5" step="0.01" bind:value={config.rvc.protect} disabled={saving} class="range-slider" />
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Protect voiceless consonants (0.15-0.20 recommended for clarity)</p>
          </div>

          <div class="mb-6">
            <label for="rvc-f0-method" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Pitch Detection Method</label>
            <select id="rvc-f0-method" bind:value={config.rvc.f0Method} disabled={saving} class="select-field">
              <option value="rmvpe">RMVPE (Recommended)</option>
              <option value="crepe">CREPE (High Quality)</option>
              <option value="harvest">Harvest (Fast)</option>
              <option value="dio">DIO (Fastest)</option>
            </select>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">RMVPE is the most accurate for most voices</p>
          </div>

          <div class="mb-6">
            <label for="rvc-device" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Device for Inference</label>
            <select id="rvc-device" bind:value={config.rvc.device} disabled={saving} class="select-field">
              <option value="cuda">GPU (CUDA) - Faster</option>
              <option value="cpu">CPU - Slower, no GPU conflicts</option>
            </select>
            <p class="mt-2 text-xs text-amber-500 font-medium">⚠️ Restart server required: Device changes only take effect after restarting the RVC server.</p>
          </div>

          <div class="mt-4 p-3 bg-blue-50 dark:bg-blue-900/30 border-l-[3px] border-blue-500 rounded text-sm">
            <strong class="text-gray-800 dark:text-gray-100">💡 Quality Tips:</strong>
            <ul class="mt-2 pl-5 text-gray-700 dark:text-gray-300">
              <li class="my-1">For grainy voice: Keep Index Rate at 1.0, Volume Envelope at 0.0</li>
              <li class="my-1">For robotic voice: Increase Consonant Protection to 0.20-0.25</li>
              <li class="my-1">For muffled voice: Decrease Consonant Protection to 0.10-0.15</li>
              <li class="my-1">Test after each adjustment to hear the difference</li>
            </ul>
          </div>
        </div>

        <div class="mb-6">
          <label class="flex items-center gap-2 cursor-pointer font-normal">
            <input type="checkbox" bind:checked={config.rvc.autoFallbackToPiper} disabled={saving} />
            Auto-fallback to Piper if model unavailable
          </label>
        </div>

        <div class="mt-6 pt-6 border-t-2 border-gray-200 dark:border-gray-700">
          <label for="rvc-test-text" class="block text-[0.95rem] font-semibold text-gray-800 dark:text-gray-100 mb-2">Test RVC Voice</label>
          <textarea id="rvc-test-text" bind:value={testText} rows="2" placeholder="Enter text to test RVC voice conversion..." disabled={testingVoice || saving} class="input-field"></textarea>
          <button class="w-full py-3 px-6 border-none rounded-lg font-semibold cursor-pointer transition-all mt-3 bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => testVoice('rvc')} disabled={testingVoice || saving}>
            {testingVoice ? '🔊 Playing...' : '▶️ Test RVC'}
          </button>
        </div>
      </div>

    {:else if config.provider === 'kokoro' && config.kokoro}
      <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 mb-6">
        <h4 class="m-0 mb-4 text-lg text-gray-800 dark:text-gray-100">Kokoro TTS Settings</h4>

        <div class="mb-6">
          <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Server Status</label>
          <ServerStatusIndicator serverName="Kokoro" statusEndpoint="/api/kokoro-server" controlEndpoint="/api/kokoro-server" autoRefresh={true} refreshInterval={15000} />
        </div>

        <div class="mb-6">
          <label for="kokoro-voice" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Voice</label>
          <select id="kokoro-voice" bind:value={config.kokoro.voice} disabled={saving} class="select-field">
            {#if config.kokoro.voices && config.kokoro.voices.length > 0}
              <optgroup label="Built-in Voices">
                {#each config.kokoro.voices.filter(v => !v.isCustom) as voice}
                  <option value={voice.id}>{voice.name} ({voice.lang}, {voice.gender}, {voice.quality})</option>
                {/each}
              </optgroup>
              {#if config.kokoro.voices.some(v => v.isCustom)}
                <optgroup label="Custom Voicepacks">
                  {#each config.kokoro.voices.filter(v => v.isCustom) as voice}
                    <option value={voice.id}>{voice.name}</option>
                  {/each}
                </optgroup>
              {/if}
            {:else}
              <option value="af_heart">Heart (English, Female, High)</option>
              <option value="af_bella">Bella (English, Female, High)</option>
              <option value="af_sarah">Sarah (English, Female, High)</option>
              <option value="am_adam">Adam (English, Male, High)</option>
              <option value="am_michael">Michael (English, Male, High)</option>
            {/if}
          </select>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {#if config.kokoro.voices?.some(v => v.isCustom)}
              Choose from 54 built-in voices or your custom trained voicepacks
            {:else}
              Choose from 54 built-in voices across 8 languages
            {/if}
          </p>
        </div>

        <div class="mb-6">
          <label for="kokoro-lang" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Language Code</label>
          <select id="kokoro-lang" bind:value={config.kokoro.langCode} disabled={saving} class="select-field">
            <option value="a">Auto-detect</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="ko">Korean</option>
          </select>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Language for text processing (auto-detect recommended)</p>
        </div>

        <div class="mb-6">
          <label for="kokoro-speed" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Speed: {config.kokoro.speed.toFixed(2)}x</label>
          <input id="kokoro-speed" type="range" min="0.5" max="2.0" step="0.05" bind:value={config.kokoro.speed} disabled={saving} class="range-slider" />
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>Slower</span><span>Normal</span><span>Faster</span>
          </div>
        </div>

        <div class="mb-6">
          <label for="kokoro-device" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Device for Inference</label>
          <select id="kokoro-device" bind:value={config.kokoro.device} disabled={saving} class="select-field">
            <option value="cpu">CPU - Fast & no GPU conflicts</option>
            <option value="cuda">GPU (CUDA) - Faster (requires GPU)</option>
          </select>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Kokoro is optimized for CPU inference. GPU recommended only if CPU is slow.</p>
        </div>

        <div class="mb-6">
          <label class="flex items-center gap-2 cursor-pointer font-normal">
            <input type="checkbox" bind:checked={config.kokoro.useCustomVoicepack} disabled={saving} />
            <span>Use Custom Voicepack</span>
          </label>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Enable to use your trained voicepack instead of built-in voices.</p>
        </div>

        {#if config.kokoro.useCustomVoicepack}
          <div class="mb-6">
            <label class="flex items-center gap-2 cursor-pointer font-normal">
              <input type="checkbox" bind:checked={config.kokoro.normalizeCustomVoicepacks} disabled={saving} />
              <span>Normalize Custom Voicepack Volume</span>
            </label>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Automatically boost quiet custom voicepacks to -3dB peak.</p>
          </div>
        {/if}

        <div class="mb-6">
          <label class="flex items-center gap-2 cursor-pointer font-normal">
            <input type="checkbox" bind:checked={config.kokoro.autoFallbackToPiper} disabled={saving} />
            Auto-fallback to Piper if unavailable
          </label>
        </div>

        <div class="mt-6 pt-6 border-t-2 border-gray-200 dark:border-gray-700">
          <label for="kokoro-test-text" class="block text-[0.95rem] font-semibold text-gray-800 dark:text-gray-100 mb-2">Test Kokoro Voice</label>
          <textarea id="kokoro-test-text" bind:value={testText} rows="2" placeholder="Enter text to test Kokoro synthesis..." disabled={testingVoice || saving} class="input-field"></textarea>
          <button class="w-full py-3 px-6 border-none rounded-lg font-semibold cursor-pointer transition-all mt-3 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => testVoice('kokoro')} disabled={testingVoice || saving}>
            {testingVoice ? '🔊 Playing...' : '▶️ Test Kokoro'}
          </button>
        </div>
      </div>
    {/if}

    <!-- STT Settings -->
    {#if config.stt}
      <div class="mt-8 p-6 bg-gray-50 dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl">
        <h4 class="text-xl font-semibold text-gray-800 dark:text-gray-100 m-0 mb-5">🎤 Speech-to-Text (Whisper)</h4>

        <div class="mb-6">
          <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Model Size</label>
          <select bind:value={config.stt.model} disabled={saving} class="select-field">
            <option value="tiny.en">Tiny (~75MB, fastest)</option>
            <option value="base.en">Base (~140MB, balanced)</option>
            <option value="small.en">Small (~460MB, more accurate)</option>
            <option value="medium.en">Medium (~1.5GB, most accurate)</option>
          </select>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Smaller models are faster but less accurate. GPU recommended for medium/large models.</p>
        </div>

        <div class="mb-6">
          <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Processing Device</label>
          <select bind:value={config.stt.device} disabled={saving} class="select-field">
            <option value="cpu">CPU</option>
            <option value="cuda">GPU (CUDA)</option>
          </select>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">GPU processing is 10-50x faster than CPU. Requires NVIDIA GPU with CUDA support.</p>
        </div>

        <div class="mb-6">
          <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Compute Type</label>
          <select bind:value={config.stt.computeType} disabled={saving} class="select-field">
            <option value="int8">INT8 (fastest, CPU-friendly)</option>
            <option value="float16">FLOAT16 (balanced, GPU-optimized)</option>
            <option value="float32">FLOAT32 (highest precision)</option>
          </select>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Use INT8 for CPU, FLOAT16 for GPU. FLOAT32 only if precision is critical.</p>
        </div>

        <div class="mb-6">
          <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Language</label>
          <select bind:value={config.stt.language} disabled={saving} class="select-field">
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

        <div class="mb-6">
          <label class="flex items-center gap-2 cursor-pointer font-normal">
            <input type="checkbox" bind:checked={config.stt.useServer} disabled={saving} />
            Use persistent Whisper server (recommended)
          </label>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Persistent server keeps model in memory for instant transcription</p>
        </div>

        {#if config.stt.useServer}
          <div class="mb-6">
            <label class="flex items-center gap-2 cursor-pointer font-normal">
              <input type="checkbox" bind:checked={config.stt.autoStart} disabled={saving} />
              Auto-start server on boot
            </label>
          </div>

          <div class="mb-6">
            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Server Status</label>
            <ServerStatusIndicator serverName="Whisper STT" statusEndpoint="/api/whisper-server" controlEndpoint="/api/whisper-server" autoRefresh={true} refreshInterval={15000} />
          </div>
        {/if}

        {#if isCapacitorApp}
          <div class="mt-8 pt-6 border-t-2 border-gray-200 dark:border-gray-700">
            <h5 class="my-4 text-gray-500 dark:text-gray-400 text-base font-semibold">📱 Native Device Voice Mode</h5>

            <div class="mb-6">
              <label class="flex items-center gap-2 cursor-pointer font-normal">
                <input type="checkbox" checked={nativeVoiceModeEnabled} on:change={(e) => {
                  nativeVoiceModeEnabled = e.currentTarget.checked;
                  localStorage.setItem('mh-native-voice-mode', nativeVoiceModeEnabled ? 'true' : 'false');
                  window.dispatchEvent(new CustomEvent('voice-settings-updated'));
                }} disabled={saving} />
                Use device's built-in voice (faster, works offline)
              </label>
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {#if nativeVoiceModeEnabled}
                  <strong class="text-emerald-500">✓ Native Mode Active</strong> - Using your device's speech recognition and text-to-speech.
                {:else}
                  <strong>Remote Mode Active</strong> - Using server-based Whisper (STT) and your custom trained voice (TTS).
                {/if}
              </p>
              <div class="grid grid-cols-2 gap-4 mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm">
                <div>
                  <strong class="block mb-2 text-gray-700 dark:text-gray-100">Native Device:</strong>
                  <ul class="m-0 pl-5 text-gray-500 dark:text-gray-400">
                    <li class="my-1">⚡ Instant response</li>
                    <li class="my-1">📴 Works offline</li>
                    <li class="my-1">🔋 Lower battery usage</li>
                    <li class="my-1">🗣️ Generic device voice</li>
                  </ul>
                </div>
                <div>
                  <strong class="block mb-2 text-gray-700 dark:text-gray-100">Remote Server:</strong>
                  <ul class="m-0 pl-5 text-gray-500 dark:text-gray-400">
                    <li class="my-1">🎯 More accurate STT (Whisper)</li>
                    <li class="my-1">🎭 Custom trained voice</li>
                    <li class="my-1">🌐 Requires network</li>
                    <li class="my-1">⏱️ ~1-2s latency</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        {/if}

        <div class="mt-8 pt-6 border-t-2 border-gray-200 dark:border-gray-700">
          <h5 class="my-4 text-gray-500 dark:text-gray-400 text-base font-semibold">🎧 Hardware Button Capture</h5>

          <div class="mb-6">
            <label class="flex items-center gap-2 cursor-pointer font-normal">
              <input type="checkbox" checked={hardwareButtonsEnabled} on:change={(e) => {
                hardwareButtonsEnabled = e.currentTarget.checked;
                localStorage.setItem('mh-hardware-buttons', hardwareButtonsEnabled ? 'true' : 'false');
              }} disabled={saving} />
              Enable earbud/headphone button capture
            </label>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Allows play/pause buttons on Bluetooth earbuds and headphones to trigger voice input.</p>
          </div>
        </div>

        <div class="mt-8 pt-6 border-t-2 border-gray-200 dark:border-gray-700">
          <h5 class="my-4 text-gray-500 dark:text-gray-400 text-base font-semibold">⚙️ Voice Activity Detection Settings</h5>

          <div class="mb-6">
            <label for="vad-threshold" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Voice Threshold: {config.stt.vad?.voiceThreshold ?? 12}</label>
            <input id="vad-threshold" type="range" min="0" max="100" step="1" bind:value={config.stt.vad.voiceThreshold} disabled={saving} class="range-slider" />
            <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>0 (Very Sensitive)</span><span>50</span><span>100 (Less Sensitive)</span>
            </div>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">How loud audio needs to be to register as speech.</p>
          </div>

          <div class="mb-6">
            <label for="vad-silence-delay" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Silence Delay: {(config.stt.vad?.silenceDelay ?? 5000) / 1000} seconds</label>
            <input id="vad-silence-delay" type="range" min="1000" max="30000" step="500" bind:value={config.stt.vad.silenceDelay} disabled={saving} class="range-slider" />
            <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>1s (Quick)</span><span>15s</span><span>30s (Patient)</span>
            </div>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">How long to wait in silence before auto-stopping.</p>
          </div>

          <div class="mb-6">
            <label for="vad-min-duration" class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Minimum Duration: {config.stt.vad?.minDuration ?? 500}ms</label>
            <input id="vad-min-duration" type="range" min="100" max="5000" step="100" bind:value={config.stt.vad.minDuration} disabled={saving} class="range-slider" />
            <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>100ms (Short)</span><span>2.5s</span><span>5s (Long)</span>
            </div>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Minimum recording length to prevent accidental clicks.</p>
          </div>

          <!-- VAD Test Recorder -->
          <div class="mt-6 p-6 bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500 dark:border-blue-400 rounded-xl">
            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-2 text-sm">Test Voice Detection</label>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Click to start recording. Speak naturally, and the system will auto-stop after silence.</p>

            {#if !vadTestRecording}
              <button class="w-full py-3 px-6 border-none rounded-lg font-semibold cursor-pointer transition-all mt-3 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={startVADTest} disabled={saving}>
                🎤 Start VAD Test
              </button>
            {:else}
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <div class="text-sm font-semibold text-gray-800 dark:text-gray-100 flex justify-between items-center">
                    Volume: {vadTestVolume.toFixed(0)}
                    {#if vadTestSpeaking}
                      <span class="text-red-500 font-bold animate-pulse">🔴 SPEAKING</span>
                    {:else}
                      <span class="text-gray-400">⚪ Silence</span>
                    {/if}
                  </div>
                  <div class="relative h-10 bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
                    <div class="h-full transition-[width] duration-100 {vadTestSpeaking ? 'bg-gradient-to-r from-red-500 to-red-400' : 'bg-gradient-to-r from-blue-500 to-blue-400'}" style="width: {vadTestVolume}%"></div>
                    <div class="absolute top-0 bottom-0 w-[3px] bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" style="left: {config.stt.vad?.voiceThreshold ?? 12}%"></div>
                  </div>
                </div>
                <button class="w-full py-3 px-6 border-none rounded-lg font-semibold cursor-pointer transition-all bg-red-500 text-white hover:bg-red-600" on:click={cancelVADTest}>
                  ❌ Cancel
                </button>
              </div>
            {/if}

            {#if vadTestTranscription}
              <div class="mt-4 p-4 bg-green-100 dark:bg-green-500/10 border border-emerald-500 dark:border-emerald-400 rounded-lg">
                <strong class="text-emerald-600 dark:text-emerald-400 text-sm">Transcription:</strong>
                <p class="mt-2 text-gray-800 dark:text-gray-100 text-[0.95rem]">{vadTestTranscription}</p>
              </div>
            {/if}

            {#if vadTestError}
              <div class="mt-4 p-3 bg-red-100 dark:bg-red-500/10 border border-red-500 dark:border-red-400 rounded-lg text-red-600 dark:text-red-400 text-sm">{vadTestError}</div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Actions -->
    <div class="mt-6">
      <button class="w-full py-3 px-6 border-none rounded-lg font-semibold cursor-pointer transition-all bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed" on:click={saveSettings} disabled={saving || isGuest} title={isGuest ? "Guest users cannot save settings" : "Save voice settings"}>
        {saving ? 'Saving...' : isGuest ? '🔒 Guest Mode (Read-Only)' : '💾 Save Settings'}
      </button>
      {#if isGuest}
        <p class="mt-3 text-center text-sm text-gray-500 dark:text-gray-400 italic">
          💡 Tip: Log in or create an account to customize your own voice settings!
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .range-slider {
    @apply w-full h-1.5 rounded-sm bg-gray-200 dark:bg-gray-700 outline-none appearance-none;
  }
  .range-slider::-webkit-slider-thumb {
    @apply appearance-none w-5 h-5 rounded-full bg-violet-600 cursor-pointer;
  }
  .range-slider::-moz-range-thumb {
    @apply w-5 h-5 rounded-full bg-violet-600 cursor-pointer border-none;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  .animate-pulse {
    animation: pulse 1s infinite;
  }
</style>

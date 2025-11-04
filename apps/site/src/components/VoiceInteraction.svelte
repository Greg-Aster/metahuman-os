<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  type VoiceState = 'idle' | 'connecting' | 'ready' | 'listening' | 'processing' | 'speaking' | 'error';

  let state: VoiceState = 'idle';
  let transcript = '';
  let response = '';
  let errorMessage = '';
  let ws: WebSocket | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let currentAudio: HTMLAudioElement | null = null;
  let micSupported = false;

  // Voice visualization
  let volume = 0;
  let volumeInterval: number | null = null;

  // Voice Activity Detection (VAD)
  let vadEnabled = true; // default to continuous mode
  let isSpeaking = false;
  let silenceTimeout: number | null = null;
  let analyser: AnalyserNode | null = null;

  // VAD tunables (persisted)
  let voiceThreshold = 12; // sensitivity 0..100
  let stopDelay = 1400;    // ms silence before stop
  let maxUtteranceMs = 30000; // ms per utterance hard stop

  /**
   * Start voice conversation session
   */
  async function startVoiceSession() {
    try {
      state = 'connecting';
      errorMessage = '';

      // Feature-detect mic support and security context (required by browsers on mobile/LAN)
      micSupported = typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && !!(navigator as any).mediaDevices
        && typeof (navigator as any).mediaDevices.getUserMedia === 'function'
        && window.isSecureContext;
      if (!micSupported) {
        state = 'error';
        errorMessage = 'Microphone access requires a secure context (HTTPS or localhost). Open this site over HTTPS or use localhost.';
        return;
      }

      // Request microphone access
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Create audio context for visualization and VAD
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(audioStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      // Update volume meter and run VAD
      volumeInterval = window.setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        volume = Math.min(100, (average / 255) * 100);

        // Voice Activity Detection (if enabled)
        if (vadEnabled) {
          runVAD(volume);
        }
      }, 50);

      // Connect to WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/voice-stream`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[voice] WebSocket connected');
      };

      ws.onmessage = handleWebSocketMessage;

      ws.onerror = (error) => {
        console.error('[voice] WebSocket error:', error);
        state = 'error';
        errorMessage = 'Connection error. Please try again.';
      };

      ws.onclose = () => {
        console.log('[voice] WebSocket closed');
        if (state !== 'error') {
          state = 'idle';
        }
      };

      // Setup MediaRecorder to send audio chunks
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      mediaRecorder = new MediaRecorder(audioStream, { mimeType });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws?.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      // When recording stops, signal the server so it processes the accumulated audio
      mediaRecorder.onstop = () => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop_recording' }));
        }
      };

      mediaRecorder.onerror = (error) => {
        console.error('[voice] MediaRecorder error:', error);
        state = 'error';
        errorMessage = 'Recording error. Please check your microphone.';
      };

    } catch (error) {
      console.error('[voice] Startup error:', error);
      state = 'error';
      errorMessage = error instanceof Error ? error.message : 'Failed to start voice session';
    }
  }

  /**
   * Start listening (recording)
   */
  let utteranceStartAt: number | null = null;

  function startListening() {
    if (!mediaRecorder || !ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[voice] Cannot start listening - not ready');
      return;
    }

    transcript = '';
    response = '';
    state = 'listening';
    utteranceStartAt = Date.now();

    // Start recording without timeslice; send start signal so server can time duration
    mediaRecorder.start();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'start_recording', t: Date.now() }));
    }
  }

  /**
   * Stop listening (stop recording)
   */
  function stopListening() {
    if (!mediaRecorder || state !== 'listening') return;

    mediaRecorder.stop();
    state = 'processing';

    // Clear silence timeout
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
      silenceTimeout = null;
    }
  }

  /**
   * Voice Activity Detection
   * Automatically starts/stops recording based on speech detection
   */
  function runVAD(currentVolume: number) {
    // While processing, ignore input
    if (state === 'processing') return;

    // Barge-in detection: if user starts speaking while TTS is playing, stop playback and listen
    if (state === 'speaking' && currentVolume > voiceThreshold) {
      console.log('[VAD] Barge-in detected during TTS, stopping and listening');
      if (currentAudio) {
        try { currentAudio.pause(); } catch {}
        currentAudio = null;
      }
      state = 'ready';
      startListening();
      return;
    }

    // Detect speech
    if (currentVolume > voiceThreshold) {
      // Speech detected!
      if (!isSpeaking) {
        console.log('[VAD] Speech started');
        isSpeaking = true;

        // Start recording if not already
        if (state === 'ready') {
          startListening();
        }
      }

      // Clear silence timeout (user is still speaking)
      if (silenceTimeout) {
        clearTimeout(silenceTimeout);
        silenceTimeout = null;
      }
    } else {
      // Silence detected
      if (isSpeaking && state === 'listening') {
        // Start silence timer if not already running
        if (!silenceTimeout) {
          silenceTimeout = window.setTimeout(() => {
            console.log('[VAD] Silence detected, stopping');
            isSpeaking = false;
            stopListening();
          }, stopDelay);
        }
      }
    }

    // Hard-stop long utterances
    if (state === 'listening' && utteranceStartAt) {
      if (Date.now() - utteranceStartAt > maxUtteranceMs) {
        console.log('[VAD] Max utterance duration reached, stopping');
        stopListening();
        utteranceStartAt = null;
      }
    }
  }

  // Settings persistence + calibration
  function loadVoiceSettings() {
    try {
      const raw = localStorage.getItem('voiceSettings');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.voiceThreshold === 'number') voiceThreshold = s.voiceThreshold;
      if (typeof s.stopDelay === 'number') stopDelay = s.stopDelay;
      if (typeof s.maxUtteranceMs === 'number') maxUtteranceMs = s.maxUtteranceMs;
    } catch {}
  }
  function saveVoiceSettings() {
    try { localStorage.setItem('voiceSettings', JSON.stringify({ voiceThreshold, stopDelay, maxUtteranceMs })); } catch {}
  }

  async function calibrateThreshold() {
    if (!analyser) return;
    let samples = 0; let sum = 0;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const start = Date.now();
    while (Date.now() - start < 800) {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const norm = Math.min(100, (avg / 255) * 100);
      sum += norm; samples++;
      await new Promise(r => setTimeout(r, 25));
    }
    const ambient = samples ? sum / samples : 0;
    voiceThreshold = Math.min(100, Math.round(ambient + 6));
    saveVoiceSettings();
    console.log('[VAD] Calibrated threshold:', voiceThreshold, '(ambient ~', ambient.toFixed(1), ')');
  }

  /**
   * Toggle continuous listening mode
   */
  function toggleContinuousMode() {
    vadEnabled = !vadEnabled;

    if (vadEnabled) {
      console.log('[VAD] Continuous listening enabled');
      // Automatically start listening when enabled
      if (state === 'ready' && mediaRecorder) {
        startListening();
      }
    } else {
      console.log('[VAD] Continuous listening disabled');
      isSpeaking = false;
      if (silenceTimeout) {
        clearTimeout(silenceTimeout);
        silenceTimeout = null;
      }
    }
  }

  // Interrupt listening/speaking without ending the session
  function interrupt() {
    vadEnabled = false;
    isSpeaking = false;
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
      silenceTimeout = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch {}
    }
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio = null;
    }
    state = 'ready';
  }

  /**
   * Handle WebSocket messages from server
   */
  function handleWebSocketMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'ready':
          state = 'ready';
          if (vadEnabled && mediaRecorder) {
            startListening();
          }
          break;

        case 'transcript':
          if (message.data.noSpeech) {
            state = 'ready';
            errorMessage = 'No speech detected. Try speaking louder.';
            setTimeout(() => errorMessage = '', 3000);
          } else {
            transcript = message.data.text;
          }
          break;

        case 'audio':
          response = message.data.text;
          playAudioResponse(message.data.audio);
          break;

        case 'error':
          state = 'error';
          errorMessage = message.data.message;
          setTimeout(() => {
            if (state === 'error') state = 'ready';
          }, 5000);
          break;
      }
    } catch (error) {
      console.error('[voice] Failed to parse message:', error);
    }
  }

  /**
   * Play audio response from server
   */
  function playAudioResponse(base64Audio: string) {
    state = 'speaking';

    // Convert base64 to blob
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    // Play audio
    currentAudio = new Audio(url);
    currentAudio.onended = () => {
      state = 'ready';
      URL.revokeObjectURL(url);

      // Resume continuous listening after speaking
      if (vadEnabled && mediaRecorder && !isSpeaking) {
        startListening();
      }
    };
    currentAudio.onerror = () => {
      state = 'ready';
      errorMessage = 'Failed to play audio response';
      URL.revokeObjectURL(url);

      // Resume continuous listening after error
      if (vadEnabled && mediaRecorder && !isSpeaking) {
        startListening();
      }
    };
    currentAudio.play();
  }

  /**
   * End voice session
   */
  function endSession() {
    // Stop recording
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }

    // Stop volume meter
    if (volumeInterval) {
      clearInterval(volumeInterval);
      volumeInterval = null;
    }

    // Close WebSocket
    if (ws) {
      ws.close();
      ws = null;
    }

    // Stop audio stream
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }

    // Close audio context
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    // Stop current audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    state = 'idle';
    transcript = '';
    response = '';
    volume = 0;
  }

  // Auto-start a voice session when the component mounts
  onMount(() => {
    loadVoiceSettings();
    // Kick off mic + websocket when supported; otherwise show helpful error
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      micSupported = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
    }
    if (micSupported) {
      startVoiceSession();
    } else {
      state = 'error';
      errorMessage = 'Microphone not available. Use HTTPS or localhost and grant permission.';
    }
  });

  /** Cleanup on component destroy */
  onDestroy(() => { endSession(); });
</script>

<div class="voice-interface">
  {#if state === 'idle'}
    <div class="connecting-state">
      <div class="spinner"></div>
      <p>Initializing microphone…</p>
      <button class="retry-button" on:click={startVoiceSession} style="margin-top: 0.75rem">Retry</button>
    </div>

  {:else if state === 'connecting'}
    <div class="connecting-state">
      <div class="spinner"></div>
      <p>Connecting...</p>
    </div>

  {:else if state === 'ready'}
    <div class="ready-state">
      <!-- Continuous listening toggle -->
      <div class="mode-selector">
        <button
          class="mode-toggle-btn"
          class:active={!vadEnabled}
          on:click={() => { if (vadEnabled) toggleContinuousMode(); }}
        >
          🎙️ Push-to-Talk
        </button>
        <button
          class="mode-toggle-btn"
          class:active={vadEnabled}
          on:click={() => { if (!vadEnabled) toggleContinuousMode(); }}
        >
          🔄 Continuous
        </button>
      </div>

      <!-- VAD Settings -->
      <div class="vad-settings">
        <div class="slider">
          <label for="sensitivity-slider">Sensitivity: {voiceThreshold}</label>
          <input id="sensitivity-slider" type="range" min="5" max="40" bind:value={voiceThreshold} on:change={saveVoiceSettings} />
          <button class="calibrate-btn" on:click={calibrateThreshold}>Calibrate</button>
        </div>
        <div class="slider">
          <label for="stop-delay-slider">Stop Delay: {Math.round(stopDelay)} ms</label>
          <input id="stop-delay-slider" type="range" min="500" max="2000" step="50" bind:value={stopDelay} on:change={saveVoiceSettings} />
        </div>
        <div class="slider">
          <label for="max-utterance-slider">Max Utterance: {Math.round(maxUtteranceMs/1000)} s</label>
          <input id="max-utterance-slider" type="range" min="10000" max="60000" step="1000" bind:value={maxUtteranceMs} on:change={saveVoiceSettings} />
        </div>
      </div>

      {#if !vadEnabled}
        <button class="talk-button" on:click={startListening}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
          </svg>
          <span>Hold to Talk</span>
        </button>
      {:else}
        <div class="continuous-indicator">
          <div class="listening-icon">
            <div class="pulse-ring-continuous"></div>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            </svg>
          </div>
          <p class="continuous-text">Listening continuously...</p>
          <p class="continuous-hint">Just start speaking!</p>
        </div>
      {/if}

      <div class="actions-row">
        {#if vadEnabled}
          <button class="interrupt-button" on:click={interrupt}>Interrupt</button>
        {/if}
        <button class="end-button" on:click={endSession}>End Session</button>
      </div>
    </div>

  {:else if state === 'listening'}
    <div class="listening-state">
      {#if !vadEnabled}
        <button class="talk-button active" on:pointerup={stopListening}>
          <div class="pulse-ring"></div>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
          </svg>
          <span>Listening...</span>
        </button>
      {:else}
        <div class="continuous-listening">
          <div class="pulse-ring"></div>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          </svg>
          <p class="listening-text">Listening...</p>
        </div>
      {/if}

      <!-- Volume meter -->
      <div class="volume-meter">
        <div class="volume-bar" style="width: {volume}%"></div>
      </div>

      <div class="actions-row">
        <button class="interrupt-button" on:click={interrupt}>Interrupt</button>
        <button class="end-button" on:click={endSession}>End Session</button>
      </div>
    </div>

  {:else if state === 'processing'}
    <div class="processing-state">
      <div class="spinner"></div>
      <p>Thinking...</p>
      {#if transcript}
        <div class="transcript">You: "{transcript}"</div>
      {/if}
      <div class="actions-row">
        <button class="interrupt-button" on:click={interrupt}>Interrupt</button>
        <button class="end-button" on:click={endSession}>End Session</button>
      </div>
    </div>

  {:else if state === 'speaking'}
    <div class="speaking-state">
      <div class="sound-wave"></div>
      <p>Speaking...</p>
      {#if response}
        <div class="response">Me: "{response}"</div>
      {/if}
      <div class="actions-row">
        <button class="interrupt-button" on:click={interrupt}>Interrupt</button>
        <button class="end-button" on:click={endSession}>End Session</button>
      </div>
    </div>

  {:else if state === 'error'}
    <div class="error-state">
      <p class="error-message">{errorMessage}</p>
      <button class="retry-button" on:click={endSession}>Close</button>
    </div>
  {/if}
</div>

<style>
  .voice-interface {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    min-height: 400px;
  }

  .talk-button,
  .end-button,
  .retry-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 1.5rem 2rem;
    border: 2px solid #3b82f6;
    border-radius: 12px;
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .talk-button:hover,
  .retry-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3);
  }

  .end-button {
    background: #ef4444;
    border-color: #dc2626;
    margin-top: 1rem;
    font-size: 0.875rem;
    padding: 0.75rem 1.5rem;
  }

  .interrupt-button {
    background: #f59e0b;
    border: 2px solid #d97706;
    color: white;
    border-radius: 10px;
    padding: 0.5rem 1rem;
    font-weight: 600;
  }

  .actions-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    align-items: center;
    justify-content: center;
  }

  .talk-button {
    position: relative;
    border-radius: 50%;
    width: 140px;
    height: 140px;
    padding: 0;
  }

  .talk-button.active {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    border-color: #dc2626;
  }

  .pulse-ring {
    position: absolute;
    top: -10px;
    left: -10px;
    right: -10px;
    bottom: -10px;
    border: 3px solid #ef4444;
    border-radius: 50%;
    animation: pulse 1.5s ease-out infinite;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.9);
      opacity: 1;
    }
    100% {
      transform: scale(1.2);
      opacity: 0;
    }
  }

  .volume-meter {
    width: 200px;
    height: 8px;
    background: #e5e7eb;
    border-radius: 4px;
    overflow: hidden;
    margin-top: 1rem;
  }

  .volume-bar {
    height: 100%;
    background: linear-gradient(90deg, #10b981 0%, #3b82f6 50%, #ef4444 100%);
    transition: width 0.05s ease;
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .sound-wave {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
    border-radius: 50%;
    animation: wave 1.5s ease-in-out infinite;
  }

  @keyframes wave {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.2); opacity: 0.7; }
  }

  .transcript,
  .response {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: #f3f4f6;
    border-radius: 8px;
    max-width: 400px;
    text-align: center;
    font-size: 0.875rem;
    color: #374151;
  }

  .error-message {
    color: #ef4444;
    font-weight: 600;
    margin-bottom: 1rem;
    text-align: center;
  }

  :global(.dark) .voice-interface {
    color: #e5e7eb;
  }

  :global(.dark) .transcript,
  :global(.dark) .response {
    background: #374151;
    color: #e5e7eb;
  }

  :global(.dark) .volume-meter {
    background: #374151;
  }

  /* Continuous mode styles */
  .mode-selector {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    background: #f3f4f6;
    padding: 0.25rem;
    border-radius: 8px;
  }

  :global(.dark) .mode-selector {
    background: #374151;
  }

  .mode-toggle-btn {
    flex: 1;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #6b7280;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .mode-toggle-btn:hover {
    background: rgba(59, 130, 246, 0.1);
  }

  .mode-toggle-btn.active {
    background: #3b82f6;
    color: white;
  }

  .vad-settings { margin-top: 0.75rem; display: grid; gap: 0.5rem; }
  .slider { display: grid; gap: 0.25rem; align-items: center; }
  .slider label { font-size: 0.8rem; color: #6b7280; }
  .calibrate-btn { border: 1px solid #3b82f6; background: transparent; color: #3b82f6; padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.75rem; }

  :global(.dark) .mode-toggle-btn {
    color: #9ca3af;
  }

  :global(.dark) .mode-toggle-btn.active {
    background: #3b82f6;
    color: white;
  }

  .continuous-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    margin: 2rem 0;
  }

  .listening-icon {
    position: relative;
    color: #3b82f6;
  }

  .pulse-ring-continuous {
    position: absolute;
    top: -10px;
    left: -10px;
    right: -10px;
    bottom: -10px;
    border: 3px solid #3b82f6;
    border-radius: 50%;
    animation: pulse 2s ease-out infinite;
  }

  .continuous-text {
    font-size: 1.125rem;
    font-weight: 600;
    color: #3b82f6;
    margin: 0;
  }

  .continuous-hint {
    font-size: 0.875rem;
    color: #6b7280;
    margin: 0;
  }

  :global(.dark) .continuous-text {
    color: #60a5fa;
  }

  :global(.dark) .continuous-hint {
    color: #9ca3af;
  }

  .continuous-listening {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    color: #ef4444;
    position: relative;
  }

  .listening-text {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }
</style>

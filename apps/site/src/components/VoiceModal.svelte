<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { calculateVoiceVolume } from '../lib/audio-utils.js';

  // Props inherited from ChatInterface
  export let cognitiveMode: 'dual' | 'agent' | 'emulation' = 'dual';
  export let sessionId: string = '';
  export let yoloMode: boolean = false;
  export let mode: 'conversation' | 'inner' = 'conversation';
  export let onClose: () => void;

  type VoiceState = 'connecting' | 'ready' | 'listening' | 'processing' | 'speaking' | 'error';

  let state: VoiceState = 'connecting';
  let transcript = '';
  let response = '';
  let errorMessage = '';
  let ws: WebSocket | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let currentAudio: HTMLAudioElement | null = null;

  // Voice visualization
  let volume = 0;
  let volumeInterval: number | null = null;

  // VAD
  let isSpeaking = false;
  let silenceTimeout: number | null = null;
  let analyser: AnalyserNode | null = null;

  // VAD settings (loaded from voice config)
  let voiceThreshold = 12;
  let stopDelay = 1400;
  let maxUtteranceMs = 30000;

  let utteranceStartAt: number | null = null;

  // Load VAD settings from server
  async function loadVADSettings() {
    try {
      const response = await fetch('/api/voice-settings');
      if (response.ok) {
        const config = await response.json();
        if (config.stt?.vad) {
          voiceThreshold = config.stt.vad.voiceThreshold ?? 12;
          stopDelay = config.stt.vad.silenceDelay ?? 1400;
          maxUtteranceMs = config.stt.vad.maxUtteranceMs ?? 30000;
        }
      }
    } catch (error) {
      console.error('[voice-modal] Failed to load VAD settings:', error);
    }
  }

  async function startSession() {
    try {
      state = 'connecting';
      errorMessage = '';

      // Check mic support
      const micSupported = typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && !!(navigator as any).mediaDevices
        && typeof (navigator as any).mediaDevices.getUserMedia === 'function'
        && window.isSecureContext;

      if (!micSupported) {
        state = 'error';
        errorMessage = 'Microphone requires HTTPS or localhost';
        return;
      }

      // Request microphone
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Audio context for VAD and volume
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(audioStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      // Volume meter and VAD loop
      volumeInterval = window.setInterval(() => {
        volume = calculateVoiceVolume(analyser, 150);
        runVAD(volume);
      }, 50);

      // Connect WebSocket with parameters
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({
        cognitiveMode,
        sessionId,
        yolo: String(yoloMode),
        mode,
      });
      const wsUrl = `${protocol}//${window.location.host}/voice-stream?${params}`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[voice-modal] WebSocket connected');
      };

      ws.onmessage = handleWebSocketMessage;

      ws.onerror = (error) => {
        console.error('[voice-modal] WebSocket error:', error);
        state = 'error';
        errorMessage = 'Connection error';
      };

      ws.onclose = () => {
        console.log('[voice-modal] WebSocket closed');
        if (state !== 'error') {
          state = 'connecting';
        }
      };

      // MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      mediaRecorder = new MediaRecorder(audioStream, { mimeType });
      let chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws?.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop_recording' }));
        }
      };

    } catch (error) {
      console.error('[voice-modal] Startup error:', error);
      state = 'error';
      errorMessage = error instanceof Error ? error.message : 'Failed to start';
    }
  }

  function startListening() {
    if (!mediaRecorder || !ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Stop any playing audio
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch {}
      currentAudio = null;
    }

    transcript = '';
    response = '';
    state = 'listening';
    utteranceStartAt = Date.now();

    mediaRecorder.start();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'start_recording', t: Date.now() }));
    }
  }

  function stopListening() {
    if (!mediaRecorder || state !== 'listening') return;

    mediaRecorder.stop();
    state = 'processing';

    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
      silenceTimeout = null;
    }
  }

  function runVAD(currentVolume: number) {
    if (state === 'processing') return;

    // Barge-in detection
    if (state === 'speaking' && currentVolume > voiceThreshold) {
      console.log('[VAD] Barge-in detected');
      if (currentAudio) {
        try { currentAudio.pause(); } catch {}
        currentAudio = null;
      }
      state = 'ready';
      startListening();
      return;
    }

    // Speech detection
    if (currentVolume > voiceThreshold) {
      if (!isSpeaking) {
        console.log('[VAD] Speech started');
        isSpeaking = true;

        if (state === 'ready') {
          startListening();
        }
      }

      if (silenceTimeout) {
        clearTimeout(silenceTimeout);
        silenceTimeout = null;
      }
    } else {
      // Silence
      if (isSpeaking && state === 'listening') {
        if (!silenceTimeout) {
          silenceTimeout = window.setTimeout(() => {
            console.log('[VAD] Silence detected');
            isSpeaking = false;
            stopListening();
          }, stopDelay);
        }
      }
    }

    // Hard stop long utterances
    if (state === 'listening' && utteranceStartAt) {
      if (Date.now() - utteranceStartAt > maxUtteranceMs) {
        console.log('[VAD] Max utterance duration');
        stopListening();
        utteranceStartAt = null;
      }
    }
  }

  function handleWebSocketMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'ready':
          state = 'ready';
          if (mediaRecorder) {
            startListening();
          }
          break;

        case 'transcript':
          if (message.data.noSpeech) {
            state = 'ready';
            errorMessage = 'No speech detected';
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
      console.error('[voice-modal] Failed to parse message:', error);
    }
  }

  function playAudioResponse(base64Audio: string) {
    state = 'speaking';

    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    currentAudio = new Audio(url);
    currentAudio.onended = () => {
      state = 'ready';
      URL.revokeObjectURL(url);

      if (mediaRecorder && !isSpeaking) {
        startListening();
      }
    };
    currentAudio.onerror = () => {
      state = 'ready';
      errorMessage = 'Audio playback failed';
      URL.revokeObjectURL(url);

      if (mediaRecorder && !isSpeaking) {
        startListening();
      }
    };
    currentAudio.play();
  }

  function endSession() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }

    if (volumeInterval) {
      clearInterval(volumeInterval);
      volumeInterval = null;
    }

    if (ws) {
      ws.close();
      ws = null;
    }

    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }

    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    onClose();
  }

  onMount(() => {
    loadVADSettings().then(() => {
      startSession();
    });

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        endSession();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  });

  onDestroy(() => {
    endSession();
  });
</script>

<div class="voice-modal-overlay" on:click={endSession}>
  <div class="voice-modal" on:click|stopPropagation>
    <button class="close-btn" on:click={endSession} title="Close (ESC)">✕</button>

    <div class="modal-content">
      {#if state === 'error'}
        <div class="status-icon error">⚠️</div>
        <h3>Connection Error</h3>
        <p class="error-text">{errorMessage}</p>
        <button class="action-btn" on:click={endSession}>Close</button>

      {:else if state === 'connecting'}
        <div class="status-icon connecting">
          <div class="spinner"></div>
        </div>
        <h3>Connecting...</h3>

      {:else if state === 'ready'}
        <div class="status-icon ready">
          <div class="pulse-ring"></div>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          </svg>
        </div>
        <h3>Ready to Listen</h3>
        <p class="hint">Just start speaking...</p>

      {:else if state === 'listening'}
        <div class="status-icon listening">
          <div class="pulse-ring active"></div>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          </svg>
        </div>
        <h3>Listening...</h3>
        <div class="volume-meter">
          <div class="volume-bar" style="width: {volume}%"></div>
        </div>
        {#if transcript}
          <p class="transcript">"{transcript}"</p>
        {/if}

      {:else if state === 'processing'}
        <div class="status-icon processing">
          <div class="spinner"></div>
        </div>
        <h3>Thinking...</h3>
        {#if transcript}
          <p class="transcript">"{transcript}"</p>
        {/if}

      {:else if state === 'speaking'}
        <div class="status-icon speaking">
          <div class="sound-wave"></div>
        </div>
        <h3>Speaking...</h3>
        {#if response}
          <p class="response">"{response}"</p>
        {/if}
      {/if}

      <!-- Mode indicator badge -->
      <div class="mode-badge" title="Cognitive Mode: {cognitiveMode}">
        {cognitiveMode === 'dual' ? '🧠' : cognitiveMode === 'agent' ? '🤖' : '💭'} {cognitiveMode}
      </div>
    </div>
  </div>
</div>

<style>
  .voice-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(4px);
  }

  .voice-modal {
    position: relative;
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    border: 2px solid rgba(139, 92, 246, 0.3);
    border-radius: 24px;
    padding: 3rem;
    min-width: 400px;
    max-width: 500px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  :global(.dark) .voice-modal {
    background: linear-gradient(135deg, #0f172a 0%, #020617 100%);
  }

  .close-btn {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 2.5rem;
    height: 2.5rem;
    border: none;
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
    border-radius: 50%;
    cursor: pointer;
    font-size: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(239, 68, 68, 0.3);
    transform: scale(1.1);
  }

  .modal-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    text-align: center;
  }

  .status-icon {
    position: relative;
    color: #3b82f6;
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .status-icon.error {
    font-size: 4rem;
  }

  .status-icon.listening {
    color: #ef4444;
  }

  .status-icon.speaking {
    color: #8b5cf6;
  }

  .pulse-ring {
    position: absolute;
    top: -10px;
    left: -10px;
    right: -10px;
    bottom: -10px;
    border: 3px solid #3b82f6;
    border-radius: 50%;
    animation: pulse 2s ease-out infinite;
  }

  .pulse-ring.active {
    border-color: #ef4444;
    animation: pulse-fast 1.2s ease-out infinite;
  }

  @keyframes pulse {
    0% { transform: scale(0.9); opacity: 0.6; }
    80% { transform: scale(1.15); opacity: 0; }
    100% { transform: scale(1.2); opacity: 0; }
  }

  @keyframes pulse-fast {
    0% { transform: scale(0.9); opacity: 1; }
    100% { transform: scale(1.2); opacity: 0; }
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid rgba(59, 130, 246, 0.2);
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
    background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
    border-radius: 50%;
    animation: wave 1.5s ease-in-out infinite;
  }

  @keyframes wave {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.2); opacity: 0.7; }
  }

  h3 {
    font-size: 1.5rem;
    font-weight: 600;
    color: #e5e7eb;
    margin: 0;
  }

  .hint {
    color: #9ca3af;
    font-size: 0.875rem;
    margin: 0;
  }

  .error-text {
    color: #ef4444;
    font-size: 0.875rem;
    margin: 0;
  }

  .volume-meter {
    width: 100%;
    max-width: 300px;
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
  }

  .volume-bar {
    height: 100%;
    background: linear-gradient(90deg, #10b981 0%, #3b82f6 50%, #ef4444 100%);
    transition: width 0.05s ease;
  }

  .transcript,
  .response {
    margin: 0;
    padding: 1rem 1.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    color: #e5e7eb;
    font-size: 0.95rem;
    max-width: 400px;
    line-height: 1.5;
  }

  .action-btn {
    padding: 0.75rem 2rem;
    border: 2px solid #ef4444;
    border-radius: 12px;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    transform: translateY(-2px);
  }

  .mode-badge {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.5rem 1rem;
    background: rgba(139, 92, 246, 0.2);
    border: 1px solid rgba(139, 92, 246, 0.4);
    border-radius: 999px;
    color: #a78bfa;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>

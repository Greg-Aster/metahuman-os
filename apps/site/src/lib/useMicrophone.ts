/**
 * Microphone & Voice Activity Detection (VAD) Composable
 * Handles voice input, speech-to-text, and auto-send functionality
 *
 * Supports two STT backends:
 * - Native: Uses browser's SpeechRecognition API (fast, on-device, mobile-friendly)
 * - Whisper: Records audio and sends to server for transcription (more accurate, requires upload)
 */

import { writable, get } from 'svelte/store';
import { calculateVoiceVolume } from './audio-utils.js';

// TypeScript declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface ISpeechRecognitionConstructor {
  new(): ISpeechRecognition;
}

// Types
type STTBackend = 'native' | 'whisper' | 'auto';

// Check for native SpeechRecognition support
const NativeSpeechRecognition: ISpeechRecognitionConstructor | null = typeof window !== 'undefined'
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) as ISpeechRecognitionConstructor
  : null;

/**
 * Detect if running on a mobile device
 */
function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Check if native speech recognition is available
 */
function isNativeSpeechAvailable(): boolean {
  return !!NativeSpeechRecognition;
}

interface UseMicrophoneOptions {
  /**
   * Callback to get TTS playing state (prevents recording LLM's voice)
   */
  getTTSPlaying: () => boolean;

  /**
   * Callback when transcript is ready
   */
  onTranscript: (transcript: string) => void;

  /**
   * Callback when system message should be shown (e.g., Whisper loading)
   */
  onSystemMessage: (message: string) => void;

  /**
   * Component mounted flag to stop VAD loop on unmount
   */
  isComponentMounted: () => boolean;
}

/**
 * Microphone & VAD Composable
 */
export function useMicrophone(options: UseMicrophoneOptions) {
  const { getTTSPlaying, onTranscript, onSystemMessage, isComponentMounted } = options;

  // State
  let micStream: MediaStream | null = null;
  let micRecorder: MediaRecorder | null = null;
  let micChunks: BlobPart[] = [];
  let micStartedAt: number | null = null;
  let micAnalyser: AnalyserNode | null = null;
  let micAudioCtx: AudioContext | null = null;
  let micSilenceTimer: number | null = null;
  let micSpeaking = false; // VAD speaking state
  let micSilenceTimerStarted = false; // Track if we've already logged silence timer start

  // VAD settings (loaded from user profile)
  let MIC_VOICE_THRESHOLD = 12; // Sensitivity 0-100
  let MIC_SILENCE_DELAY = 1400; // 1.4 seconds of silence before auto-stop (conversational pace)
  let MIC_MIN_DURATION = 500; // Don't send if recording is less than 500ms

  // Svelte stores for reactive state
  const isRecording = writable(false);
  const isContinuousMode = writable(false);
  const queuedMessage = writable('');
  const isNativeMode = writable(false); // Track if using native speech recognition
  const interimTranscript = writable(''); // Real-time transcript preview

  // Native speech recognition state
  let speechRecognition: ISpeechRecognition | null = null;
  let useNativeSTT = isMobileDevice() && isNativeSpeechAvailable(); // Auto-detect mobile

  /**
   * Get the current STT backend being used
   */
  function getSTTBackend(): STTBackend {
    return useNativeSTT ? 'native' : 'whisper';
  }

  /**
   * Set the STT backend manually
   */
  function setSTTBackend(backend: STTBackend): void {
    if (backend === 'auto') {
      useNativeSTT = isMobileDevice() && isNativeSpeechAvailable();
    } else if (backend === 'native') {
      if (!isNativeSpeechAvailable()) {
        console.warn('[useMicrophone] Native speech recognition not available, falling back to Whisper');
        useNativeSTT = false;
      } else {
        useNativeSTT = true;
      }
    } else {
      useNativeSTT = false;
    }
    console.log('[useMicrophone] STT backend set to:', getSTTBackend());
  }

  /**
   * Load VAD settings from voice config
   */
  async function loadVADSettings(): Promise<void> {
    try {
      const response = await fetch('/api/voice-settings');
      if (response.ok) {
        const config = await response.json();
        if (config.stt?.vad) {
          MIC_VOICE_THRESHOLD = config.stt.vad.voiceThreshold ?? 12;
          MIC_SILENCE_DELAY = config.stt.vad.silenceDelay ?? 5000;
          MIC_MIN_DURATION = config.stt.vad.minDuration ?? 500;
          console.log('[useMicrophone] Loaded VAD settings:', {
            MIC_VOICE_THRESHOLD,
            MIC_SILENCE_DELAY,
            MIC_MIN_DURATION
          });
        }
      }
    } catch (error) {
      console.error('[useMicrophone] Failed to load VAD settings:', error);
      // Keep defaults
    }
  }

  /**
   * Start native speech recognition (single utterance mode)
   * Uses browser's built-in speech-to-text - fast, on-device, no upload
   */
  function startNativeSpeech(continuous: boolean = false): void {
    if (!NativeSpeechRecognition) {
      console.warn('[useMicrophone] Native speech recognition not available');
      onSystemMessage('⚠️ Native speech recognition not available on this device');
      return;
    }

    // Don't start if TTS is playing (would hear its own voice)
    if (getTTSPlaying()) {
      console.log('[useMicrophone] TTS playing, not starting speech recognition');
      return;
    }

    // Clean up any existing instance
    if (speechRecognition) {
      try {
        speechRecognition.abort();
      } catch {}
      speechRecognition = null;
    }

    try {
      speechRecognition = new NativeSpeechRecognition();
      speechRecognition.continuous = continuous;
      speechRecognition.interimResults = true; // Show words as they're spoken
      speechRecognition.lang = 'en-US'; // Could make configurable

      speechRecognition.onstart = () => {
        console.log('[useMicrophone] Native speech recognition started (continuous:', continuous, ')');
        isRecording.set(true);
        isNativeMode.set(true);
        interimTranscript.set('');
      };

      speechRecognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            final += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }

        // Update interim transcript for real-time display
        if (interim) {
          interimTranscript.set(interim);
        }

        // When we get a final result, send it
        if (final.trim()) {
          console.log('[useMicrophone] Native transcript (final):', final);
          interimTranscript.set('');

          // In continuous mode, keep going; in single mode, this auto-stops
          onTranscript(final.trim());
        }
      };

      speechRecognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('[useMicrophone] Native speech error:', event.error, event.message);

        // Handle common errors gracefully
        if (event.error === 'no-speech') {
          // User didn't say anything - not really an error
          console.log('[useMicrophone] No speech detected');
        } else if (event.error === 'aborted') {
          // Intentionally stopped - not an error
        } else if (event.error === 'not-allowed') {
          onSystemMessage('🎤 Microphone access denied. Please allow microphone access.');
        } else if (event.error === 'network') {
          onSystemMessage('🌐 Network error during speech recognition. Check your connection.');
        } else {
          onSystemMessage(`⚠️ Speech recognition error: ${event.error}`);
        }

        stopNativeSpeech();
      };

      speechRecognition.onend = () => {
        console.log('[useMicrophone] Native speech recognition ended');

        // In continuous mode, restart if we're still supposed to be recording
        if (continuous && get(isContinuousMode) && isComponentMounted() && !getTTSPlaying()) {
          console.log('[useMicrophone] Restarting continuous native speech recognition...');
          // Small delay to prevent rapid restart loops
          setTimeout(() => {
            if (get(isContinuousMode) && isComponentMounted() && !getTTSPlaying()) {
              startNativeSpeech(true);
            }
          }, 100);
        } else {
          isRecording.set(false);
          isNativeMode.set(false);
          interimTranscript.set('');
        }
      };

      speechRecognition.onspeechend = () => {
        console.log('[useMicrophone] Speech ended (user stopped talking)');
        // In single-utterance mode, this will trigger onend
        // In continuous mode, recognition continues
      };

      speechRecognition.start();
    } catch (e) {
      console.error('[useMicrophone] Failed to start native speech:', e);
      onSystemMessage('⚠️ Failed to start speech recognition');
      isRecording.set(false);
      isNativeMode.set(false);
    }
  }

  /**
   * Stop native speech recognition
   */
  function stopNativeSpeech(): void {
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch {}
      speechRecognition = null;
    }
    isRecording.set(false);
    isNativeMode.set(false);
    interimTranscript.set('');
  }

  /**
   * Start microphone - routes to appropriate backend (native or Whisper)
   * @param forceContinuous - Force continuous mode (used by long-press)
   */
  async function startMic(forceContinuous: boolean = false): Promise<void> {
    if (get(isRecording)) return;

    const continuous = forceContinuous || get(isContinuousMode);

    if (useNativeSTT) {
      console.log('[useMicrophone] Using native speech recognition (mobile-optimized)');
      startNativeSpeech(continuous);
    } else {
      console.log('[useMicrophone] Using Whisper backend');
      await startWhisperMic();
    }
  }

  /**
   * Stop microphone - handles both native and Whisper modes
   */
  function stopMic(): void {
    // Check if we're in native mode
    if (speechRecognition) {
      stopNativeSpeech();
      return;
    }

    // Otherwise, stop Whisper recording
    stopWhisperMic();
  }

  /**
   * Stop Whisper recording
   */
  function stopWhisperMic(): void {
    if (!get(isRecording)) return;

    console.log('[useMicrophone] Stopping Whisper recording, chunks collected:', micChunks.length);

    try {
      if (micRecorder && micRecorder.state !== 'inactive') {
        micRecorder.stop();
      }
    } catch (e) {
      console.error('[useMicrophone] Error stopping recorder:', e);
    }

    if (micSilenceTimer) {
      clearTimeout(micSilenceTimer);
      micSilenceTimer = null;
    }

    isRecording.set(false);
    micSpeaking = false;
    micSilenceTimerStarted = false;

    // In continuous mode, keep the stream alive for next speech detection
    if (!get(isContinuousMode)) {
      try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
      micStream = null;
      try { micAudioCtx?.close(); } catch {}
      micAudioCtx = null;
      micAnalyser = null;
    }
  }

  /**
   * Start microphone recording (Whisper backend)
   */
  async function startWhisperMic(): Promise<void> {
    if (get(isRecording)) return;

    try {
      // Guard for unsupported/insecure contexts (e.g., HTTP over LAN)
      const supported = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
      if (!supported) {
        console.warn('[useMicrophone] getUserMedia unavailable (insecure context or unsupported browser)');
        return;
      }

      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      micAudioCtx = new AudioContext();
      const source = micAudioCtx.createMediaStreamSource(micStream);
      micAnalyser = micAudioCtx.createAnalyser();
      micAnalyser.fftSize = 256;
      source.connect(micAnalyser);

      micChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      micRecorder = new MediaRecorder(micStream, { mimeType });
      micRecorder.ondataavailable = (e) => {
        if (e.data?.size) micChunks.push(e.data);
      };
      micRecorder.onstop = () => { void finalizeMic(); };

      // In continuous mode, wait for VAD to detect speech before starting recording
      // In normal mode, start recording immediately
      if (!get(isContinuousMode)) {
        micRecorder.start();
        isRecording.set(true);
        micStartedAt = Date.now();
      }

      runMicVAD();
    } catch (e) {
      console.error('[useMicrophone] Failed to start mic:', e);
    }
  }

  /**
   * Finalize recording and send to STT (Whisper)
   */
  async function finalizeMic(): Promise<void> {
    try {
      const blob = new Blob(micChunks, { type: 'audio/webm' });
      const dur = micStartedAt ? (Date.now() - micStartedAt) : 0;

      console.log('[useMicrophone] Finalizing recording:', dur, 'ms, blob size:', blob.size, 'bytes');

      // Ignore recordings that are too short (likely accidental clicks or noise)
      if (dur < MIC_MIN_DURATION) {
        console.log(`[useMicrophone] Recording too short (${dur}ms), ignoring`);
        return;
      }

      // Ignore recordings with no data
      if (blob.size === 0) {
        console.log('[useMicrophone] Recording has no data (0 bytes), ignoring');
        return;
      }

      const buf = await blob.arrayBuffer();
      const res = await fetch(`/api/stt?format=webm&collect=1&dur=${dur}`, {
        method: 'POST',
        body: buf
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[useMicrophone] STT response:', data);

        if (data?.transcript && data.transcript.trim()) {
          const transcript = data.transcript.trim();
          onTranscript(transcript);
        } else {
          console.log('[useMicrophone] No transcript detected (empty or null response)');
        }
      } else {
        // Check if it's a "still loading" error
        const errorText = await res.text();
        if (res.status === 500 && errorText.includes('WHISPER_LOADING')) {
          console.log('[useMicrophone] Whisper model still loading...');
          onSystemMessage('⏳ Voice recognition is still loading... please wait a moment and try again.');
        } else {
          console.error('[useMicrophone] STT request failed:', res.status, res.statusText);
        }
      }
    } catch (e) {
      console.error('[useMicrophone] STT failed:', e);
    } finally {
      // Clean up recording state
      micChunks = [];
      micStartedAt = null;
      isRecording.set(false);
      micSpeaking = false; // Reset speaking state

      // In continuous mode, ensure we're ready for next recording
      if (get(isContinuousMode)) {
        console.log('[useMicrophone] Ready for next speech in continuous mode');
      }
    }
  }

  /**
   * Voice Activity Detection loop
   */
  function runMicVAD(): void {
    const analyser = micAnalyser;
    if (!analyser) return;

    const tickVAD = () => {
      // Stop the loop if component is unmounted or analyser is gone
      if (!isComponentMounted() || !micAnalyser) return;

      // CRITICAL: Don't record while TTS is playing (prevents recording LLM's own voice)
      if (getTTSPlaying()) {
        // If we were recording, stop it (we heard TTS start mid-recording)
        // But only if we've recorded enough data to avoid losing the recording
        if (get(isRecording)) {
          const recordingDuration = micStartedAt ? (Date.now() - micStartedAt) : 0;
          if (recordingDuration < MIC_MIN_DURATION) {
            // Too short, let it continue until min duration
            // Just pause VAD checking while TTS plays
            micSpeaking = false;
            if (micSilenceTimer) {
              clearTimeout(micSilenceTimer);
              micSilenceTimer = null;
              micSilenceTimerStarted = false;
            }
          } else {
            // Long enough, safe to stop
            console.log('[useMicrophone] TTS started, stopping recording (had', recordingDuration, 'ms)');
            stopMic();
          }
        } else {
          // Not recording, just reset state
          micSpeaking = false;
        }
        requestAnimationFrame(tickVAD);
        return;
      }

      // Use shared audio utility for voice-frequency-focused volume calculation
      const vol = calculateVoiceVolume(analyser, 150);

      // Voice detected
      if (vol > MIC_VOICE_THRESHOLD) {
        if (!micSpeaking) {
          console.log('[useMicrophone] Speech started');
          micSpeaking = true;
          micSilenceTimerStarted = false; // Reset flag

          // In continuous mode, start recording when speech is detected
          if (get(isContinuousMode) && !get(isRecording) && micStream) {
            // Double-check recorder state before starting
            if (micRecorder && micRecorder.state === 'recording') {
              console.log('[useMicrophone] WARNING: Recorder already recording, skipping start');
              isRecording.set(true); // Sync state
              // CRITICAL: Don't return here - must continue VAD loop!
              requestAnimationFrame(tickVAD);
              return;
            }

            console.log('[useMicrophone] Auto-starting recording (continuous mode)');
            // Recreate MediaRecorder for each recording session
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : 'audio/webm';
            micChunks = [];
            micRecorder = new MediaRecorder(micStream, { mimeType });
            micRecorder.ondataavailable = (e) => {
              if (e.data?.size) micChunks.push(e.data);
            };
            micRecorder.onstop = () => { void finalizeMic(); };

            try {
              micRecorder.start();
              isRecording.set(true);
              micStartedAt = Date.now();
            } catch (e) {
              console.error('[useMicrophone] Failed to start recorder:', e);
              isRecording.set(false);
            }
          }
        }
        // Clear silence timer (user is still speaking)
        if (micSilenceTimer) {
          clearTimeout(micSilenceTimer);
          micSilenceTimer = null;
          micSilenceTimerStarted = false;
        }
      }
      // Silence detected while we were speaking
      else if (micSpeaking && get(isRecording) && !micSilenceTimer) {
        // Only start silence timer if we've been recording for at least the minimum duration
        const recordingDuration = micStartedAt ? (Date.now() - micStartedAt) : 0;
        if (recordingDuration >= MIC_MIN_DURATION) {
          if (!micSilenceTimerStarted) {
            console.log('[useMicrophone] Silence detected, starting timer...');
            micSilenceTimerStarted = true;
          }
          micSilenceTimer = window.setTimeout(() => {
            console.log('[useMicrophone] Silence timer expired, stopping recording');
            micSpeaking = false; // Reset speaking state
            micSilenceTimerStarted = false;
            stopMic();
          }, MIC_SILENCE_DELAY);
        }
        // Don't log every frame when recording is too short - just wait
      }

      requestAnimationFrame(tickVAD);
    };
    requestAnimationFrame(tickVAD);
  }

  /**
   * Toggle continuous mode (used by long-press on mobile, right-click on desktop)
   */
  function toggleContinuousMode(): void {
    const currentMode = get(isContinuousMode);

    if (currentMode) {
      // Stop continuous mode and clean up
      isContinuousMode.set(false);

      // Stop native speech if active
      if (speechRecognition) {
        stopNativeSpeech();
      }

      // Stop Whisper recording if active
      if (get(isRecording)) stopMic();

      // Clean up Whisper resources
      try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
      micStream = null;
      try { micAudioCtx?.close(); } catch {}
      micAudioCtx = null;
      micAnalyser = null;
    } else {
      // Start continuous mode
      isContinuousMode.set(true);
      startMic(true); // Force continuous mode
    }
  }

  /**
   * Cleanup function to call on component unmount
   */
  function cleanup(): void {
    // Clean up native speech recognition
    if (speechRecognition) {
      try {
        speechRecognition.abort();
      } catch {}
      speechRecognition = null;
    }

    // Clean up Whisper resources
    if (micSilenceTimer) {
      clearTimeout(micSilenceTimer);
      micSilenceTimer = null;
    }
    try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
    micStream = null;
    try { micAudioCtx?.close(); } catch {}
    micAudioCtx = null;
    micAnalyser = null;

    // Reset stores
    isRecording.set(false);
    isNativeMode.set(false);
    interimTranscript.set('');
  }

  return {
    // Stores
    isRecording,
    isContinuousMode,
    queuedMessage,
    isNativeMode,       // Whether currently using native speech recognition
    interimTranscript,  // Real-time transcript preview (native mode only)

    // Methods
    loadVADSettings,
    startMic,
    stopMic,
    toggleContinuousMode,
    cleanup,

    // Configuration
    getSTTBackend,
    setSTTBackend,

    // Utilities
    isNativeSpeechAvailable,
    isMobileDevice,
  };
}

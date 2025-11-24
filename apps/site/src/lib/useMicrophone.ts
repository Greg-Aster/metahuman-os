/**
 * Microphone & Voice Activity Detection (VAD) Composable
 * Handles voice input, speech-to-text, and auto-send functionality
 */

import { writable, get } from 'svelte/store';
import type { Writable } from 'svelte/store';
import { calculateVoiceVolume } from './audio-utils.js';

// Types
interface MicrophoneSettings {
  voiceThreshold: number;
  silenceDelay: number;
  minDuration: number;
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
   * Start microphone recording
   */
  async function startMic(): Promise<void> {
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
   * Stop microphone recording
   */
  function stopMic(): void {
    if (!get(isRecording)) return;

    console.log('[useMicrophone] Stopping recording, chunks collected:', micChunks.length);

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
    micSpeaking = false; // Reset speaking state
    micSilenceTimerStarted = false;

    // In continuous mode, keep the stream alive for next speech detection
    // In normal mode, close everything
    if (!get(isContinuousMode)) {
      try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
      micStream = null;
      try { micAudioCtx?.close(); } catch {}
      micAudioCtx = null;
      micAnalyser = null;
    }
  }

  /**
   * Finalize recording and send to STT
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
   * Toggle continuous mode
   */
  function toggleContinuousMode(): void {
    const currentMode = get(isContinuousMode);

    if (currentMode) {
      // Stop continuous mode and clean up
      isContinuousMode.set(false);
      if (get(isRecording)) stopMic();
      // Clean up the stream
      try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
      micStream = null;
      try { micAudioCtx?.close(); } catch {}
      micAudioCtx = null;
      micAnalyser = null;
    } else {
      // Start continuous mode
      isContinuousMode.set(true);
      startMic();
    }
  }

  /**
   * Cleanup function to call on component unmount
   */
  function cleanup(): void {
    if (micSilenceTimer) {
      clearTimeout(micSilenceTimer);
      micSilenceTimer = null;
    }
    try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
    micStream = null;
    try { micAudioCtx?.close(); } catch {}
    micAudioCtx = null;
    micAnalyser = null;
  }

  return {
    // Stores
    isRecording,
    isContinuousMode,
    queuedMessage,

    // Methods
    loadVADSettings,
    startMic,
    stopMic,
    toggleContinuousMode,
    cleanup,
  };
}

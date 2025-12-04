/**
 * Microphone & Voice Activity Detection (VAD) Composable
 * Handles voice input, speech-to-text, and auto-send functionality
 *
 * Supports two STT backends:
 * - Native: Uses browser's SpeechRecognition API (fast, on-device)
 * - Whisper: Records audio and sends to server for transcription (more accurate, requires upload)
 */

import { writable, get } from 'svelte/store';
import { calculateVoiceVolume } from '../utils/audio-utils.js';
import { NativeVoice, isCapacitorNative } from '../plugins/native-voice';
import { apiFetch } from '../api-config';

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
 * Signal user activity to prevent background agents from triggering.
 * Called when mic input is detected to prevent curator/organizer from
 * stealing VRAM while user is actively using voice input.
 */
function signalMicActivity(): void {
  apiFetch('/api/activity-ping', { method: 'POST' }).catch(() => {
    // Silently ignore errors - activity tracking is best-effort
  });
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

  // VAD settings (loaded from user profile) - used for desktop/Whisper mode
  let MIC_VOICE_THRESHOLD = 12; // Sensitivity 0-100
  let MIC_SILENCE_DELAY = 1400; // 1.4 seconds of silence before auto-stop (conversational pace)
  let MIC_MIN_DURATION = 500; // Don't send if recording is less than 500ms

  // Conversation mode settings
  // These are used alongside the desktop VAD settings loaded from config
  const CONVERSATION_SUSTAINED_FRAMES = 5; // Require ~5 frames (~80ms) of sustained voice
  const CONVERSATION_RESTART_COOLDOWN = 1200; // How long to wait after TTS before ready state
  const CONVERSATION_STARTUP_DELAY = 200; // How long to ignore audio after mic activates
  const CONVERSATION_MIN_SPEECH_MS = 900; // Require this much speech before silence timer can fire
  const CONVERSATION_TIMEOUT = 30000; // How long conversation mode stays active (30s inactivity timeout)

  // Conversation mode state
  // When active, system listens for ANY speech
  // Auto-restarts after each exchange until timeout or explicit stop
  let conversationModeActive = false;
  let conversationModeTimer: ReturnType<typeof setTimeout> | null = null;
  let conversationRestartTimer: ReturnType<typeof setTimeout> | null = null;

  // Conversation state machine for proper turn-taking
  // Prevents the "ding ding ding" problem by having explicit states
  // IDLE: conversation mode not active
  // READY: VAD listening for voice above threshold (mic ON, ignoring ambient)
  // LISTENING: speech recognition active, recording user voice
  // PROCESSING: sent transcript to LLM, waiting for response start
  // SPEAKING: TTS playing (mic completely OFF - voice ducking)
  // COOLDOWN: TTS finished, brief wait before returning to READY
  type ConversationState = 'IDLE' | 'READY' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'COOLDOWN';
  let conversationState: ConversationState = 'IDLE';
  let conversationStateDebug = true; // Set to true to see state transitions in console

  /**
   * Transition conversation state machine
   * Enforces valid state transitions and logs changes
   */
  function setConversationState(newState: ConversationState): void {
    const oldState = conversationState;

    // Valid transitions (guards against invalid state changes)
    const validTransitions: Record<ConversationState, ConversationState[]> = {
      'IDLE': ['READY'],
      'READY': ['LISTENING', 'IDLE'],
      'LISTENING': ['PROCESSING', 'READY', 'IDLE'], // Can go back to READY if no speech
      'PROCESSING': ['SPEAKING', 'READY', 'IDLE'], // READY if no TTS response
      'SPEAKING': ['COOLDOWN', 'IDLE'],
      'COOLDOWN': ['READY', 'IDLE'],
    };

    if (!validTransitions[oldState].includes(newState) && newState !== 'IDLE') {
      console.warn(`[ConversationState] Invalid transition: ${oldState} → ${newState}`);
      // Allow it anyway for recovery, but log warning
    }

    conversationState = newState;
    if (conversationStateDebug) {
      console.log(`[ConversationState] ${oldState} → ${newState}`);
    }

    // Side effects based on new state
    switch (newState) {
      case 'IDLE':
        // Stop everything
        stopConversationVAD();
        stopConversationSilenceMonitor();
        break;
      case 'READY':
        // Start VAD to detect voice
        // Don't start here - caller should start after cooldown
        break;
      case 'LISTENING':
        // Speech recognition active - handled by caller
        break;
      case 'PROCESSING':
        // Waiting for LLM - stop all audio processing (voice ducking)
        stopConversationVAD();
        stopConversationSilenceMonitor();
        break;
      case 'SPEAKING':
        // TTS playing - ensure mic is completely off (voice ducking)
        stopConversationVAD();
        stopConversationSilenceMonitor();
        break;
      case 'COOLDOWN':
        // Brief pause after TTS - mic still off
        break;
    }
  }


  // Conversation VAD state (voice activity detection before starting speech recognition)
  // This prevents ambient noise from triggering speech recognition
  let conversationVadStream: MediaStream | null = null;
  let conversationVadAudioCtx: AudioContext | null = null;
  let conversationVadAnalyser: AnalyserNode | null = null;
  let conversationVadRunning = false;
  let conversationVadAnimFrame: number | null = null;
  let conversationVadSustainedFrames = 0; // Count consecutive frames above threshold

  // Conversation silence monitor state (runs during speech recognition to detect end of speech)
  // Uses user's MIC_SILENCE_DELAY setting to determine when to stop
  let conversationSilenceMonitorRunning = false;
  let conversationSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  let conversationSilenceMonitorStream: MediaStream | null = null;
  let conversationSilenceMonitorAudioCtx: AudioContext | null = null;
  let conversationSilenceMonitorAnalyser: AnalyserNode | null = null;
  let conversationSilenceMonitorAnimFrame: number | null = null;
  let conversationHasReceivedSpeech = false; // Track if we've received any speech in this session
  let conversationSpeechStart = 0; // Timestamp when speech first detected in current turn
  let conversationEmptyTurns = 0; // Count empty turns to prevent restart loops

  let accumulatedTranscript = ''; // Build up transcript across interim results

  // Cooldown to prevent rapid looping (the "ding ding ding" problem)
  let conversationLastRecognitionEnd = 0; // Timestamp of last recognition end
  let conversationGotTranscript = false; // Track if we got any transcript in last cycle

  // Startup delay for VAD - ignore audio after mic activates
  // This prevents the phone's "ding" sound from triggering VAD
  let conversationVadStartTime = 0;

  // Svelte stores for reactive state
  const isRecording = writable(false);
  const isContinuousMode = writable(false);
  const queuedMessage = writable('');
  const isNativeMode = writable(false); // Track if using native speech recognition
  const interimTranscript = writable(''); // Real-time transcript preview
  const whisperStatus = writable<'unknown' | 'loading' | 'ready' | 'stopped' | 'error'>('unknown'); // Whisper server status
  const isConversationMode = writable(false); // Conversation mode active (any speech triggers)
  const isWakeWordListening = writable(false); // Deprecated: always false (wake word removed)
  const wakeWordDetected = writable(false); // Deprecated: always false (wake word removed)
  const isHardwareButtonsActive = writable(false); // Media Session active (earbuds can trigger mic)
  const mediaSessionDebugState = writable(''); // Debug state for mobile testing (e.g., "PAUSED", "PLAYING", "TTS_STEAL")

  // Native speech recognition state
  let speechRecognition: ISpeechRecognition | null = null;
  let useNativeSTT = false; // Default to Whisper, but can be overridden by user preference

  /**
   * Check if native voice mode is enabled (from localStorage)
   */
  function isNativeVoiceModeEnabled(): boolean {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
    return localStorage.getItem('mh-native-voice-mode') === 'true';
  }

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
      useNativeSTT = isNativeSpeechAvailable();
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
      const response = await apiFetch('/api/voice-settings');
      if (response.ok) {
        const config = await response.json();
        if (config.stt?.vad) {
          MIC_VOICE_THRESHOLD = config.stt.vad.voiceThreshold ?? 12;
          MIC_SILENCE_DELAY = config.stt.vad.silenceDelay ?? 5000;
          MIC_MIN_DURATION = config.stt.vad.minDuration ?? 500;
          console.log('[useMicrophone] Loaded VAD settings (desktop):', {
            MIC_VOICE_THRESHOLD,
            MIC_SILENCE_DELAY,
            MIC_MIN_DURATION
          });
        }

        // Conversation mode uses the same VAD settings as desktop

        // Check if native voice mode is enabled (from localStorage)
        if (isNativeVoiceModeEnabled()) {
          if (isNativeSpeechAvailable()) {
            setSTTBackend('native');
            console.log('[useMicrophone] Native voice mode enabled - using device STT');
          } else {
            console.warn('[useMicrophone] Native voice mode requested but not available on this device');
          }
        }

        // Check Whisper server status (just once on load)
        const serverStatus = config.stt?.serverStatus;
        if (serverStatus === 'running') {
          whisperStatus.set('ready');
          console.log('[useMicrophone] Whisper server ready');
        } else if (serverStatus === 'starting' || serverStatus === 'loading') {
          whisperStatus.set('loading');
          console.log('[useMicrophone] Whisper server starting...');
        } else if (serverStatus === 'stopped' || serverStatus === 'disabled') {
          whisperStatus.set('stopped');
        } else {
          whisperStatus.set('unknown');
        }
      }
    } catch (error) {
      console.error('[useMicrophone] Failed to load VAD settings:', error);
      whisperStatus.set('error');
    }
  }


  /**
   * Enter conversation mode - system listens for ANY speech
   * Auto-restarts listening after each exchange until timeout
   */
  function enterConversationMode(): void {
    console.log('[useMicrophone] Entering conversation mode');
    conversationModeActive = true;
    isConversationMode.set(true);
    conversationEmptyTurns = 0;
    conversationSpeechStart = 0;
    setConversationState('READY'); // Start in READY state, waiting for voice
    resetConversationTimeout();
  }

  /**
   * Exit conversation mode - just stop, don't auto-start anything
   */
  function exitConversationMode(): void {
    console.log('[useMicrophone] Exiting conversation mode');
    conversationModeActive = false;
    isConversationMode.set(false);
    setConversationState('IDLE'); // This stops VAD and silence monitor
    if (conversationModeTimer) {
      clearTimeout(conversationModeTimer);
      conversationModeTimer = null;
    }
    if (conversationRestartTimer) {
      clearTimeout(conversationRestartTimer);
      conversationRestartTimer = null;
    }
    // Just stop - don't auto-start wake word or anything else
  }

  /**
   * Reset the conversation mode timeout (called after each interaction)
   */
  function resetConversationTimeout(): void {
    if (conversationModeTimer) {
      clearTimeout(conversationModeTimer);
    }
    conversationModeTimer = setTimeout(() => {
      console.log('[useMicrophone] Conversation mode timed out');
      // Silent timeout - no message spam
      exitConversationMode();
    }, CONVERSATION_TIMEOUT);
  }

  /**
   * Schedule restart of VAD listening after TTS finishes
   * Called when native speech ends in conversation mode
   *
   * Uses state machine for proper turn-taking:
   * LISTENING → PROCESSING → SPEAKING → COOLDOWN → READY
   *
   * VOICE DUCKING: Mic is completely OFF during PROCESSING/SPEAKING/COOLDOWN
   * This prevents the "ding ding ding" rapid looping problem caused by
   * the microphone picking up the device's own TTS output.
   */
  function scheduleConversationRestart(): void {
    if (!conversationModeActive || !isComponentMounted()) return;

    // Cancel any pending restart
    if (conversationRestartTimer) {
      clearTimeout(conversationRestartTimer);
      conversationRestartTimer = null;
    }

    // Record when this cycle ended
    conversationLastRecognitionEnd = Date.now();

    // Transition to PROCESSING state (mic completely OFF - voice ducking)
    setConversationState('PROCESSING');

    // Use cooldown setting (prevents restart loops)
    // If no transcript (noise triggered it), keep a modest backoff to prevent loops
    const baseCooldown = Math.max(700, CONVERSATION_RESTART_COOLDOWN);
    const cooldownAfterTTS = conversationGotTranscript ? baseCooldown : baseCooldown + 400;
    const minWaitForLLM = conversationGotTranscript ? 800 : 1100;

    console.log('[useMicrophone] State=PROCESSING, waiting for TTS (minWait=' + minWaitForLLM + 'ms, cooldown=' + cooldownAfterTTS + 'ms, gotTranscript:', conversationGotTranscript, ')');

    // Reset transcript flag for next cycle
    conversationGotTranscript = false;

    // State machine polling loop
    const pollStateMachine = () => {
      if (!conversationModeActive || !isComponentMounted()) {
        setConversationState('IDLE');
        return;
      }

      const timeSinceEnd = Date.now() - conversationLastRecognitionEnd;
      const isTTSPlaying = getTTSPlaying();

      // Handle state transitions based on TTS status
      switch (conversationState) {
        case 'PROCESSING':
          // Waiting for LLM to start TTS
          if (isTTSPlaying) {
            // TTS started - transition to SPEAKING (mic stays OFF)
            setConversationState('SPEAKING');
            conversationRestartTimer = setTimeout(pollStateMachine, 200);
          } else if (timeSinceEnd < minWaitForLLM) {
            // Still waiting for LLM
            conversationRestartTimer = setTimeout(pollStateMachine, 200);
          } else {
            // Timeout waiting for LLM - no TTS response
            // Skip to COOLDOWN (still need to wait before listening again)
            console.log('[useMicrophone] No TTS after', minWaitForLLM, 'ms, going to COOLDOWN');
            setConversationState('COOLDOWN');
            conversationRestartTimer = setTimeout(pollStateMachine, 100);
          }
          break;

        case 'SPEAKING':
          // TTS is playing - mic completely OFF (voice ducking)
          if (isTTSPlaying) {
            // Still playing, keep waiting
            conversationRestartTimer = setTimeout(pollStateMachine, 200);
          } else {
            // TTS finished - transition to COOLDOWN
            console.log('[useMicrophone] TTS finished, entering COOLDOWN (' + cooldownAfterTTS + 'ms)');
            setConversationState('COOLDOWN');
            // Start cooldown timer
            conversationRestartTimer = setTimeout(pollStateMachine, cooldownAfterTTS);
          }
          break;

        case 'COOLDOWN':
          // Cooldown complete - check TTS didn't restart (e.g., multi-part response)
          if (isTTSPlaying) {
            // TTS restarted - go back to SPEAKING
            console.log('[useMicrophone] TTS restarted during cooldown, back to SPEAKING');
            setConversationState('SPEAKING');
            conversationRestartTimer = setTimeout(pollStateMachine, 200);
          } else {
            // Ready to listen again - use VAD
            console.log('[useMicrophone] Cooldown complete, entering READY state');
            setConversationState('READY');
            resetConversationTimeout();
            startConversationVAD();
          }
          break;

        default:
          // Unexpected state - recover to IDLE
          console.warn('[useMicrophone] Unexpected state in restart loop:', conversationState);
          break;
      }
    };

    // Start the state machine loop immediately
    conversationRestartTimer = setTimeout(pollStateMachine, 100);
  }

  /**
   * Start conversation VAD (voice activity detection)
   * Listens for actual voice before starting speech recognition
   * This prevents ambient noise from triggering recording
   */
  async function startConversationVAD(): Promise<void> {
    if (!conversationModeActive || !isComponentMounted()) return;
    if (conversationVadRunning) return; // Already running

    console.log('[useMicrophone] Starting conversation VAD (threshold:', MIC_VOICE_THRESHOLD, ', sustainedFrames:', CONVERSATION_SUSTAINED_FRAMES, ')');

    // Reset sustained frames counter
    conversationVadSustainedFrames = 0;

    try {
      // Get microphone stream
      conversationVadStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      conversationVadAudioCtx = new AudioContext();
      const source = conversationVadAudioCtx.createMediaStreamSource(conversationVadStream);
      conversationVadAnalyser = conversationVadAudioCtx.createAnalyser();
      conversationVadAnalyser.fftSize = 256;
      source.connect(conversationVadAnalyser);

      conversationVadRunning = true;
      conversationVadStartTime = Date.now(); // Record when VAD started (for startup delay)
      runConversationVAD();
    } catch (e) {
      console.error('[useMicrophone] Failed to start conversation VAD:', e);
      conversationVadRunning = false;
    }
  }

  /**
   * Stop conversation VAD
   */
  function stopConversationVAD(): void {
    conversationVadRunning = false;

    if (conversationVadAnimFrame) {
      cancelAnimationFrame(conversationVadAnimFrame);
      conversationVadAnimFrame = null;
    }

    if (conversationVadStream) {
      conversationVadStream.getTracks().forEach(t => t.stop());
      conversationVadStream = null;
    }

    if (conversationVadAudioCtx) {
      try { conversationVadAudioCtx.close(); } catch {}
      conversationVadAudioCtx = null;
    }

    conversationVadAnalyser = null;
  }

  /**
   * Start silence monitor for conversation mode
   * Runs in parallel with speech recognition to detect when user stops talking
   * Uses MIC_SILENCE_DELAY to determine when to stop (respects user settings)
   */
  async function startConversationSilenceMonitor(): Promise<void> {
    if (conversationSilenceMonitorRunning) return;

    console.log('[useMicrophone] Starting conversation silence monitor (silenceDelay:', MIC_SILENCE_DELAY, 'ms)');

    try {
      conversationSilenceMonitorStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      conversationSilenceMonitorAudioCtx = new AudioContext();
      const source = conversationSilenceMonitorAudioCtx.createMediaStreamSource(conversationSilenceMonitorStream);
      conversationSilenceMonitorAnalyser = conversationSilenceMonitorAudioCtx.createAnalyser();
      conversationSilenceMonitorAnalyser.fftSize = 256;
      source.connect(conversationSilenceMonitorAnalyser);

      conversationSilenceMonitorRunning = true;
      conversationHasReceivedSpeech = false;
      runConversationSilenceMonitor();
    } catch (e) {
      console.error('[useMicrophone] Failed to start silence monitor:', e);
    }
  }

  /**
   * Stop conversation silence monitor
   */
  function stopConversationSilenceMonitor(): void {
    conversationSilenceMonitorRunning = false;

    if (conversationSilenceTimer) {
      clearTimeout(conversationSilenceTimer);
      conversationSilenceTimer = null;
    }

    if (conversationSilenceMonitorAnimFrame) {
      cancelAnimationFrame(conversationSilenceMonitorAnimFrame);
      conversationSilenceMonitorAnimFrame = null;
    }

    if (conversationSilenceMonitorStream) {
      conversationSilenceMonitorStream.getTracks().forEach(t => t.stop());
      conversationSilenceMonitorStream = null;
    }

    if (conversationSilenceMonitorAudioCtx) {
      try { conversationSilenceMonitorAudioCtx.close(); } catch {}
      conversationSilenceMonitorAudioCtx = null;
    }

    conversationSilenceMonitorAnalyser = null;
    conversationHasReceivedSpeech = false;
    conversationSpeechStart = 0;
  }

  /**
   * Run conversation silence monitor loop
   * Detects when user stops talking and triggers stop after MIC_SILENCE_DELAY
   *
   * STATE GUARD: Only runs in LISTENING state
   */
  function runConversationSilenceMonitor(): void {
    if (!conversationSilenceMonitorRunning || !conversationSilenceMonitorAnalyser) {
      return;
    }

    // STATE GUARD: Only run silence monitor in LISTENING state
    if (conversationState !== 'LISTENING') {
      stopConversationSilenceMonitor();
      return;
    }

    // Don't monitor while TTS is playing (shouldn't happen in LISTENING state, but be safe)
    if (getTTSPlaying()) {
      if (conversationSilenceTimer) {
        clearTimeout(conversationSilenceTimer);
        conversationSilenceTimer = null;
      }
      // TTS started unexpectedly during listening - this shouldn't happen
      console.warn('[useMicrophone] TTS playing during LISTENING state - stopping monitor');
      stopConversationSilenceMonitor();
      return;
    }

    const vol = calculateVoiceVolume(conversationSilenceMonitorAnalyser, 150);

    // Voice detected - user is still speaking
    if (vol > MIC_VOICE_THRESHOLD) {
      if (!conversationHasReceivedSpeech) {
        conversationSpeechStart = Date.now();
      }
      conversationHasReceivedSpeech = true;
      // Clear any pending silence timer
      if (conversationSilenceTimer) {
        clearTimeout(conversationSilenceTimer);
        conversationSilenceTimer = null;
      }
    }
    // Silence detected - start/continue silence timer
    else if (conversationHasReceivedSpeech && !conversationSilenceTimer) {
      const speechDuration = conversationSpeechStart ? (Date.now() - conversationSpeechStart) : 0;
      if (speechDuration < CONVERSATION_MIN_SPEECH_MS) {
        conversationSilenceMonitorAnimFrame = requestAnimationFrame(runConversationSilenceMonitor);
        return;
      }

      // Only start silence timer if we've received speech (prevents immediate trigger)
      console.log('[useMicrophone] Silence detected, starting timer (' + MIC_SILENCE_DELAY + 'ms)');
      conversationSilenceTimer = setTimeout(async () => {
        console.log('[useMicrophone] Silence timer expired');

        // Build the full transcript (accumulated finals + any remaining interim)
        const currentInterim = get(interimTranscript);
        let fullTranscript = accumulatedTranscript;
        if (currentInterim.trim()) {
          fullTranscript += ' ' + currentInterim.trim();
        }
        fullTranscript = fullTranscript.trim();

        console.log('[useMicrophone] Full transcript to send:', fullTranscript);

        // Stop the speech recognition first
        if (speechRecognition) {
          try {
            speechRecognition.stop(); // Use stop() not abort() to get final results
          } catch {}
        }
        stopConversationSilenceMonitor();

        // NOW send the accumulated transcript (this is when we actually send in conversation mode)
        if (fullTranscript) {
          console.log('[useMicrophone] Conversation mode: sending accumulated transcript:', fullTranscript);
          accumulatedTranscript = ''; // Reset BEFORE onTranscript to prevent double-send in onend
          conversationGotTranscript = true;
          onTranscript(fullTranscript);
          conversationEmptyTurns = 0;
        } else {
          console.log('[useMicrophone] Conversation mode: no transcript detected, backing off');
          accumulatedTranscript = '';
          conversationEmptyTurns += 1;
          if (conversationEmptyTurns >= 2) {
            stopConversationMode();
          }
        }
      }, MIC_SILENCE_DELAY);
    }

    conversationSilenceMonitorAnimFrame = requestAnimationFrame(runConversationSilenceMonitor);
  }

  /**
   * Run conversation VAD loop
   * Detects voice and starts speech recognition when SUSTAINED voice is detected
   * Uses thresholds to filter ambient noise
   *
   * STATE GUARD: Only runs in READY state (voice ducking protection)
   */
  function runConversationVAD(): void {
    if (!conversationVadRunning || !conversationVadAnalyser || !conversationModeActive) {
      stopConversationVAD();
      return;
    }

    // STATE GUARD: Only run VAD in READY state
    // This is the core of voice ducking - mic is OFF in all other states
    if (conversationState !== 'READY') {
      console.log('[useMicrophone] VAD blocked - state is', conversationState, '(not READY)');
      stopConversationVAD();
      return;
    }

    // Double-check: Don't run while TTS is playing (belt and suspenders)
    if (getTTSPlaying()) {
      conversationVadSustainedFrames = 0; // Reset sustained counter
      // TTS started unexpectedly - transition to SPEAKING
      console.log('[useMicrophone] TTS detected during VAD, transitioning to SPEAKING');
      setConversationState('SPEAKING');
      stopConversationVAD();
      // Start monitoring for TTS to finish
      scheduleConversationRestart();
      return;
    }

    // Startup delay - ignore audio after mic activates
    // This prevents system sounds from triggering VAD
    const timeSinceStart = Date.now() - conversationVadStartTime;
    if (timeSinceStart < CONVERSATION_STARTUP_DELAY) {
      conversationVadSustainedFrames = 0; // Don't accumulate frames during startup
      conversationVadAnimFrame = requestAnimationFrame(runConversationVAD);
      return;
    }

    // Calculate voice volume using voice-frequency-focused analysis
    const vol = calculateVoiceVolume(conversationVadAnalyser, 150);

    // Check if volume is above threshold
    if (vol > MIC_VOICE_THRESHOLD) {
      conversationVadSustainedFrames++;

      // Require sustained voice (multiple consecutive frames above threshold)
      // This prevents short noise spikes from triggering speech recognition
      if (conversationVadSustainedFrames >= CONVERSATION_SUSTAINED_FRAMES) {
        console.log('[useMicrophone] Sustained voice detected (vol:', vol, ', frames:', conversationVadSustainedFrames, '), starting speech recognition');

        // Reset counter and stop VAD (speech recognition will take over)
        conversationVadSustainedFrames = 0;
        stopConversationVAD();

        // Transition to LISTENING state
        setConversationState('LISTENING');

        // Start speech recognition in CONTINUOUS mode for conversation
        // We use our own silence monitor to detect when to stop (respects user's silenceDelay setting)
        // Browser's non-continuous mode cuts off too aggressively mid-sentence
        startNativeSpeech(true); // continuous=true for conversation mode

        // Start our silence monitor to detect when user stops talking
        // This uses MIC_SILENCE_DELAY from user settings
        startConversationSilenceMonitor();
        return;
      }
    } else {
      // Volume dropped below threshold - reset sustained counter
      conversationVadSustainedFrames = 0;
    }

    // Continue VAD loop
    conversationVadAnimFrame = requestAnimationFrame(runConversationVAD);
  }

  /**
   * Start conversation mode (triggered by long-press or right-click)
   * Uses VAD to detect voice, then starts speech recognition with silence monitoring
   * Falls back to continuous mode (Whisper) if native speech recognition isn't available
   */
  function startConversationMode(): void {
    // Check for secure context first
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      onSystemMessage('🔒 Microphone requires HTTPS');
      return;
    }

    // Fall back to continuous mode (Whisper-based) if native speech isn't available
    if (!NativeSpeechRecognition) {
      console.log('[useMicrophone] Native speech not available, falling back to continuous mode');
      if (!get(isContinuousMode)) {
        toggleContinuousMode();
      }
      return;
    }

    // Enter conversation mode
    enterConversationMode();

    // Vibrate for feedback on touch devices
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }

    // Start VAD listening (will start speech recognition when voice is detected)
    console.log('[useMicrophone] Starting conversation mode with VAD');
    startConversationVAD();
  }

  /**
   * Stop conversation mode
   */
  function stopConversationMode(): void {
    exitConversationMode();
    stopConversationVAD();
    stopConversationSilenceMonitor();
    stopNativeSpeech();
    // Silent stop - icon change is enough
  }

  /**
   * Toggle conversation mode on/off (for long-press or right-click)
   * Always uses continuous mode (Whisper) for consistent behavior across all devices
   */
  function toggleConversationMode(): void {
    // Always use continuous mode (Whisper) - same pipeline as single-tap
    // This ensures consistent, working behavior on all devices
    // Native speech recognition is unreliable on mobile
    console.log('[useMicrophone] Long-press/right-click: using Whisper continuous mode');
    toggleContinuousMode();
  }

  /**
   * Start speech recognition using Capacitor NativeVoice plugin (Android)
   * Uses Android's native SpeechRecognizer for true on-device recognition
   */
  async function startCapacitorNativeSpeech(continuous: boolean = false): Promise<void> {
    // Don't start if TTS is playing
    if (getTTSPlaying()) {
      console.log('[useMicrophone] TTS playing, not starting Capacitor STT');
      return;
    }

    try {
      isRecording.set(true);
      isNativeMode.set(true);
      interimTranscript.set('');
      signalMicActivity();

      // Set up event listeners for real-time feedback
      const partialListener = await NativeVoice.addListener('sttPartialResult', (result) => {
        console.log('[useMicrophone] Capacitor partial:', result.transcript);
        interimTranscript.set(result.transcript);
      });

      const volumeListener = await NativeVoice.addListener('sttVolume', (data) => {
        // Could use for visualization
      });

      const errorListener = await NativeVoice.addListener('sttError', (error) => {
        console.error('[useMicrophone] Capacitor STT error:', error);
        if (error.error !== 'No speech detected') {
          onSystemMessage(`⚠️ Speech error: ${error.error}`);
        }
        isRecording.set(false);
        isNativeMode.set(false);
      });

      // Start listening and wait for result
      const result = await NativeVoice.startListening({ language: 'en-US' });

      // Clean up listeners
      await partialListener.remove();
      await volumeListener.remove();
      await errorListener.remove();

      console.log('[useMicrophone] Capacitor STT result:', result.transcript);
      interimTranscript.set('');
      isRecording.set(false);
      isNativeMode.set(false);

      if (result.transcript.trim()) {
        onTranscript(result.transcript.trim());
      }

      // In continuous mode, restart after a short delay
      if (continuous && isComponentMounted() && !getTTSPlaying()) {
        setTimeout(() => {
          if (isComponentMounted() && !getTTSPlaying()) {
            startCapacitorNativeSpeech(true);
          }
        }, 500);
      }

    } catch (e) {
      console.error('[useMicrophone] Capacitor STT failed:', e);
      isRecording.set(false);
      isNativeMode.set(false);
      onSystemMessage('⚠️ Speech recognition failed');
    }
  }

  /**
   * Start native speech recognition (single utterance mode)
   * Uses Capacitor NativeVoice plugin when in Android app, otherwise Web Speech API
   */
  function startNativeSpeech(continuous: boolean = false): void {
    // Try Capacitor NativeVoice plugin first (true Android SpeechRecognizer)
    if (isCapacitorNative()) {
      console.log('[useMicrophone] Using Capacitor NativeVoice plugin (Android SpeechRecognizer)');
      startCapacitorNativeSpeech(continuous);
      return;
    }

    // Check for secure context first (HTTPS required for microphone)
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      console.warn('[useMicrophone] Not in secure context (HTTPS required for microphone)');
      onSystemMessage('🔒 Microphone requires HTTPS. Access via https:// instead of http://');
      return;
    }

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
        accumulatedTranscript = '';
        signalMicActivity(); // Signal activity to prevent background agents
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

        // Track accumulated transcript for semantic turn detection
        // This includes both finalized segments and current interim
        if (final.trim()) {
          accumulatedTranscript += ' ' + final.trim();
          accumulatedTranscript = accumulatedTranscript.trim();
        }

        // Update interim transcript for real-time display
        if (interim) {
          interimTranscript.set(interim);
        }

        // When we get a final result
        if (final.trim()) {
          console.log('[useMicrophone] Native transcript (final):', final, 'accumulated:', accumulatedTranscript);
          interimTranscript.set('');

          // Mark that we got a transcript (affects cooldown duration)
          conversationGotTranscript = true;

          // In CONVERSATION MODE (continuous): Don't send immediately!
          // The browser finalizes segments on its own timeline, but we want to wait
          // until OUR silence monitor triggers (respects user's MIC_SILENCE_DELAY).
          // The accumulated transcript will be sent when silence is detected.
          if (conversationModeActive && speechRecognition?.continuous) {
            console.log('[useMicrophone] Conversation mode: accumulating, not sending yet');
            // Don't send - let silence monitor handle it
          } else {
            // Single utterance or continuous mode: send if transcript is substantial
            const trimmed = final.trim();
            // In continuous mode, filter out very short transcripts (likely noise/echo)
            // Require at least 3 words or 15 characters
            const wordCount = trimmed.split(/\s+/).length;
            const isContinuous = get(isContinuousMode);
            if (isContinuous && wordCount < 3 && trimmed.length < 15) {
              console.log('[useMicrophone] Continuous mode: ignoring short transcript (likely noise):', trimmed);
            } else {
              onTranscript(trimmed);
            }
          }
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
          // Over HTTP, this triggers immediately without showing a prompt
          const isSecure = typeof window !== 'undefined' && window.isSecureContext;
          if (!isSecure) {
            onSystemMessage('🔒 Microphone requires HTTPS.');
          } else {
            onSystemMessage('🎤 Microphone access denied. Please allow microphone in browser settings.');
          }
        } else if (event.error === 'network') {
          onSystemMessage('🌐 Network error during speech recognition. Check your connection.');
        } else {
          onSystemMessage(`⚠️ Speech recognition error: ${event.error}`);
        }

        stopNativeSpeech();
      };

      speechRecognition.onend = () => {
        console.log('[useMicrophone] Native speech recognition ended');

        // In continuous mode (desktop), restart after TTS finishes with proper cooldown
        if (continuous && get(isContinuousMode) && isComponentMounted()) {
          if (!getTTSPlaying()) {
            // TTS not playing - restart with small delay
            console.log('[useMicrophone] Restarting continuous native speech recognition...');
            setTimeout(() => {
              if (get(isContinuousMode) && isComponentMounted() && !getTTSPlaying()) {
                startNativeSpeech(true);
              }
            }, 200);
          } else {
            // TTS is playing - poll until it finishes, then restart with longer cooldown
            // to avoid picking up echo from speakers
            console.log('[useMicrophone] TTS playing, waiting to restart continuous mode...');
            const pollForTTSEnd = () => {
              if (!get(isContinuousMode) || !isComponentMounted()) return;
              if (getTTSPlaying()) {
                // Still playing, check again
                setTimeout(pollForTTSEnd, 200);
              } else {
                // TTS finished - wait for audio to settle (prevent echo pickup)
                console.log('[useMicrophone] TTS finished, waiting for cooldown before restart');
                setTimeout(() => {
                  if (get(isContinuousMode) && isComponentMounted() && !getTTSPlaying()) {
                    console.log('[useMicrophone] Cooldown complete, restarting continuous mode');
                    startNativeSpeech(true);
                  }
                }, 800); // 800ms cooldown after TTS to prevent echo
              }
            };
            setTimeout(pollForTTSEnd, 200);
          }
        }
        // In conversation mode (long-press), send any remaining transcript then schedule restart
        // Browser can end recognition at any time, so we must capture transcript here as safety net
        else if (conversationModeActive && isComponentMounted()) {
          console.log('[useMicrophone] Conversation mode: recognition ended');

          // Stop silence monitor first (prevents double-send if it was about to fire)
          stopConversationSilenceMonitor();

          // Send any accumulated transcript that wasn't sent yet
          const currentInterim = get(interimTranscript);
          let fullTranscript = accumulatedTranscript;
          if (currentInterim.trim()) {
            fullTranscript += ' ' + currentInterim.trim();
          }
          fullTranscript = fullTranscript.trim();

          if (fullTranscript) {
            console.log('[useMicrophone] Sending transcript from onend:', fullTranscript);
            conversationGotTranscript = true;
            onTranscript(fullTranscript);
          }

          // Reset for next turn
          accumulatedTranscript = '';
          isRecording.set(false);
          isNativeMode.set(false);
          interimTranscript.set('');

          // Schedule restart after TTS
          scheduleConversationRestart();
        }
        // Single input done (tap) - just stop, no auto-restart
        else {
          isRecording.set(false);
          isNativeMode.set(false);
          interimTranscript.set('');
          // Done - no auto-restart of anything
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
    // Cancel any pending restart first
    if (conversationRestartTimer) {
      clearTimeout(conversationRestartTimer);
      conversationRestartTimer = null;
    }

    if (speechRecognition) {
      try {
        speechRecognition.abort(); // Use abort() instead of stop() for immediate termination
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
      console.log('[useMicrophone] Using native speech recognition');
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

    // Notify media session that recording stopped (VAD silence detected)
    // This sets state to "paused" so next earbud press sends "play"
    onRecordingAutoStopped();
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
        signalMicActivity(); // Signal activity to prevent background agents
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
      const res = await apiFetch(`/api/stt?format=webm&collect=1&dur=${dur}`, {
        method: 'POST',
        body: buf
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[useMicrophone] STT response:', data);

        if (data?.transcript && data.transcript.trim()) {
          const transcript = data.transcript.trim();
          // In continuous mode, filter out very short transcripts (likely noise/echo)
          // Require at least 3 words or 15 characters
          const wordCount = transcript.split(/\s+/).length;
          if (get(isContinuousMode) && wordCount < 3 && transcript.length < 15) {
            console.log('[useMicrophone] Continuous mode: ignoring short transcript (likely noise):', transcript);
          } else {
            onTranscript(transcript);
          }
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

      // In continuous mode, restart VAD after TTS finishes (with cooldown)
      if (get(isContinuousMode) && isComponentMounted()) {
        if (!getTTSPlaying()) {
          // TTS not playing - restart VAD immediately
          console.log('[useMicrophone] Continuous mode: restarting VAD...');
          runMicVAD();
        } else {
          // TTS is playing - poll until it finishes, then restart with cooldown
          console.log('[useMicrophone] Continuous mode: waiting for TTS to finish...');
          const pollForTTSEnd = () => {
            if (!get(isContinuousMode) || !isComponentMounted()) return;
            if (getTTSPlaying()) {
              setTimeout(pollForTTSEnd, 200);
            } else {
              console.log('[useMicrophone] TTS finished, cooldown before VAD restart...');
              setTimeout(() => {
                if (get(isContinuousMode) && isComponentMounted() && !getTTSPlaying()) {
                  console.log('[useMicrophone] Restarting VAD after cooldown');
                  runMicVAD();
                }
              }, 800); // 800ms cooldown after TTS to prevent echo
            }
          };
          setTimeout(pollForTTSEnd, 200);
        }
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
              signalMicActivity(); // Signal activity to prevent background agents
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
   * Toggle continuous mode (used by long-press or right-click)
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
    // Clean up conversation mode
    if (conversationModeTimer) {
      clearTimeout(conversationModeTimer);
      conversationModeTimer = null;
    }
    if (conversationRestartTimer) {
      clearTimeout(conversationRestartTimer);
      conversationRestartTimer = null;
    }
    conversationModeActive = false;

    // Clean up conversation VAD
    stopConversationVAD();

    // Clean up conversation silence monitor
    stopConversationSilenceMonitor();

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

    // Clean up media session
    disableMediaSession();

    // Reset stores
    isRecording.set(false);
    isNativeMode.set(false);
    interimTranscript.set('');
    isConversationMode.set(false);
  }

  // Media Session state
  let mediaSessionEnabled = false;
  let mediaSessionAudio: HTMLAudioElement | null = null;

  /**
   * Setup Media Session API to capture hardware buttons (earbuds, Bluetooth headsets)
   * This allows users to trigger mic recording via hardware buttons.
   *
   * IMPORTANT: Must be called from a user gesture (click/tap) to work!
   * The silent audio needs user interaction to start playing.
   *
   * Button mappings:
   * - Play/Pause: Toggle mic recording (most common earbud button)
   * - Stop: Stop recording if active
   *
   * Note: Power button long-press cannot be captured - user must disable
   * Google Assistant in Android Settings → Gestures → Power button
   */
  function setupMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      console.warn('[MediaSession] API not available in this browser');
      return;
    }

    if (mediaSessionEnabled && mediaSessionAudio) {
      console.log('[MediaSession] Already enabled, ensuring audio is playing');
      mediaSessionAudio.play().catch(() => {});
      return;
    }

    console.log('[MediaSession] Setting up hardware button capture...');

    // Create a longer silent audio loop (1 second of silence)
    // Short audio clips sometimes don't keep the session alive
    if (!mediaSessionAudio) {
      mediaSessionAudio = new Audio();
      // 1 second of silence at 8kHz mono
      mediaSessionAudio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUoGAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
      mediaSessionAudio.loop = true;
      mediaSessionAudio.volume = 0.01; // Very quiet but not silent (some browsers ignore 0 volume)
    }

    // Set metadata so it shows in notification/lock screen
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'MetaHuman Voice',
      artist: 'Tap play to speak',
      album: 'Voice Assistant',
    });

    // Register play/pause handlers using the shared function
    registerMediaSessionHandlers();

    // Handle stop
    navigator.mediaSession.setActionHandler('stop', () => {
      console.log('[MediaSession] STOP pressed');
      if (get(isRecording)) {
        stopMic();
      }
      if (conversationModeActive) {
        toggleConversationMode();
      }
      navigator.mediaSession.playbackState = 'paused';
    });

    // Handle previous track (some earbuds use this for long-press)
    try {
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        console.log('[MediaSession] PREVIOUS pressed - toggling conversation mode');
        toggleConversationMode();
      });
    } catch (e) {
      // Not supported on all browsers
    }

    // Handle next track (some earbuds use this for long-press)
    try {
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        console.log('[MediaSession] NEXT pressed - toggling conversation mode');
        toggleConversationMode();
      });
    } catch (e) {
      // Not supported on all browsers
    }

    // Start playing immediately (this MUST be called from a user gesture)
    mediaSessionAudio.play().then(() => {
      console.log('[MediaSession] ✓ Enabled! Hardware buttons will now trigger mic.');
      console.log('[MediaSession] Earbud play/pause will toggle recording.');
      mediaSessionEnabled = true;
      isHardwareButtonsActive.set(true);

      // Start in "paused" state - earbuds will send "play" on first press
      // This is the key trick: we match earbud expectations
      navigator.mediaSession.playbackState = 'paused';
      mediaSessionDebugState.set('⏸️ PAUSED (ready)');

    }).catch((err) => {
      console.error('[MediaSession] ✗ Failed to start:', err.message);
      console.log('[MediaSession] Try tapping the mic button first, then use earbuds.');
      isHardwareButtonsActive.set(false);
      mediaSessionDebugState.set('❌ FAILED');
    });
  }

  /**
   * Re-activate media session after TTS finishes
   * Reclaims session ownership and sets state to "paused" (ready for next play)
   */
  function reactivateMediaSession(): void {
    if (!mediaSessionEnabled) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!mediaSessionAudio) {
      console.warn('[MediaSession] No audio element to reactivate');
      mediaSessionDebugState.set('❌ NO AUDIO');
      return;
    }

    console.log('[MediaSession] Reactivating ORIGINAL audio (keeping user gesture context)...');
    mediaSessionDebugState.set('🔄 REACTIVATING...');

    // IMPORTANT: Keep the ORIGINAL audio element created from user gesture!
    // Creating a new Audio() outside a user gesture loses media session priority on mobile.

    // Just restart the existing audio
    mediaSessionAudio.currentTime = 0;
    mediaSessionAudio.play().then(() => {
      console.log('[MediaSession] ✓ Original audio restarted');

      // Re-register handlers (in case they were overwritten)
      registerMediaSessionHandlers();

      // Set to PAUSED - ready for user to press "play"
      navigator.mediaSession.playbackState = 'paused';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'MetaHuman Voice',
        artist: '⏸️ Ready - tap play',
        album: 'Voice Assistant',
      });

      mediaSessionDebugState.set('⏸️ PAUSED (reactivated)');
      console.log('[MediaSession] State = PAUSED (ready for play)');
    }).catch((e) => {
      console.warn('[MediaSession] Failed to reactivate:', e.message);
      mediaSessionDebugState.set('❌ REACTIVATE FAILED');
    });
  }

  /**
   * Register media session handlers
   *
   * LITERAL PLAY/PAUSE MODEL:
   * - PLAY = Start recording (we're actively "playing" = listening)
   * - PAUSE = Stop recording (either manual or silence-detected)
   *
   * Flow:
   * 1. User presses PLAY → recording starts, state = "playing"
   * 2. Silence detected (VAD) → recording stops, audio sent, state = "paused"
   * 3. User presses PLAY again → recording starts, state = "playing"
   * 4. Repeat
   */
  function registerMediaSessionHandlers(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    // PLAY = Start recording
    navigator.mediaSession.setActionHandler('play', () => {
      console.log('[MediaSession] ▶️ PLAY pressed - starting recording');
      mediaSessionDebugState.set('▶️ PLAY (recording)');

      // Keep audio playing to maintain session ownership
      if (mediaSessionAudio) {
        mediaSessionAudio.currentTime = 0;
        mediaSessionAudio.play().catch(() => {});
      }

      // Only start if not already recording
      if (!get(isRecording)) {
        startMic();

        // We're now "playing" (actively listening)
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'MetaHuman Voice',
          artist: '🎤 Listening...',
          album: 'Voice Assistant',
        });
      }
    });

    // PAUSE = Stop recording (manual interrupt)
    navigator.mediaSession.setActionHandler('pause', () => {
      console.log('[MediaSession] ⏸️ PAUSE pressed - stopping recording');
      mediaSessionDebugState.set('⏸️ PAUSE (manual)');

      // Keep audio playing to maintain session ownership
      if (mediaSessionAudio) {
        mediaSessionAudio.currentTime = 0;
        mediaSessionAudio.play().catch(() => {});
      }

      // Stop if currently recording
      if (get(isRecording)) {
        stopMic();
      }

      // We're now "paused" (waiting for next play)
      navigator.mediaSession.playbackState = 'paused';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'MetaHuman Voice',
        artist: '⏸️ Ready - tap play',
        album: 'Voice Assistant',
      });
    });
  }

  /**
   * Called when VAD detects silence and stops recording
   * Sets media session to "paused" so next earbud press sends "play"
   */
  function onRecordingAutoStopped(): void {
    if (!mediaSessionEnabled) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    console.log('[MediaSession] Recording auto-stopped (silence detected), setting PAUSED');
    mediaSessionDebugState.set('⏸️ PAUSED (silence)');

    // Keep audio playing to maintain ownership
    if (mediaSessionAudio) {
      mediaSessionAudio.play().catch(() => {});
    }

    // Set to paused - next button press will send "play"
    navigator.mediaSession.playbackState = 'paused';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'MetaHuman Voice',
      artist: '⏸️ Ready - tap play',
      album: 'Voice Assistant',
    });
  }

  /**
   * Disable Media Session hardware button capture
   */
  function disableMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', null);
    navigator.mediaSession.setActionHandler('pause', null);
    navigator.mediaSession.setActionHandler('stop', null);
    try { navigator.mediaSession.setActionHandler('previoustrack', null); } catch {}
    try { navigator.mediaSession.setActionHandler('nexttrack', null); } catch {}
    navigator.mediaSession.metadata = null;

    if (mediaSessionAudio) {
      mediaSessionAudio.pause();
      mediaSessionAudio.src = '';
      mediaSessionAudio = null;
    }

    mediaSessionEnabled = false;
    isHardwareButtonsActive.set(false);
    console.log('[MediaSession] Disabled');
  }

  /**
   * Toggle hardware button capture on/off
   */
  function toggleMediaSession(): void {
    if (mediaSessionEnabled) {
      disableMediaSession();
    } else {
      setupMediaSession();
    }
  }

  return {
    // Stores
    isRecording,
    isContinuousMode,
    queuedMessage,
    isNativeMode,       // Whether currently using native speech recognition
    interimTranscript,  // Real-time transcript preview (native mode only)
    whisperStatus,      // Whisper server status (checked once on load, no polling)
    isConversationMode, // Conversation mode active (any speech triggers)
    isWakeWordListening, // Deprecated: always false (for UI compatibility)
    wakeWordDetected,   // Deprecated: always false (for UI compatibility)
    isHardwareButtonsActive, // Media Session active (earbuds can trigger mic)
    mediaSessionDebugState,  // Debug state for mobile testing

    // Methods
    loadVADSettings,
    startMic,           // Single press: one voice input
    stopMic,
    toggleContinuousMode, // Right-click for continuous VAD
    toggleConversationMode, // Long-press for conversation mode
    cleanup,

    // Media Session (hardware button capture)
    setupMediaSession,        // Enable earbud/headset button capture
    disableMediaSession,      // Disable hardware button capture
    toggleMediaSession,       // Toggle on/off
    reactivateMediaSession,   // Re-activate after TTS plays (reclaim media session)

    // Configuration
    getSTTBackend,
    setSTTBackend,

    // Utilities
    isNativeSpeechAvailable,
    isMobileDevice,
  };
}

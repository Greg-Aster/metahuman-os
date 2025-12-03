/**
 * Microphone & Voice Activity Detection (VAD) Composable
 * Handles voice input, speech-to-text, and auto-send functionality
 *
 * Supports two STT backends:
 * - Native: Uses browser's SpeechRecognition API (fast, on-device, mobile-friendly)
 * - Whisper: Records audio and sends to server for transcription (more accurate, requires upload)
 */

import { writable, get } from 'svelte/store';
import { calculateVoiceVolume } from '../utils/audio-utils.js';

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
  fetch('/api/activity-ping', { method: 'POST' }).catch(() => {
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

  // Mobile VAD settings (loaded from user profile) - used for conversation mode on mobile
  // Higher threshold to filter ambient noise, requires sustained voice
  let MOBILE_VOICE_THRESHOLD = 25; // Higher threshold for mobile ambient noise
  let MOBILE_SILENCE_DELAY = 1500; // How long to wait in silence before stopping
  let MOBILE_MIN_DURATION = 500; // Minimum recording duration
  let MOBILE_SUSTAINED_FRAMES = 5; // Require ~5 frames (~80ms) of sustained voice
  let MOBILE_RESTART_COOLDOWN = 2000; // How long to wait after TTS before ready state
  let MOBILE_STARTUP_DELAY = 500; // How long to ignore audio after mic activates
  let MOBILE_SEMANTIC_TURN_DETECTION = false; // Use LLM to detect end of utterance
  let MOBILE_SEMANTIC_MIN_CONFIDENCE = 0.7; // Min confidence to accept LLM's decision

  // Wake word settings (mobile-only, loaded from user profile)
  // Like "hey google" - always listening for trigger phrase, then activates conversation mode
  // NOTE: Disabled by default - browser SpeechRecognition is NOT suitable for wake word detection
  // (unlike Google which uses dedicated hardware DSP chips with purpose-built neural networks)
  let wakeWordEnabled = false; // Disabled by default - browser APIs can't do this reliably
  let wakeWordPhrases = ['hey greg', 'hey metahuman', 'okay greg'];
  let wakeWordTimeout = 30000; // How long conversation mode stays active (30s inactivity timeout)
  let wakeWordConfirmation = true; // Play confirmation sound/vibrate

  // Conversation mode state (mobile-only)
  // When active, system listens for ANY speech (not just wake word)
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

  /**
   * Check if the current utterance is semantically complete using LLM
   * Returns true if user appears to be done speaking, false if they might continue
   */
  async function checkSemanticTurnComplete(transcript: string): Promise<boolean> {
    if (!MOBILE_SEMANTIC_TURN_DETECTION || !transcript.trim()) {
      return true; // Disabled or no transcript - default to complete
    }

    // Don't re-check the same transcript
    if (transcript === lastSemanticCheckTranscript) {
      return true;
    }

    // Prevent concurrent checks
    if (semanticCheckInProgress) {
      return false; // Wait for current check to finish
    }

    try {
      semanticCheckInProgress = true;
      lastSemanticCheckTranscript = transcript;

      const response = await fetch('/api/semantic-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript })
      });

      if (!response.ok) {
        console.warn('[useMicrophone] Semantic turn check failed:', response.status);
        return true; // On error, default to complete
      }

      const result = await response.json();
      const isComplete = result.complete && result.confidence >= MOBILE_SEMANTIC_MIN_CONFIDENCE;

      console.log(`[useMicrophone] Semantic turn: "${transcript.substring(0, 30)}..." → ${isComplete ? 'COMPLETE' : 'INCOMPLETE'} (conf: ${result.confidence?.toFixed(2)}, reason: ${result.reason})`);

      return isComplete;
    } catch (error) {
      console.error('[useMicrophone] Semantic turn check error:', error);
      return true; // On error, default to complete
    } finally {
      semanticCheckInProgress = false;
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
  // Uses user's MOBILE_SILENCE_DELAY setting to determine when to stop
  let conversationSilenceMonitorRunning = false;
  let conversationSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  let conversationSilenceMonitorStream: MediaStream | null = null;
  let conversationSilenceMonitorAudioCtx: AudioContext | null = null;
  let conversationSilenceMonitorAnalyser: AnalyserNode | null = null;
  let conversationSilenceMonitorAnimFrame: number | null = null;
  let conversationHasReceivedSpeech = false; // Track if we've received any speech in this session

  // Semantic turn detection state
  let semanticCheckInProgress = false; // Prevent multiple concurrent checks
  let lastSemanticCheckTranscript = ''; // Track what we last checked
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
  const isWakeWordListening = writable(false); // Wake word detection active (mobile only)
  const wakeWordDetected = writable(false); // Wake word was just triggered
  const isConversationMode = writable(false); // Conversation mode active (any speech triggers)

  // Native speech recognition state
  let speechRecognition: ISpeechRecognition | null = null;
  let wakeWordRecognition: ISpeechRecognition | null = null; // Separate instance for wake word detection
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
          console.log('[useMicrophone] Loaded VAD settings (desktop):', {
            MIC_VOICE_THRESHOLD,
            MIC_SILENCE_DELAY,
            MIC_MIN_DURATION
          });
        }

        // Load mobile VAD settings (for conversation mode on mobile)
        if (config.stt?.mobileVad) {
          MOBILE_VOICE_THRESHOLD = config.stt.mobileVad.voiceThreshold ?? 25;
          MOBILE_SILENCE_DELAY = config.stt.mobileVad.silenceDelay ?? 1500;
          MOBILE_MIN_DURATION = config.stt.mobileVad.minDuration ?? 500;
          MOBILE_SUSTAINED_FRAMES = config.stt.mobileVad.sustainedFrames ?? 5;
          MOBILE_RESTART_COOLDOWN = config.stt.mobileVad.restartCooldown ?? 2000;
          MOBILE_STARTUP_DELAY = config.stt.mobileVad.startupDelay ?? 500;
          MOBILE_SEMANTIC_TURN_DETECTION = config.stt.mobileVad.semanticTurnDetection ?? false;
          MOBILE_SEMANTIC_MIN_CONFIDENCE = config.stt.mobileVad.semanticMinConfidence ?? 0.7;
          console.log('[useMicrophone] Loaded mobile VAD settings:', {
            MOBILE_VOICE_THRESHOLD,
            MOBILE_SILENCE_DELAY,
            MOBILE_MIN_DURATION,
            MOBILE_SUSTAINED_FRAMES,
            MOBILE_RESTART_COOLDOWN,
            MOBILE_STARTUP_DELAY,
            MOBILE_SEMANTIC_TURN_DETECTION,
            MOBILE_SEMANTIC_MIN_CONFIDENCE
          });
        }

        // Load wake word settings (mobile-only feature)
        if (config.stt?.wakeWord && isMobileDevice()) {
          wakeWordEnabled = config.stt.wakeWord.enabled ?? false;
          wakeWordPhrases = config.stt.wakeWord.phrases ?? ['hey greg', 'hey metahuman'];
          wakeWordTimeout = config.stt.wakeWord.timeout ?? 30000;
          wakeWordConfirmation = config.stt.wakeWord.confirmationSound ?? true;
          console.log('[useMicrophone] Loaded wake word settings:', {
            wakeWordEnabled,
            wakeWordPhrases,
            wakeWordTimeout
          });

          // NOTE: Auto-start disabled - user must long-press mic to activate wake word/conversation mode
          // This prevents constant triggering on page load
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
   * Check if transcript contains any wake word phrase
   */
  function containsWakeWord(transcript: string): boolean {
    const lower = transcript.toLowerCase().trim();
    return wakeWordPhrases.some(phrase => lower.includes(phrase.toLowerCase()));
  }

  /**
   * Enter conversation mode - system listens for ANY speech (not just wake word)
   * Auto-restarts listening after each exchange until timeout
   */
  function enterConversationMode(): void {
    console.log('[useMicrophone] Entering conversation mode');
    conversationModeActive = true;
    isConversationMode.set(true);
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
    }, wakeWordTimeout);
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

    // Use user-configurable cooldown from Voice Settings
    // If no transcript (noise triggered it), double the cooldown to prevent loops
    const cooldownAfterTTS = conversationGotTranscript ? MOBILE_RESTART_COOLDOWN : (MOBILE_RESTART_COOLDOWN * 2);
    const minWaitForLLM = conversationGotTranscript ? 2000 : cooldownAfterTTS;

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
            // Ready to listen again
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

    console.log('[useMicrophone] Starting conversation VAD (threshold:', MOBILE_VOICE_THRESHOLD, ', sustainedFrames:', MOBILE_SUSTAINED_FRAMES, ')');

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
   * Uses MOBILE_SILENCE_DELAY to determine when to stop (respects user settings)
   */
  async function startConversationSilenceMonitor(): Promise<void> {
    if (conversationSilenceMonitorRunning) return;

    console.log('[useMicrophone] Starting conversation silence monitor (silenceDelay:', MOBILE_SILENCE_DELAY, 'ms)');

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
  }

  /**
   * Run conversation silence monitor loop
   * Detects when user stops talking and triggers stop after MOBILE_SILENCE_DELAY
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
    if (vol > MOBILE_VOICE_THRESHOLD) {
      conversationHasReceivedSpeech = true;
      // Clear any pending silence timer
      if (conversationSilenceTimer) {
        clearTimeout(conversationSilenceTimer);
        conversationSilenceTimer = null;
      }
    }
    // Silence detected - start/continue silence timer
    else if (conversationHasReceivedSpeech && !conversationSilenceTimer) {
      // Only start silence timer if we've received speech (prevents immediate trigger)
      console.log('[useMicrophone] Silence detected, starting timer (' + MOBILE_SILENCE_DELAY + 'ms)');
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

        // If semantic turn detection is enabled, check if utterance is complete
        if (MOBILE_SEMANTIC_TURN_DETECTION && fullTranscript) {
          const isComplete = await checkSemanticTurnComplete(fullTranscript);

          if (!isComplete) {
            // User might continue - extend the wait
            console.log('[useMicrophone] Semantic: utterance incomplete, waiting for more speech');
            conversationSilenceTimer = null; // Allow new silence timer to start
            return; // Don't stop - keep listening
          }
          console.log('[useMicrophone] Semantic: utterance complete, sending');
        }

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
          onTranscript(fullTranscript);
        }
      }, MOBILE_SILENCE_DELAY);
    }

    conversationSilenceMonitorAnimFrame = requestAnimationFrame(runConversationSilenceMonitor);
  }

  /**
   * Run conversation VAD loop
   * Detects voice and starts speech recognition when SUSTAINED voice is detected
   * Uses mobile-specific thresholds to filter ambient noise
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

    // Startup delay - ignore audio after mic activates (user-configurable)
    // This prevents the phone's "ding" sound from triggering VAD
    const timeSinceStart = Date.now() - conversationVadStartTime;
    if (timeSinceStart < MOBILE_STARTUP_DELAY) {
      conversationVadSustainedFrames = 0; // Don't accumulate frames during startup
      conversationVadAnimFrame = requestAnimationFrame(runConversationVAD);
      return;
    }

    // Calculate voice volume using voice-frequency-focused analysis
    const vol = calculateVoiceVolume(conversationVadAnalyser, 150);

    // Check if volume is above mobile threshold
    if (vol > MOBILE_VOICE_THRESHOLD) {
      conversationVadSustainedFrames++;

      // Require sustained voice (multiple consecutive frames above threshold)
      // This prevents short noise spikes from triggering speech recognition
      if (conversationVadSustainedFrames >= MOBILE_SUSTAINED_FRAMES) {
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
        // This uses MOBILE_SILENCE_DELAY from user settings
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
   * Schedule restart of wake word detection after TTS finishes
   * Called when single voice input ends (tap or wake word trigger)
   */
  function scheduleWakeWordRestart(): void {
    if (!wakeWordEnabled || !isMobileDevice() || !isComponentMounted()) return;

    // Wait for TTS to finish, then restart wake word listening
    const checkAndRestart = () => {
      if (!isComponentMounted()) return;

      // Don't restart if conversation mode became active or already recording
      if (conversationModeActive || get(isRecording) || get(isWakeWordListening)) return;

      if (getTTSPlaying()) {
        // TTS still playing, check again in 300ms
        setTimeout(checkAndRestart, 300);
      } else {
        // TTS done, restart wake word listening
        console.log('[useMicrophone] TTS finished, restarting wake word detection');
        setTimeout(() => {
          if (isComponentMounted() && !getTTSPlaying() && !get(isRecording) && !conversationModeActive) {
            startWakeWordDetection();
          }
        }, 500); // Small delay after TTS ends
      }
    };

    // Start checking after a brief delay (give TTS time to start)
    setTimeout(checkAndRestart, 1000);
  }

  /**
   * Start wake word detection (mobile-only)
   * Listens continuously for wake word, then activates full speech recognition
   */
  function startWakeWordDetection(): void {
    // Only works on mobile with native speech
    if (!isMobileDevice() || !NativeSpeechRecognition) {
      console.warn('[useMicrophone] Wake word detection only available on mobile');
      return;
    }

    if (!wakeWordEnabled) {
      console.log('[useMicrophone] Wake word detection disabled in settings');
      return;
    }

    // Check for secure context
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      console.warn('[useMicrophone] Wake word requires HTTPS');
      onSystemMessage('🔒 Wake word requires HTTPS');
      return;
    }

    // Don't start if already listening or TTS is playing
    if (get(isWakeWordListening) || getTTSPlaying()) {
      return;
    }

    // Clean up any existing instance
    if (wakeWordRecognition) {
      try { wakeWordRecognition.abort(); } catch {}
      wakeWordRecognition = null;
    }

    try {
      wakeWordRecognition = new NativeSpeechRecognition();
      wakeWordRecognition.continuous = true; // Keep listening
      wakeWordRecognition.interimResults = true; // Check interim for faster response
      wakeWordRecognition.lang = 'en-US';

      wakeWordRecognition.onstart = () => {
        console.log('[useMicrophone] Wake word detection started, listening for:', wakeWordPhrases);
        isWakeWordListening.set(true);
      };

      wakeWordRecognition.onresult = (event: SpeechRecognitionEvent) => {
        // Check all results for wake word
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;

          if (containsWakeWord(transcript)) {
            console.log('[useMicrophone] Wake word detected:', transcript);

            // Stop wake word detection temporarily
            stopWakeWordDetection();

            // Show confirmation (visual only, no message spam)
            if (wakeWordConfirmation) {
              wakeWordDetected.set(true);
              // Reset after brief moment
              setTimeout(() => wakeWordDetected.set(false), 500);
            }

            // Vibrate on mobile for haptic feedback
            if (navigator.vibrate) {
              navigator.vibrate(100);
            }

            // Start single voice input (NOT conversation mode)
            // After this completes, we'll restart wake word listening
            setTimeout(() => {
              startNativeSpeech(false); // Single utterance
            }, 100);

            return;
          }
        }
      };

      wakeWordRecognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // Silently handle common errors - wake word detection should be unobtrusive
        if (event.error === 'no-speech' || event.error === 'aborted') {
          // Expected - just restart
        } else {
          console.error('[useMicrophone] Wake word error:', event.error);
        }
      };

      wakeWordRecognition.onend = () => {
        // Auto-restart if still supposed to be listening
        // Use longer delay (1s) to prevent rapid cycling
        if (get(isWakeWordListening) && isComponentMounted() && !getTTSPlaying() && !get(isRecording) && !conversationModeActive) {
          setTimeout(() => {
            if (get(isWakeWordListening) && isComponentMounted() && !getTTSPlaying() && !get(isRecording) && !conversationModeActive) {
              try {
                wakeWordRecognition?.start();
              } catch {
                // May fail if already started
              }
            }
          }, 1000); // 1 second delay to prevent rapid cycling
        } else {
          isWakeWordListening.set(false);
        }
      };

      wakeWordRecognition.start();
    } catch (e) {
      console.error('[useMicrophone] Failed to start wake word detection:', e);
      isWakeWordListening.set(false);
    }
  }

  /**
   * Stop wake word detection
   */
  function stopWakeWordDetection(): void {
    if (wakeWordRecognition) {
      try { wakeWordRecognition.abort(); } catch {}
      wakeWordRecognition = null;
    }
    isWakeWordListening.set(false);
  }

  /**
   * Toggle wake word detection on/off
   */
  function toggleWakeWord(): void {
    if (get(isWakeWordListening)) {
      stopWakeWordDetection();
      // Silent - visual indicator is enough
    } else {
      if (!wakeWordEnabled) {
        console.log('[useMicrophone] Wake word not enabled in settings');
        return;
      }
      startWakeWordDetection();
      // Silent - visual indicator is enough
    }
  }

  /**
   * Start conversation mode directly (triggered by long-press on mobile)
   * Enters conversation mode and starts VAD listening for actual voice
   * VAD will detect voice and start speech recognition only when voice is detected
   */
  function startConversationMode(): void {
    // Check for secure context first
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      onSystemMessage('🔒 Microphone requires HTTPS');
      return;
    }

    if (!NativeSpeechRecognition) {
      onSystemMessage('⚠️ Speech recognition not available');
      return;
    }

    // Stop wake word detection if active
    stopWakeWordDetection();

    // Enter conversation mode
    enterConversationMode();

    // Vibrate for feedback
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }

    // Silent start - green icon is enough visual feedback

    // Start VAD listening (will start speech recognition when voice is detected)
    // This prevents ambient noise from triggering recording
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
   * Toggle conversation mode on/off (for long-press)
   */
  function toggleConversationMode(): void {
    if (conversationModeActive) {
      stopConversationMode();
    } else {
      startConversationMode();
    }
  }

  /**
   * Start native speech recognition (single utterance mode)
   * Uses browser's built-in speech-to-text - fast, on-device, no upload
   */
  function startNativeSpeech(continuous: boolean = false): void {
    // Check for secure context first (HTTPS required for microphone on mobile)
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
        // Reset semantic turn detection state for new session
        accumulatedTranscript = '';
        lastSemanticCheckTranscript = '';
        semanticCheckInProgress = false;
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
          // until OUR silence monitor triggers (respects user's MOBILE_SILENCE_DELAY).
          // The accumulated transcript will be sent when silence is detected.
          if (conversationModeActive && speechRecognition?.continuous) {
            console.log('[useMicrophone] Conversation mode: accumulating, not sending yet');
            // Don't send - let silence monitor handle it
          } else {
            // Single utterance mode: send immediately
            onTranscript(final.trim());
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
          // On mobile over HTTP, this triggers immediately without showing a prompt
          const isSecure = typeof window !== 'undefined' && window.isSecureContext;
          if (!isSecure) {
            onSystemMessage('🔒 Microphone requires HTTPS. Use https:// URL on mobile.');
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

        // In continuous mode (desktop), restart if we're still supposed to be recording
        if (continuous && get(isContinuousMode) && isComponentMounted() && !getTTSPlaying()) {
          console.log('[useMicrophone] Restarting continuous native speech recognition...');
          // Small delay to prevent rapid restart loops
          setTimeout(() => {
            if (get(isContinuousMode) && isComponentMounted() && !getTTSPlaying()) {
              startNativeSpeech(true);
            }
          }, 100);
        }
        // In conversation mode (mobile long-press), schedule restart after TTS finishes
        else if (conversationModeActive && isComponentMounted()) {
          console.log('[useMicrophone] Conversation mode active, scheduling restart after TTS');
          isRecording.set(false);
          isNativeMode.set(false);
          interimTranscript.set('');
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

    // Clean up wake word detection
    stopWakeWordDetection();

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
    isWakeWordListening.set(false);
    wakeWordDetected.set(false);
    isConversationMode.set(false);
  }

  return {
    // Stores
    isRecording,
    isContinuousMode,
    queuedMessage,
    isNativeMode,       // Whether currently using native speech recognition
    interimTranscript,  // Real-time transcript preview (native mode only)
    whisperStatus,      // Whisper server status (checked once on load, no polling)
    isWakeWordListening, // Wake word detection active (mobile only)
    wakeWordDetected,   // Wake word was just triggered
    isConversationMode, // Conversation mode active (mobile, any speech triggers)

    // Methods
    loadVADSettings,
    startMic,           // Single press: one voice input
    stopMic,
    toggleContinuousMode, // Desktop: right-click for continuous VAD
    toggleConversationMode, // Mobile: long-press for conversation mode
    toggleWakeWord,     // Toggle wake word detection (mobile only)
    startWakeWordDetection,
    stopWakeWordDetection,
    cleanup,

    // Configuration
    getSTTBackend,
    setSTTBackend,

    // Utilities
    isNativeSpeechAvailable,
    isMobileDevice,
  };
}

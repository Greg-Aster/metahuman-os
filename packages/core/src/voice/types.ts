/**
 * Voice Loop Types
 *
 * Type definitions for the live voice interaction system.
 * Part of Phase 5: Voice Agent + System Operator
 */

// ============================================================================
// Audio Configuration
// ============================================================================

export interface AudioConfig {
  sampleRate: number;       // Default: 16000 Hz for ASR
  channels: number;         // Default: 1 (mono)
  bitDepth: number;         // Default: 16
  encoding: 'pcm' | 'opus' | 'mp3' | 'wav';
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  encoding: 'pcm',
};

// ============================================================================
// ASR (Automatic Speech Recognition)
// ============================================================================

export interface ASRConfig {
  model: string;            // e.g., 'whisper-small', 'whisper-medium'
  language?: string;        // e.g., 'en', 'auto'
  vadEnabled: boolean;      // Voice Activity Detection
  vadThreshold: number;     // 0.0 - 1.0
  silenceTimeout: number;   // ms before considering speech ended
  maxDuration: number;      // max recording duration in ms
}

export const DEFAULT_ASR_CONFIG: ASRConfig = {
  model: 'whisper-small',
  language: 'en',
  vadEnabled: true,
  vadThreshold: 0.5,
  silenceTimeout: 1500,
  maxDuration: 30000,
};

export interface ASRResult {
  text: string;
  confidence: number;
  language: string;
  duration: number;
  words?: ASRWord[];
  isFinal: boolean;
}

export interface ASRWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export type ASRState = 'idle' | 'listening' | 'processing' | 'error';

// ============================================================================
// TTS (Text-to-Speech)
// ============================================================================

export interface VoiceTTSConfig {
  model: string;            // e.g., 'piper', 'kokoro'
  voice: string;            // Voice ID
  speed: number;            // 0.5 - 2.0
  pitch: number;            // 0.5 - 2.0
  volume: number;           // 0.0 - 1.0
  streaming: boolean;       // Stream audio chunks
}

export const DEFAULT_VOICE_TTS_CONFIG: VoiceTTSConfig = {
  model: 'piper',
  voice: 'en_US-lessac-medium',
  speed: 1.0,
  pitch: 1.0,
  volume: 1.0,
  streaming: true,
};

export interface TTSResult {
  audioData: Buffer | Uint8Array;
  format: AudioConfig;
  duration: number;
  text: string;
}

export type TTSState = 'idle' | 'synthesizing' | 'playing' | 'paused' | 'error';

// ============================================================================
// Voice Loop State
// ============================================================================

export type VoiceLoopState =
  | 'idle'           // Not active
  | 'listening'      // Listening for user speech
  | 'processing'     // Processing speech to text
  | 'thinking'       // Generating response
  | 'speaking'       // Playing TTS response
  | 'interrupted'    // Barge-in detected
  | 'error';         // Error state

export interface VoiceLoopStatus {
  state: VoiceLoopState;
  asrState: ASRState;
  ttsState: TTSState;
  isActive: boolean;
  lastActivity: string;
  currentTranscript?: string;
  currentResponse?: string;
  errorMessage?: string;
}

// ============================================================================
// Turn Taking
// ============================================================================

export interface Turn {
  id: string;
  speaker: 'user' | 'assistant';
  startTime: string;
  endTime?: string;
  transcript?: string;
  audioPath?: string;
  interrupted: boolean;
}

export interface ConversationSession {
  id: string;
  startTime: string;
  endTime?: string;
  turns: Turn[];
  username: string;
  deviceId?: string;
}

// ============================================================================
// Barge-In
// ============================================================================

export interface BargeInConfig {
  enabled: boolean;
  sensitivity: number;      // 0.0 - 1.0
  minInterruptDuration: number; // ms of speech before interrupt triggers
  gracePeriod: number;      // ms after TTS starts before barge-in allowed
}

export const DEFAULT_BARGEIN_CONFIG: BargeInConfig = {
  enabled: true,
  sensitivity: 0.6,
  minInterruptDuration: 200,
  gracePeriod: 500,
};

// ============================================================================
// Voice Loop Events
// ============================================================================

export type VoiceLoopEventType =
  | 'state_change'
  | 'speech_start'
  | 'speech_end'
  | 'transcript_partial'
  | 'transcript_final'
  | 'response_start'
  | 'response_chunk'
  | 'response_end'
  | 'barge_in'
  | 'error';

export interface VoiceLoopEvent {
  type: VoiceLoopEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type VoiceLoopEventHandler = (event: VoiceLoopEvent) => void;

// ============================================================================
// Voice Loop Configuration
// ============================================================================

export interface VoiceLoopConfig {
  audio: AudioConfig;
  asr: ASRConfig;
  tts: VoiceTTSConfig;
  bargeIn: BargeInConfig;
  autoStart: boolean;
  saveTranscripts: boolean;
  saveAudio: boolean;
}

export const DEFAULT_VOICE_LOOP_CONFIG: VoiceLoopConfig = {
  audio: DEFAULT_AUDIO_CONFIG,
  asr: DEFAULT_ASR_CONFIG,
  tts: DEFAULT_VOICE_TTS_CONFIG,
  bargeIn: DEFAULT_BARGEIN_CONFIG,
  autoStart: false,
  saveTranscripts: true,
  saveAudio: false,
};

// ============================================================================
// Device Presence
// ============================================================================

export interface DeviceInfo {
  id: string;
  name: string;
  type: 'web' | 'mobile' | 'desktop' | 'speaker';
  capabilities: DeviceCapabilities;
  lastSeen: string;
  isActive: boolean;
}

export interface DeviceCapabilities {
  microphone: boolean;
  speaker: boolean;
  screenShare: boolean;
  wakeWord: boolean;
}

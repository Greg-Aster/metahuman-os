/**
 * TTS Provider Interface
 * Common interface for all text-to-speech providers
 */

export interface TTSSynthesizeOptions {
  /** AbortSignal for cancellation */
  signal?: globalThis.AbortSignal;
  /** Speaking rate multiplier (0.5 - 2.0) */
  speakingRate?: number;
  /** Custom voice/model identifier */
  voice?: string;
  /** Pitch shift in semitones (RVC only, -12 to +12) */
  pitchShift?: number;
  /** Additional provider-specific options */
  [key: string]: any;
}

export interface TTSStatus {
  provider: string;
  available: boolean;
  modelPath?: string;
  serverUrl?: string;
  cacheEnabled: boolean;
  cacheSize: number;
  cacheFiles: number;
  error?: string;
}

export interface ITextToSpeechService {
  /**
   * Synthesize text to speech
   * @param text - The text to convert to speech
   * @param options - Optional synthesis parameters
   * @returns Audio buffer (WAV format)
   */
  synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer>;

  /**
   * Get provider status and configuration
   */
  getStatus(): TTSStatus | Promise<TTSStatus>;

  /**
   * Clear provider cache (if applicable)
   */
  clearCache?(): void;
}

export interface PiperConfig {
  binary: string;
  model: string;
  config: string;
  speakingRate: number;
  outputFormat: 'wav';
}

export interface SoVITSConfig {
  serverUrl: string;
  referenceAudioDir: string;
  speakerId: string;
  temperature: number;
  speed: number;
  outputFormat: 'wav';
  timeout: number;
  autoFallbackToPiper: boolean;
}

export interface RVCConfig {
  referenceAudioDir: string;
  modelsDir: string;
  speakerId: string;
  pitchShift: number;
  speed: number;
  outputFormat: 'wav';
  autoFallbackToPiper: boolean;
}

export interface TTSConfig {
  provider: 'piper' | 'gpt-sovits' | 'rvc';
  piper: PiperConfig;
  sovits: SoVITSConfig;
  rvc?: RVCConfig;
}

export interface CacheConfig {
  enabled: boolean;
  directory: string;
  maxSizeMB: number;
}

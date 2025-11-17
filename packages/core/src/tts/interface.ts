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
  // Server configuration
  serverUrl?: string;         // HTTP server URL for persistent inference (default: http://127.0.0.1:9881)
  useServer?: boolean;        // Prefer server over process spawning (default: true if server is available)
  autoStartServer?: boolean;  // Automatically start the RVC HTTP server when needed (default: true)
  serverStartupTimeoutMs?: number; // How long to wait for the server to become healthy (default: 8000ms)
  // Inference parameters for voice quality tuning
  indexRate?: number;        // Voice retrieval strength (0.0-1.0, default: 1.0)
  volumeEnvelope?: number;    // RMS mix rate (0.0-1.0, default: 0.0)
  protect?: number;           // Protect voiceless consonants (0.0-0.5, default: 0.15)
  f0Method?: string;          // Pitch detection method (default: "rmvpe")
  // GPU management
  pauseOllamaDuringInference?: boolean;  // Pause Ollama to free GPU VRAM (default: true)
  device?: 'cuda' | 'cpu';    // Device for inference (default: "cuda")
}

export interface KokoroConfig {
  langCode: string;           // Language code (e.g., 'a' for auto, 'en', 'ja', 'zh')
  voice: string;              // Built-in voice name (e.g., 'af_heart', 'af_bella')
  speed: number;              // Speaking speed multiplier (0.5-2.0, default: 1.0)
  splitPattern: string;       // Regex pattern for splitting long text (default: '\n+')
  useCustomVoicepack: boolean; // Use custom trained voicepack instead of built-in voice
  customVoicepackPath: string; // Path to custom .pt voicepack file
  autoFallbackToPiper: boolean; // Fallback to Piper if Kokoro fails
  outputFormat: 'wav';
  // Server configuration
  server: {
    useServer: boolean;       // Use FastAPI server instead of direct Python calls
    url: string;              // Server URL (default: http://127.0.0.1:9882)
    autoStart: boolean;       // Auto-start server when needed
    port: number;             // Server port (default: 9882)
  };
}

export interface TTSConfig {
  provider: 'piper' | 'gpt-sovits' | 'rvc' | 'kokoro';
  piper: PiperConfig;
  sovits: SoVITSConfig;
  rvc?: RVCConfig;
  kokoro?: KokoroConfig;
}

export interface CacheConfig {
  enabled: boolean;
  directory: string;
  maxSizeMB: number;
}

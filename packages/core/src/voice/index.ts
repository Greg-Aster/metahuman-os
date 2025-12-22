/**
 * Voice Module
 *
 * Live voice interaction system with ASR, TTS, and turn-taking.
 * Part of Phase 5: Voice Agent + System Operator
 */

// Types
export * from './types.js';

// Voice Loop Controller
export { VoiceLoopController, createVoiceLoop } from './voice-loop.js';

// ASR Integration
export {
  ASRIntegration,
  createASRIntegration,
  detectVoiceActivity,
  detectTrailingSilence,
  type ASRIntegrationConfig,
  type AudioChunk,
} from './asr-integration.js';

// TTS Integration
export {
  TTSIntegration,
  createTTSIntegration,
  calculateAudioDuration,
  adjustAudioSpeed,
  adjustAudioVolume,
  type TTSIntegrationConfig,
  type SynthesizeOptions,
} from './tts-integration.js';

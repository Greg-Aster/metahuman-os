/**
 * TTS Integration for Voice Loop
 *
 * Connects the voice loop controller to the existing TTS system.
 * Supports Piper, Kokoro, GPT-SoVITS, and RVC providers.
 *
 * Part of Phase 5: Voice Agent + System Operator
 */

import { createTTSService } from '../tts.js';
import type { ITextToSpeechService } from '../tts/interface.js';
import { audit } from '../audit.js';
import type { VoiceTTSConfig, TTSResult } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface TTSIntegrationConfig {
  username: string;
  config: VoiceTTSConfig;
  onAudioChunk?: (chunk: Buffer) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: (result: TTSResult) => void;
  onError?: (error: Error) => void;
}

export interface SynthesizeOptions {
  text: string;
  streaming?: boolean;
  abortSignal?: AbortSignal;
}

// ============================================================================
// TTS Integration Class
// ============================================================================

// Provider type for TTS
type TTSProvider = 'piper' | 'gpt-sovits' | 'rvc' | 'kokoro';

export class TTSIntegration {
  private config: TTSIntegrationConfig;
  private ttsService: ITextToSpeechService | null = null;
  private isSpeaking = false;
  private currentSynthesis: Promise<void> | null = null;

  constructor(config: TTSIntegrationConfig) {
    this.config = config;
  }

  /**
   * Initialize the TTS service.
   */
  async initialize(): Promise<void> {
    try {
      const provider = this.config.config.model as TTSProvider;
      this.ttsService = createTTSService(provider, this.config.username);

      audit({
        category: 'action',
        level: 'info',
        event: 'tts_initialized',
        actor: this.config.username,
        details: {
          provider: this.config.config.model,
          voice: this.config.config.voice,
        },
      });
    } catch (error) {
      this.config.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Synthesize speech from text.
   */
  async synthesize(options: SynthesizeOptions): Promise<TTSResult> {
    const { text, streaming = this.config.config.streaming, abortSignal } = options;
    const startTime = Date.now();

    if (!this.ttsService) {
      await this.initialize();
    }

    if (!this.ttsService) {
      throw new Error('TTS service not initialized');
    }

    try {
      this.isSpeaking = true;
      this.config.onSpeechStart?.();

      // Generate audio using the existing TTS service
      const audioBuffer = await this.ttsService.synthesize(text, {
        voice: this.config.config.voice,
        speakingRate: this.config.config.speed,
        signal: abortSignal,
      });

      const duration = Date.now() - startTime;

      // Create result
      const result: TTSResult = {
        audioData: audioBuffer,
        format: {
          sampleRate: 22050, // Typical for Piper/Kokoro
          channels: 1,
          bitDepth: 16,
          encoding: 'wav',
        },
        duration,
        text,
      };

      // If streaming, emit chunks
      if (streaming && this.config.onAudioChunk) {
        await this.streamAudio(audioBuffer);
      }

      this.config.onSpeechEnd?.(result);

      // Audit the synthesis
      audit({
        category: 'action',
        level: 'info',
        event: 'tts_synthesis',
        actor: this.config.username,
        details: {
          textLength: text.length,
          audioSize: audioBuffer.length,
          durationMs: duration,
          provider: this.config.config.model,
          voice: this.config.config.voice,
        },
      });

      return result;
    } catch (error) {
      const err = error as Error;
      this.config.onError?.(err);

      audit({
        category: 'system',
        level: 'error',
        event: 'tts_error',
        actor: this.config.username,
        details: { error: err.message },
      });

      throw error;
    } finally {
      this.isSpeaking = false;
    }
  }

  /**
   * Stream audio in chunks for progressive playback.
   */
  private async streamAudio(audioBuffer: Buffer): Promise<void> {
    const chunkSize = 4096; // 4KB chunks

    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const chunk = audioBuffer.subarray(i, Math.min(i + chunkSize, audioBuffer.length));
      this.config.onAudioChunk?.(chunk);

      // Small delay to simulate streaming
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Cancel ongoing speech synthesis.
   */
  cancel(): void {
    this.isSpeaking = false;
    // The TTS service handles abort signals internally
  }

  /**
   * Check if currently speaking.
   */
  isActive(): boolean {
    return this.isSpeaking;
  }

  /**
   * Update TTS configuration.
   */
  updateConfig(config: Partial<VoiceTTSConfig>): void {
    this.config.config = { ...this.config.config, ...config };

    // Reinitialize if provider changed
    if (config.model && config.model !== this.config.config.model) {
      this.ttsService = null;
    }
  }

  /**
   * Get available voices for the current provider.
   */
  async getAvailableVoices(): Promise<string[]> {
    // This would query the TTS service for available voices
    // For now, return common defaults
    const defaultVoices: Record<string, string[]> = {
      piper: ['en_US-lessac-medium', 'en_US-amy-medium', 'en_GB-alan-medium'],
      kokoro: ['af_bella', 'af_nicole', 'am_adam', 'bf_emma', 'bm_george'],
      'gpt-sovits': ['default'],
      rvc: ['default'],
    };

    return defaultVoices[this.config.config.model] || ['default'];
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a TTS integration instance.
 */
export function createTTSIntegration(config: TTSIntegrationConfig): TTSIntegration {
  return new TTSIntegration(config);
}

// ============================================================================
// Audio Utilities
// ============================================================================

/**
 * Calculate audio duration from buffer size.
 */
export function calculateAudioDuration(
  bufferSize: number,
  sampleRate: number = 22050,
  channels: number = 1,
  bytesPerSample: number = 2
): number {
  const totalSamples = bufferSize / (channels * bytesPerSample);
  return (totalSamples / sampleRate) * 1000; // Duration in ms
}

/**
 * Adjust audio speed (simple resampling).
 * Note: For production, use ffmpeg or a proper DSP library.
 */
export function adjustAudioSpeed(
  audioData: Buffer,
  speed: number
): Buffer {
  if (speed === 1.0) return audioData;

  // Simple linear interpolation resampling
  // For production, use ffmpeg with atempo filter
  const inputSamples = audioData.length / 2;
  const outputSamples = Math.floor(inputSamples / speed);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i * speed;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
    const fraction = srcIndex - srcIndexFloor;

    const sample1 = audioData.readInt16LE(srcIndexFloor * 2);
    const sample2 = audioData.readInt16LE(srcIndexCeil * 2);
    const interpolated = Math.round(sample1 * (1 - fraction) + sample2 * fraction);

    output.writeInt16LE(interpolated, i * 2);
  }

  return output;
}

/**
 * Adjust audio volume.
 */
export function adjustAudioVolume(
  audioData: Buffer,
  volume: number
): Buffer {
  if (volume === 1.0) return audioData;

  const output = Buffer.alloc(audioData.length);

  for (let i = 0; i < audioData.length; i += 2) {
    const sample = audioData.readInt16LE(i);
    const adjusted = Math.round(sample * volume);
    const clamped = Math.max(-32768, Math.min(32767, adjusted));
    output.writeInt16LE(clamped, i);
  }

  return output;
}

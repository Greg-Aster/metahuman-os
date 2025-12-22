/**
 * ASR Integration for Voice Loop
 *
 * Connects the voice loop controller to the existing Whisper-based STT system.
 * Provides streaming and non-streaming transcription capabilities.
 *
 * Part of Phase 5: Voice Agent + System Operator
 */

import { transcribeAudio } from '../stt.js';
import { audit } from '../audit.js';
import type { ASRResult, ASRConfig } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface ASRIntegrationConfig {
  username: string;
  config: ASRConfig;
  onPartialTranscript?: (text: string) => void;
  onFinalTranscript?: (result: ASRResult) => void;
  onError?: (error: Error) => void;
}

export interface AudioChunk {
  data: Buffer;
  timestamp: number;
  isFinal: boolean;
}

// ============================================================================
// ASR Integration Class
// ============================================================================

export class ASRIntegration {
  private config: ASRIntegrationConfig;
  private audioBuffer: Buffer[] = [];
  private isProcessing = false;
  private abortController: AbortController | null = null;

  constructor(config: ASRIntegrationConfig) {
    this.config = config;
  }

  /**
   * Process an audio chunk (for streaming mode).
   * Buffers audio until silence is detected or isFinal is true.
   */
  async processChunk(chunk: AudioChunk): Promise<void> {
    this.audioBuffer.push(chunk.data);

    if (chunk.isFinal) {
      await this.finalizeTranscription();
    }
  }

  /**
   * Process a complete audio buffer (non-streaming mode).
   */
  async processAudio(audioData: Buffer, format: 'wav' | 'webm' | 'mp3' = 'wav'): Promise<ASRResult> {
    const startTime = Date.now();

    try {
      this.isProcessing = true;
      this.abortController = new AbortController();

      // Use the existing transcription system
      // transcribeAudio returns just the transcript string
      const transcriptText = await transcribeAudio(audioData, format);

      const duration = Date.now() - startTime;

      const asrResult: ASRResult = {
        text: transcriptText || '',
        confidence: 0.9, // Whisper doesn't return confidence, use default
        language: this.config.config.language || 'en',
        duration,
        isFinal: true,
      };

      // Audit the transcription
      audit({
        category: 'action',
        level: 'info',
        event: 'asr_transcription',
        actor: this.config.username,
        details: {
          textLength: asrResult.text.length,
          confidence: asrResult.confidence,
          language: asrResult.language,
          durationMs: duration,
        },
      });

      this.config.onFinalTranscript?.(asrResult);
      return asrResult;
    } catch (error) {
      const err = error as Error;
      this.config.onError?.(err);

      audit({
        category: 'system',
        level: 'error',
        event: 'asr_error',
        actor: this.config.username,
        details: { error: err.message },
      });

      throw error;
    } finally {
      this.isProcessing = false;
      this.abortController = null;
    }
  }

  /**
   * Finalize buffered audio and get transcription.
   */
  private async finalizeTranscription(): Promise<void> {
    if (this.audioBuffer.length === 0) return;

    const fullAudio = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];

    await this.processAudio(fullAudio);
  }

  /**
   * Cancel ongoing transcription.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.audioBuffer = [];
    this.isProcessing = false;
  }

  /**
   * Check if currently processing.
   */
  isActive(): boolean {
    return this.isProcessing;
  }

  /**
   * Clear the audio buffer.
   */
  clearBuffer(): void {
    this.audioBuffer = [];
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an ASR integration instance.
 */
export function createASRIntegration(config: ASRIntegrationConfig): ASRIntegration {
  return new ASRIntegration(config);
}

// ============================================================================
// Voice Activity Detection (VAD)
// ============================================================================

/**
 * Simple energy-based VAD.
 * Returns true if the audio chunk contains speech.
 */
export function detectVoiceActivity(
  audioData: Buffer,
  threshold: number = 0.5
): boolean {
  // Calculate RMS (Root Mean Square) energy
  let sum = 0;
  const samples = audioData.length / 2; // Assuming 16-bit audio

  for (let i = 0; i < audioData.length; i += 2) {
    const sample = audioData.readInt16LE(i);
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / samples);
  const normalizedRms = rms / 32768; // Normalize to 0-1 range

  return normalizedRms > threshold * 0.1; // Scale threshold
}

/**
 * Detect silence at the end of audio buffer.
 * Returns the duration of trailing silence in milliseconds.
 */
export function detectTrailingSilence(
  audioData: Buffer,
  sampleRate: number = 16000,
  threshold: number = 0.02
): number {
  const bytesPerSample = 2; // 16-bit
  const samplesPerMs = sampleRate / 1000;
  const windowSize = Math.floor(samplesPerMs * 50); // 50ms window

  let silenceMs = 0;

  // Work backwards from the end
  for (let i = audioData.length - windowSize * bytesPerSample; i >= 0; i -= windowSize * bytesPerSample) {
    const window = audioData.subarray(i, i + windowSize * bytesPerSample);

    let sum = 0;
    for (let j = 0; j < window.length; j += 2) {
      const sample = window.readInt16LE(j);
      sum += sample * sample;
    }

    const rms = Math.sqrt(sum / windowSize);
    const normalizedRms = rms / 32768;

    if (normalizedRms < threshold) {
      silenceMs += 50;
    } else {
      break;
    }
  }

  return silenceMs;
}

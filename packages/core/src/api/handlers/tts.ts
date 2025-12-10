/**
 * TTS Handlers
 *
 * Text-to-speech generation and status endpoints.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import { generateSpeech, generateMultiVoiceSpeech, getTTSStatus } from '../../index.js';

type TTSProvider = 'piper' | 'gpt-sovits' | 'rvc' | 'kokoro';

/**
 * Normalize provider name (UI sends "sovits", backend uses "gpt-sovits")
 */
function normalizeProvider(provider?: string): TTSProvider | undefined {
  if (!provider) return undefined;
  if (provider === 'sovits') return 'gpt-sovits';
  return provider as TTSProvider;
}

/**
 * POST /api/tts - Generate speech from text
 */
export async function handleTtsGenerate(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { text, provider, model, voiceId, models, speakingRate, pitchShift, speed, langCode } = req.body || {};

  if (!text || typeof text !== 'string') {
    return badRequestResponse('Text is required');
  }

  try {
    const normalizedProvider = normalizeProvider(provider);
    let audioBuffer: Buffer;

    // Check if multi-voice mode is requested (for Mutant Super Intelligence)
    if (models && Array.isArray(models) && models.length > 0) {
      // generateMultiVoiceSpeech only supports piper, gpt-sovits, rvc (not kokoro)
      const multiProvider = normalizedProvider === 'kokoro' ? 'piper' : normalizedProvider;
      audioBuffer = await generateMultiVoiceSpeech(text, models, {
        speakingRate,
        provider: multiProvider as 'piper' | 'gpt-sovits' | 'rvc' | undefined,
      });
    } else {
      // Single voice generation
      audioBuffer = await generateSpeech(text, {
        voice: voiceId || model,
        speakingRate: speakingRate || speed,
        pitchShift,
        langCode,
        provider: normalizedProvider,
      });
    }

    // Return binary audio response
    return {
      status: 200,
      binary: audioBuffer,
      contentType: 'audio/wav',
      headers: {
        'Content-Length': String(audioBuffer.length),
        'Cache-Control': 'public, max-age=31536000',
      },
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return { status: 499, error: 'Client Closed Request' };
    }
    console.error('[TTS API] Error:', error);
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/tts - Get TTS status
 */
export async function handleTtsStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const status = await getTTSStatus();
    return successResponse(status);
  } catch (error) {
    console.error('[TTS API] Status error:', error);
    return errorResponse((error as Error).message, 500);
  }
}

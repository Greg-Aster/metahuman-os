import type { APIRoute } from 'astro';
import { generateSpeech, generateMultiVoiceSpeech } from '@metahuman/core';
import { withUserContext } from '../../middleware/userContext';

/**
 * POST /api/tts
 * Generate speech from text
 *
 * Body: {
 *   text: string,
 *   provider?: 'piper' | 'sovits' | 'gpt-sovits' | 'rvc' | 'kokoro',  // Optional: TTS provider to use (UI may send "sovits")
 *   voiceId?: string,         // Optional: voice ID (Piper/Kokoro) or speaker ID (SoVITS/RVC)
 *   model?: string,           // Optional: override voice model path (legacy)
 *   models?: string[],        // Optional: array of voice models for multi-voice (mutant mode)
 *   speakingRate?: number,    // Optional: override speaking rate (0.5 - 2.0)
 *   pitchShift?: number,      // Optional: RVC pitch shift (-12 to +12 semitones)
 *   speed?: number,           // Optional: SoVITS/RVC/Kokoro speed (0.5 - 2.0)
 *   langCode?: string         // Optional: Kokoro language code ('a' for auto, 'en', 'ja', etc.)
 * }
 * Returns: audio/wav stream
 */
const normalizeProvider = (provider?: string): 'piper' | 'gpt-sovits' | 'rvc' | 'kokoro' | undefined => {
  if (!provider) return undefined;
  if (provider === 'sovits') return 'gpt-sovits';
  return provider as 'piper' | 'gpt-sovits' | 'rvc' | 'kokoro';
};

const postHandler: APIRoute = async ({ request, cookies }) => {
  try {
    const { text, provider, model, voiceId, models, config, speakingRate, pitchShift, speed, langCode } = await request.json();

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // User context is automatically set by withUserContext middleware
    // For guest users viewing other profiles, context.profilePaths points to the viewed profile
    const normalizedProvider = normalizeProvider(provider);
    let audioBuffer: Buffer;

    // Check if multi-voice mode is requested (for Mutant Super Intelligence)
    if (models && Array.isArray(models) && models.length > 0) {
      // Generate speech with multiple voices mixed together
      audioBuffer = await generateMultiVoiceSpeech(text, models, {
        signal: request.signal,
        speakingRate,
        provider: normalizedProvider,
        // No username needed - context handles profile resolution
      });
    } else {
      // Generate speech audio with optional overrides (single voice)
      audioBuffer = await generateSpeech(text, {
        signal: request.signal,
        voice: voiceId || model, // Use voiceId (preferred) or model (legacy)
        speakingRate: speakingRate || speed, // speakingRate for Piper, speed for SoVITS/RVC/Kokoro
        pitchShift, // RVC-specific
        langCode, // Kokoro-specific language code
        provider: normalizedProvider,
        // No username needed - context handles profile resolution
      });
    }

    // Return audio as WAV stream
    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year (immutable content)
      },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return new Response(null, { status: 499, statusText: 'Client Closed Request' });
    }
    console.error('[TTS API] Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * GET /api/tts
 * Get TTS status
 */
const getHandler: APIRoute = async () => {
  try {
    const { getTTSStatus } = await import('@metahuman/core');
    const status = await getTTSStatus();

    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[TTS API] Status error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST = withUserContext(postHandler);
export const GET = withUserContext(getHandler);

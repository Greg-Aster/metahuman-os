import type { APIRoute } from 'astro';
import { generateSpeech, generateMultiVoiceSpeech } from '@metahuman/core';

/**
 * POST /api/tts
 * Generate speech from text
 *
 * Body: {
 *   text: string,
 *   model?: string,           // Optional: override voice model path
 *   models?: string[],        // Optional: array of voice models for multi-voice (mutant mode)
 *   config?: string,          // Optional: override voice config path
 *   speakingRate?: number     // Optional: override speaking rate (0.5 - 2.0)
 * }
 * Returns: audio/wav stream
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { text, model, models, config, speakingRate } = await request.json();

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let audioBuffer: Buffer;

    // Check if multi-voice mode is requested (for Mutant Super Intelligence)
    if (models && Array.isArray(models) && models.length > 0) {
      // Generate speech with multiple voices mixed together
      audioBuffer = await generateMultiVoiceSpeech(text, models, {
        signal: request.signal,
        speakingRate,
      });
    } else {
      // Generate speech audio with optional overrides (single voice)
      audioBuffer = await generateSpeech(text, {
        signal: request.signal,
        model,
        config,
        speakingRate,
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
export const GET: APIRoute = async () => {
  try {
    const { getTTSStatus } = await import('@metahuman/core');
    const status = getTTSStatus();

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

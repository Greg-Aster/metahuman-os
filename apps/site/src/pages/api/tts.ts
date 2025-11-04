import type { APIRoute } from 'astro';
import { generateSpeech } from '@metahuman/core';

/**
 * POST /api/tts
 * Generate speech from text
 *
 * Body: { text: string }
 * Returns: audio/wav stream
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Generate speech audio
    const audioBuffer = await generateSpeech(text, { signal: request.signal });

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

import type { APIRoute } from 'astro';
import { generateSpeech, generateMultiVoiceSpeech } from '@metahuman/core';
import { getSession } from '@metahuman/core/sessions';
import { getUser } from '@metahuman/core/users';
import { withUserContext } from '../../middleware/userContext';

/**
 * POST /api/tts
 * Generate speech from text
 *
 * Body: {
 *   text: string,
 *   provider?: 'piper' | 'sovits' | 'gpt-sovits' | 'rvc',  // Optional: TTS provider to use (UI may send "sovits")
 *   voiceId?: string,         // Optional: voice ID (Piper) or speaker ID (SoVITS/RVC)
 *   model?: string,           // Optional: override voice model path (legacy)
 *   models?: string[],        // Optional: array of voice models for multi-voice (mutant mode)
 *   speakingRate?: number,    // Optional: override speaking rate (0.5 - 2.0)
 *   pitchShift?: number,      // Optional: RVC pitch shift (-12 to +12 semitones)
 *   speed?: number            // Optional: SoVITS/RVC speed (0.5 - 2.0)
 * }
 * Returns: audio/wav stream
 */
const normalizeProvider = (provider?: string): 'piper' | 'gpt-sovits' | 'rvc' | undefined => {
  if (!provider) return undefined;
  if (provider === 'sovits') return 'gpt-sovits';
  return provider as 'piper' | 'gpt-sovits' | 'rvc';
};

const postHandler: APIRoute = async ({ request, cookies }) => {
  try {
    const { text, provider, model, voiceId, models, config, speakingRate, pitchShift, speed } = await request.json();

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get user session for profile-aware TTS
    const sessionCookie = cookies.get('mh_session');
    let username = 'anonymous';

    if (sessionCookie) {
      const session = getSession(sessionCookie.value);
      if (session) {
        const user = getUser(session.userId);
        if (user) {
          username = user.username;
        }
      }
    }

    const normalizedProvider = normalizeProvider(provider);
    let audioBuffer: Buffer;

    // Check if multi-voice mode is requested (for Mutant Super Intelligence)
    if (models && Array.isArray(models) && models.length > 0) {
      // Generate speech with multiple voices mixed together
      audioBuffer = await generateMultiVoiceSpeech(text, models, {
        signal: request.signal,
        speakingRate,
        provider: normalizedProvider,
        username,
      });
    } else {
      // Generate speech audio with optional overrides (single voice)
      audioBuffer = await generateSpeech(text, {
        signal: request.signal,
        voice: voiceId || model, // Use voiceId (preferred) or model (legacy)
        speakingRate: speakingRate || speed, // speakingRate for Piper, speed for SoVITS/RVC
        pitchShift, // RVC-specific
        provider: normalizedProvider,
        username,
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

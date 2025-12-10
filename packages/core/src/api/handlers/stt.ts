/**
 * Speech-to-Text (STT) API Handler
 *
 * POST /api/stt - Transcribe audio
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports
let transcribeAudio: ((buf: Buffer, format: string) => Promise<string>) | null = null;
let saveVoiceSample: ((buf: Buffer, transcript: string, duration: number, quality: number, format: string) => void) | null = null;

async function ensureImports(): Promise<boolean> {
  if (transcribeAudio !== null) return true;

  try {
    const sttModule = await import('../../stt.js');
    transcribeAudio = sttModule.transcribeAudio;
    saveVoiceSample = sttModule.saveVoiceSample;
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /api/stt
 * Body: raw binary audio (e.g., audio/webm or audio/wav)
 * Query: ?format=webm|wav|mp3 (default: webm)
 * Returns: { transcript }
 */
export async function handleStt(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!await ensureImports()) {
      return { status: 500, error: 'STT module not available' };
    }

    const format = (req.query?.format as 'webm' | 'wav' | 'mp3') || 'webm';
    const collect = req.query?.collect === '1';
    const durMsParam = req.query?.dur;

    // Body should be raw binary buffer
    const buf = req.rawBody;

    if (!buf || buf.length === 0) {
      return { status: 400, error: 'Empty audio body' };
    }

    const transcript = await transcribeAudio!(buf, format);

    if (collect && !transcript.startsWith('[Mock Transcription]')) {
      try {
        const durationSec = durMsParam
          ? Math.max(0.1, parseFloat(durMsParam) / 1000)
          : Math.max(0.1, (buf.length * 8) / (24 * 1024));
        const quality = Math.min(1.0, (buf.length / 50000) * 0.5 + 0.5);
        saveVoiceSample!(Buffer.from(buf), transcript, durationSec, quality, format);
      } catch {
        // Ignore sample collection errors
      }
    }

    return successResponse({ transcript });
  } catch (error) {
    console.error('[stt] Error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

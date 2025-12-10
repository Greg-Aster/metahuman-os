/**
 * Kokoro Voices API Handlers
 *
 * List available Kokoro TTS voices from VOICES.md catalog.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

const KOKORO_DIR = path.join(systemPaths.root, 'external', 'kokoro');
const VOICES_FILE = path.join(KOKORO_DIR, 'VOICES.md');

interface Voice {
  id: string;
  name: string;
  lang: string;
  gender: string;
  quality: string;
}

/**
 * Parse VOICES.md to extract voice list
 */
function listVoices(): Voice[] {
  if (!fs.existsSync(VOICES_FILE)) {
    return [];
  }

  const content = fs.readFileSync(VOICES_FILE, 'utf-8');
  const voices: Voice[] = [];

  // Parse VOICES.md
  // Format varies, but typically: `voice_id` - Language, Gender, Quality
  // Example: `af_heart` - English (US), Female, High Quality

  const lines = content.split('\n');

  for (const line of lines) {
    // Match voice entries with backticks
    const match = line.match(/`([a-z_]+)`\s*-?\s*([^,]+),?\s*(Male|Female|Neutral)?,?\s*(High|Medium|Low)?/i);

    if (match) {
      const [, id, langInfo, gender, quality] = match;

      voices.push({
        id: id.trim(),
        name: id.trim().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        lang: langInfo.trim(),
        gender: gender?.trim() || 'Neutral',
        quality: quality?.trim() || 'Medium',
      });
    }
  }

  return voices;
}

/**
 * Sync VOICES.md from GitHub
 */
async function syncVoicesCatalog(): Promise<void> {
  const url = 'https://raw.githubusercontent.com/hexgrad/kokoro/main/VOICES.md';

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch VOICES.md: ${response.statusText}`);
    }

    const content = await response.text();

    // Ensure directory exists
    const dir = path.dirname(VOICES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(VOICES_FILE, content, 'utf-8');
  } catch (error) {
    console.error('[syncVoicesCatalog] Error:', error);
    throw error;
  }
}

/**
 * GET /api/kokoro-voices - List available Kokoro voices
 */
export async function handleGetKokoroVoices(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const sync = req.query?.sync === 'true';

    if (sync) {
      // Re-download VOICES.md from GitHub
      await syncVoicesCatalog();
    }

    const voices = listVoices();

    return successResponse({ voices });
  } catch (error) {
    console.error('[kokoro-voices] GET error:', error);
    return {
      status: 500,
      error: String(error),
      data: { voices: [] },
    };
  }
}

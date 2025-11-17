import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

const rootPath = path.resolve(process.cwd(), '../..');
const KOKORO_DIR = path.join(rootPath, 'external', 'kokoro');
const VOICES_FILE = path.join(KOKORO_DIR, 'VOICES.md');

interface Voice {
  id: string;
  name: string;
  lang: string;
  gender: string;
  quality: string;
}

/**
 * GET /api/kokoro-voices
 * List available Kokoro voices
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const sync = url.searchParams.get('sync') === 'true';

    if (sync) {
      // Re-download VOICES.md from GitHub
      await syncVoicesCatalog();
    }

    const voices = await listVoices();

    return new Response(JSON.stringify({ voices }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[API /kokoro-voices GET] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), voices: [] }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function listVoices(): Promise<Voice[]> {
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

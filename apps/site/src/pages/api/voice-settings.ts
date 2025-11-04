import type { APIRoute } from 'astro';
import { paths } from '@metahuman/core';
import fs from 'node:fs';
import path from 'node:path';

const VOICE_CONFIG_PATH = path.join(paths.root, 'etc', 'voice.json');
const VOICES_DIR = path.join(paths.root, 'out', 'voices');

interface VoiceConfig {
  tts: {
    provider: string;
    piper: {
      binary: string;
      model: string;
      config: string;
      speakingRate: number;
      outputFormat: string;
    };
  };
  [key: string]: any;
}

interface VoiceModel {
  id: string;
  name: string;
  language: string;
  quality: string;
  modelPath: string;
  configPath: string;
}

/**
 * Scan voices directory for available Piper voice models
 */
function getAvailableVoices(): VoiceModel[] {
  const voices: VoiceModel[] = [];

  if (!fs.existsSync(VOICES_DIR)) {
    return voices;
  }

  const files = fs.readdirSync(VOICES_DIR);
  const onnxFiles = files.filter(f => f.endsWith('.onnx'));

  for (const file of onnxFiles) {
    const modelPath = path.join(VOICES_DIR, file);
    const configPath = `${modelPath}.json`;

    // Parse voice name: en_US-ryan-high.onnx -> { lang: en_US, name: ryan, quality: high }
    const match = file.match(/^([^-]+)-([^-]+)-([^.]+)\.onnx$/);
    if (!match) continue;

    const [, language, name, quality] = match;

    voices.push({
      id: file.replace('.onnx', ''),
      name: name.charAt(0).toUpperCase() + name.slice(1),
      language: language.replace('_', '-'),
      quality: quality,
      modelPath,
      configPath: fs.existsSync(configPath) ? configPath : '',
    });
  }

  return voices;
}

/**
 * Load current voice configuration
 */
function loadVoiceConfig(): VoiceConfig {
  const content = fs.readFileSync(VOICE_CONFIG_PATH, 'utf8');
  return JSON.parse(content);
}

/**
 * Save voice configuration
 */
function saveVoiceConfig(config: VoiceConfig): void {
  fs.writeFileSync(VOICE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * GET: Return available voices and current settings
 * POST: Update voice settings
 */
export const GET: APIRoute = async () => {
  try {
    const config = loadVoiceConfig();
    const voices = getAvailableVoices();

    // Extract current voice from model path
    const currentModelPath = config.tts.piper.model;
    const currentVoiceFile = path.basename(currentModelPath, '.onnx');

    return new Response(
      JSON.stringify({
        voices,
        currentVoice: currentVoiceFile,
        speakingRate: config.tts.piper.speakingRate || 1.0,
        provider: config.tts.provider,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[voice-settings] Error loading settings:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load voice settings' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { voiceId, speakingRate } = await request.json();

    const config = loadVoiceConfig();
    const voices = getAvailableVoices();

    // Find selected voice
    const selectedVoice = voices.find(v => v.id === voiceId);
    if (!selectedVoice) {
      return new Response(
        JSON.stringify({ error: 'Voice not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Update configuration
    if (voiceId) {
      config.tts.piper.model = selectedVoice.modelPath;
      config.tts.piper.config = selectedVoice.configPath;
    }

    if (typeof speakingRate === 'number') {
      config.tts.piper.speakingRate = Math.max(0.5, Math.min(2.0, speakingRate));
    }

    // Save configuration
    saveVoiceConfig(config);

    return new Response(
      JSON.stringify({
        success: true,
        currentVoice: voiceId,
        speakingRate: config.tts.piper.speakingRate,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[voice-settings] Error saving settings:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to save voice settings' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

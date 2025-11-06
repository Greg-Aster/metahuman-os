import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../middleware/userContext';
import fs from 'node:fs';
import path from 'node:path';

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
function getAvailableVoices(voicesDir: string): VoiceModel[] {
  const voices: VoiceModel[] = [];

  if (!fs.existsSync(voicesDir)) {
    return voices;
  }

  const files = fs.readdirSync(voicesDir);
  const onnxFiles = files.filter(f => f.endsWith('.onnx'));

  for (const file of onnxFiles) {
    const modelPath = path.join(voicesDir, file);
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

type VoiceConfig = {
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
  stt: Record<string, any>;
  cache: Record<string, any>;
  webSocket: Record<string, any>;
  training: Record<string, any>;
  [key: string]: any;
};

function buildDefaultVoiceConfig(
  profileRoot: string,
  rootDir: string,
  voicesDir: string,
  defaultVoice?: VoiceModel
): VoiceConfig {
  const defaultBinary = path.join(rootDir, 'bin', 'piper', 'piper');
  const defaultModel = defaultVoice?.modelPath ?? path.join(voicesDir, 'en_US-lessac-medium.onnx');
  const defaultConfig = defaultVoice?.configPath ?? `${defaultModel}.json`;

  return {
    tts: {
      provider: 'piper',
      piper: {
        binary: defaultBinary,
        model: defaultModel,
        config: defaultConfig,
        speakingRate: 1.0,
        outputFormat: 'wav',
      },
    },
    stt: {
      provider: 'whisper',
      whisper: {
        model: 'base.en',
        device: 'cpu',
        computeType: 'int8',
        language: 'en',
      },
    },
    cache: {
      enabled: true,
      directory: path.join(profileRoot, 'out', 'voice-cache'),
      maxSizeMB: 500,
    },
    webSocket: {
      path: '/voice-stream',
      maxPayloadMB: 10,
      audioChunkMs: 100,
    },
    training: {
      enabled: true,
      minDuration: 2,
      maxDuration: 120,
      minQuality: 0.6,
      targetHours: 3,
    },
  };
}

function ensureVoiceConfig(
  voiceConfigPath: string,
  voicesDir: string,
  rootDir: string,
  voices: VoiceModel[]
): VoiceConfig {
  const profileRoot = path.resolve(path.dirname(voiceConfigPath), '..');
  const defaultVoice = voices.find(v => v.id === 'en_US-lessac-medium') ?? voices[0];

  let config: VoiceConfig | null = null;

  if (fs.existsSync(voiceConfigPath)) {
    try {
      const raw = fs.readFileSync(voiceConfigPath, 'utf8');
      config = JSON.parse(raw) as VoiceConfig;
    } catch (error) {
      console.warn('[voice-settings] Invalid voice config JSON, regenerating:', error);
    }
  }

  if (!config) {
    config = buildDefaultVoiceConfig(profileRoot, rootDir, voicesDir, defaultVoice);
  }

  // Ensure structure exists
  config.tts = config.tts ?? { provider: 'piper', piper: {} as any };
  config.tts.provider = config.tts.provider || 'piper';
  config.tts.piper = config.tts.piper ?? {} as any;

  const defaultBinary = path.join(rootDir, 'bin', 'piper', 'piper');
  const defaultModel = (defaultVoice?.modelPath && fs.existsSync(defaultVoice.modelPath))
    ? defaultVoice.modelPath
    : path.join(voicesDir, 'en_US-lessac-medium.onnx');
  const defaultConfig = (defaultVoice?.configPath && fs.existsSync(defaultVoice.configPath))
    ? defaultVoice.configPath
    : `${defaultModel}.json`;

  if (!config.tts.piper.binary || !fs.existsSync(config.tts.piper.binary)) {
    config.tts.piper.binary = defaultBinary;
  }

  if (
    !config.tts.piper.model ||
    !fs.existsSync(config.tts.piper.model) ||
    config.tts.piper.model.includes(`${path.sep}profiles${path.sep}`)
  ) {
    config.tts.piper.model = defaultModel;
  }

  if (
    !config.tts.piper.config ||
    !fs.existsSync(config.tts.piper.config) ||
    config.tts.piper.config.includes(`${path.sep}profiles${path.sep}`)
  ) {
    config.tts.piper.config = defaultConfig;
  }

  if (typeof config.tts.piper.speakingRate !== 'number') {
    config.tts.piper.speakingRate = 1.0;
  }

  config.tts.piper.outputFormat = config.tts.piper.outputFormat || 'wav';

  // Ensure cache directory exists
  config.cache = config.cache ?? {
    enabled: true,
    directory: path.join(profileRoot, 'out', 'voice-cache'),
    maxSizeMB: 500,
  };

  if (!config.cache.directory) {
    config.cache.directory = path.join(profileRoot, 'out', 'voice-cache');
  }

  try {
    fs.mkdirSync(config.cache.directory, { recursive: true });
  } catch (error) {
    console.warn('[voice-settings] Unable to ensure voice cache directory:', error);
  }

  config.stt = config.stt ?? {
    provider: 'whisper',
    whisper: {
      model: 'base.en',
      device: 'cpu',
      computeType: 'int8',
      language: 'en',
    },
  };

  config.webSocket = config.webSocket ?? {
    path: '/voice-stream',
    maxPayloadMB: 10,
    audioChunkMs: 100,
  };

  config.training = config.training ?? {
    enabled: true,
    minDuration: 2,
    maxDuration: 120,
    minQuality: 0.6,
    targetHours: 3,
  };

  fs.mkdirSync(path.dirname(voiceConfigPath), { recursive: true });
  fs.writeFileSync(voiceConfigPath, JSON.stringify(config, null, 2), 'utf8');

  return config;
}

/**
 * GET: Return available voices and current settings
 * POST: Update voice settings
 */
const getHandler: APIRoute = async () => {
  try {
    const context = getUserContext();
    if (!context || context.username === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const voiceConfigPath = context.profilePaths.voiceConfig;
    const voicesDir = context.systemPaths.voiceModels;
    const rootDir = context.systemPaths.root;
    const voices = getAvailableVoices(voicesDir);

    const config = ensureVoiceConfig(voiceConfigPath, voicesDir, rootDir, voices);

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

const postHandler: APIRoute = async ({ request }) => {
  try {
    const context = getUserContext();
    if (!context || context.username === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { voiceId, speakingRate } = await request.json();

    const voiceConfigPath = context.profilePaths.voiceConfig;
    const voicesDir = context.systemPaths.voiceModels;
    const rootDir = context.systemPaths.root;
    const voices = getAvailableVoices(voicesDir);
    const config = ensureVoiceConfig(voiceConfigPath, voicesDir, rootDir, voices);

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
    fs.writeFileSync(voiceConfigPath, JSON.stringify(config, null, 2), 'utf8');

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

export const GET = withUserContext(getHandler);
export const POST = withUserContext(postHandler);

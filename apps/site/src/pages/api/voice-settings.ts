import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../middleware/userContext';
import { startSovitsServer, stopSovitsServer } from '../../lib/sovits-server';
import { stopServer } from '@metahuman/core/tts/server-manager';
import fs from 'node:fs';
import path from 'node:path';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

function loadKokoroVoices(rootDir: string, profileRoot: string): Array<{id: string; name: string; lang: string; gender: string; quality: string; isCustom?: boolean; voicepackPath?: string}> {
  const kokoroDir = path.join(rootDir, 'external', 'kokoro');
  const voicesFile = path.join(kokoroDir, 'VOICES.md');
  const voices: Array<{id: string; name: string; lang: string; gender: string; quality: string; isCustom?: boolean; voicepackPath?: string}> = [];

  // Load built-in voices from VOICES.md
  if (fs.existsSync(voicesFile)) {
    const content = fs.readFileSync(voicesFile, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/`([a-z_]+)`\s*-?\s*([^,]+),?\s*(Male|Female|Neutral)?,?\s*(High|Medium|Low)?/i);
      if (match) {
        const [, id, langInfo, gender, quality] = match;
        const displayName = id.trim().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        voices.push({
          id: id.trim(),
          name: displayName,
          lang: langInfo.trim(),
          gender: gender?.trim() || 'Neutral',
          quality: quality?.trim() || 'Medium',
          isCustom: false,
        });
      }
    }
  }

  // Load custom voicepacks from profile
  const voicepacksDir = path.join(profileRoot, 'out', 'voices', 'kokoro-voicepacks');
  if (fs.existsSync(voicepacksDir)) {
    try {
      const files = fs.readdirSync(voicepacksDir);
      const voicepackFiles = files.filter(f => f.endsWith('.pt'));

      for (const file of voicepackFiles) {
        const voicepackName = file.replace('.pt', '');
        const voicepackPath = path.join(voicepacksDir, file);
        voices.push({
          id: `custom_${voicepackName}`,
          name: `Custom: ${voicepackName.charAt(0).toUpperCase() + voicepackName.slice(1)}`,
          lang: 'Custom Trained',
          gender: 'Custom',
          quality: 'User Trained',
          isCustom: true,
          voicepackPath,
        });
      }
    } catch (error) {
      console.warn('[voice-settings] Failed to scan custom voicepacks:', error);
    }
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
    sovits?: {
      serverUrl: string;
      speakerId: string;
      temperature: number;
      speed: number;
      autoFallbackToPiper: boolean;
    };
    rvc?: {
      referenceAudioDir?: string;
      modelsDir?: string;
      speakerId: string;
      pitchShift: number;
      speed: number;
      autoFallbackToPiper: boolean;
      indexRate?: number;
      volumeEnvelope?: number;
      protect?: number;
      f0Method?: string;
      device?: 'cuda' | 'cpu';
      outputFormat?: string;
      pauseOllamaDuringInference?: boolean;
    };
    kokoro?: {
      langCode: string;
      voice: string;
      speed: number;
      autoFallbackToPiper: boolean;
      useCustomVoicepack: boolean;
      customVoicepackPath?: string;
      device?: 'cuda' | 'cpu';
      voices?: Array<{id: string; name: string; lang: string; gender: string; quality: string}>;
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
  const defaultRvcSamplesDir = path.join(profileRoot, 'out', 'voices', 'rvc-samples');
  const defaultRvcModelsDir = path.join(profileRoot, 'out', 'voices', 'rvc-models');

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
      sovits: {
        serverUrl: 'http://127.0.0.1:9880',
        speakerId: 'default',
        temperature: 0.6,
        speed: 1.0,
        autoFallbackToPiper: true,
      },
      rvc: {
        referenceAudioDir: defaultRvcSamplesDir,
        modelsDir: defaultRvcModelsDir,
        speakerId: 'default',
        pitchShift: 0,
        speed: 1.0,
        outputFormat: 'wav',
        autoFallbackToPiper: true,
        indexRate: 1.0,
        volumeEnvelope: 0.0,
        protect: 0.15,
        f0Method: 'rmvpe',
        device: 'cuda',
        pauseOllamaDuringInference: true,
      },
      kokoro: {
        langCode: 'a',
        voice: 'af_heart',
        speed: 1.0,
        autoFallbackToPiper: true,
        useCustomVoicepack: false,
        customVoicepackPath: path.join(profileRoot, 'out', 'voices', 'kokoro-voicepacks', 'default.pt'),
        device: 'cpu',
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

  if (!config.tts.sovits) {
    config.tts.sovits = {
      serverUrl: 'http://127.0.0.1:9880',
      speakerId: 'default',
      temperature: 0.6,
      speed: 1.0,
      autoFallbackToPiper: true,
    };
  }

  if (!config.tts.rvc) {
    config.tts.rvc = {
      referenceAudioDir: path.join(profileRoot, 'out', 'voices', 'rvc-samples'),
      modelsDir: path.join(profileRoot, 'out', 'voices', 'rvc-models'),
      speakerId: 'default',
      pitchShift: 0,
      speed: 1.0,
      outputFormat: 'wav',
      autoFallbackToPiper: true,
      indexRate: 1.0,
      volumeEnvelope: 0.0,
      protect: 0.15,
      f0Method: 'rmvpe',
      device: 'cuda',
      pauseOllamaDuringInference: true,
    };
  }

  const rvcSamplesDir = path.join(profileRoot, 'out', 'voices', 'rvc-samples');
  const rvcModelsDir = path.join(profileRoot, 'out', 'voices', 'rvc-models');

  config.tts.rvc.referenceAudioDir = config.tts.rvc.referenceAudioDir || rvcSamplesDir;
  config.tts.rvc.modelsDir = config.tts.rvc.modelsDir || rvcModelsDir;
  config.tts.rvc.outputFormat = config.tts.rvc.outputFormat || 'wav';
  config.tts.rvc.pauseOllamaDuringInference = config.tts.rvc.pauseOllamaDuringInference ?? true;
  config.tts.rvc.speakerId = config.tts.rvc.speakerId || 'default';
  config.tts.rvc.pitchShift = typeof config.tts.rvc.pitchShift === 'number'
    ? clamp(config.tts.rvc.pitchShift, -12, 12)
    : 0;
  config.tts.rvc.speed = typeof config.tts.rvc.speed === 'number'
    ? clamp(config.tts.rvc.speed, 0.5, 2.0)
    : 1.0;
  config.tts.rvc.indexRate = typeof config.tts.rvc.indexRate === 'number'
    ? clamp(config.tts.rvc.indexRate, 0, 1)
    : 1.0;
  config.tts.rvc.volumeEnvelope = typeof config.tts.rvc.volumeEnvelope === 'number'
    ? clamp(config.tts.rvc.volumeEnvelope, 0, 1)
    : 0.0;
  config.tts.rvc.protect = typeof config.tts.rvc.protect === 'number'
    ? clamp(config.tts.rvc.protect, 0, 0.5)
    : 0.15;
  config.tts.rvc.f0Method = config.tts.rvc.f0Method || 'rmvpe';
  config.tts.rvc.device = config.tts.rvc.device === 'cpu' ? 'cpu' : 'cuda';

  try {
    fs.mkdirSync(config.tts.rvc.referenceAudioDir, { recursive: true });
    fs.mkdirSync(config.tts.rvc.modelsDir, { recursive: true });
  } catch (error) {
    console.warn('[voice-settings] Unable to ensure RVC directories:', error);
  }

  // Ensure Kokoro config exists
  if (!config.tts.kokoro) {
    config.tts.kokoro = {
      langCode: 'a',
      voice: 'af_heart',
      speed: 1.0,
      autoFallbackToPiper: true,
      useCustomVoicepack: false,
      customVoicepackPath: path.join(profileRoot, 'out', 'voices', 'kokoro-voicepacks', 'default.pt'),
      device: 'cpu',
    };
  }

  config.tts.kokoro.langCode = config.tts.kokoro.langCode || 'a';
  config.tts.kokoro.voice = config.tts.kokoro.voice || 'af_heart';
  config.tts.kokoro.speed = typeof config.tts.kokoro.speed === 'number'
    ? clamp(config.tts.kokoro.speed, 0.5, 2.0)
    : 1.0;
  config.tts.kokoro.autoFallbackToPiper = config.tts.kokoro.autoFallbackToPiper ?? true;
  config.tts.kokoro.useCustomVoicepack = config.tts.kokoro.useCustomVoicepack ?? false;
  config.tts.kokoro.device = config.tts.kokoro.device === 'cuda' ? 'cuda' : 'cpu';

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
      vad: {
        voiceThreshold: 12,
        silenceDelay: 5000,
        minDuration: 500,
      },
    },
  };

  // Ensure VAD defaults if not present
  if (!config.stt.whisper) {
    config.stt.whisper = {} as any;
  }
  if (!config.stt.whisper.vad) {
    config.stt.whisper.vad = {
      voiceThreshold: 12,
      silenceDelay: 5000,
      minDuration: 500,
    };
  }

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
    if (!context) {
      return new Response(
        JSON.stringify({ error: 'Context not available' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Allow anonymous/guest users to view voice settings (read-only)
    // They just can't change them via POST

    const voiceConfigPath = context.profilePaths.voiceConfig;
    const voicesDir = context.systemPaths.voiceModels;
    const rootDir = context.systemPaths.root;
    const voices = getAvailableVoices(voicesDir);

    const config = ensureVoiceConfig(voiceConfigPath, voicesDir, rootDir, voices);

    // Extract current voice from model path
    const currentModelPath = config.tts.piper.model;
    const currentVoiceFile = path.basename(currentModelPath, '.onnx');

    const providerForUI = config.tts.provider === 'gpt-sovits' ? 'sovits' : config.tts.provider;
    const profileRoot = path.resolve(path.dirname(voiceConfigPath), '..');
    const kokoroVoices = loadKokoroVoices(rootDir, profileRoot);

    // Check Whisper server status
    let whisperServerStatus = 'unknown';
    if (config.stt?.whisper?.server?.useServer) {
      try {
        const whisperUrl = config.stt.whisper.server.url || 'http://127.0.0.1:9883';
        const response = await fetch(`${whisperUrl}/health`, { signal: AbortSignal.timeout(1000) });
        whisperServerStatus = response.ok ? 'running' : 'stopped';
      } catch {
        whisperServerStatus = 'stopped';
      }
    } else {
      whisperServerStatus = 'disabled';
    }

    return new Response(
      JSON.stringify({
        provider: providerForUI,
        piper: {
          voices,
          currentVoice: currentVoiceFile,
          speakingRate: config.tts.piper.speakingRate || 1.0,
        },
        sovits: {
          serverUrl: config.tts.sovits?.serverUrl || 'http://127.0.0.1:9880',
          speakerId: config.tts.sovits?.speakerId || 'default',
          temperature: config.tts.sovits?.temperature || 0.6,
          speed: config.tts.sovits?.speed || 1.0,
          autoFallbackToPiper: config.tts.sovits?.autoFallbackToPiper ?? true,
        },
        rvc: {
          speakerId: config.tts.rvc?.speakerId || 'default',
          pitchShift: config.tts.rvc?.pitchShift || 0,
          speed: config.tts.rvc?.speed || 1.0,
          autoFallbackToPiper: config.tts.rvc?.autoFallbackToPiper ?? true,
          indexRate: config.tts.rvc?.indexRate ?? 1.0,
          volumeEnvelope: config.tts.rvc?.volumeEnvelope ?? 0.0,
          protect: config.tts.rvc?.protect ?? 0.15,
          f0Method: config.tts.rvc?.f0Method || 'rmvpe',
          device: config.tts.rvc?.device || 'cuda',
        },
        kokoro: {
          langCode: config.tts.kokoro?.langCode || 'a',
          // If using custom voicepack, prepend 'custom_' to the voice ID for the dropdown
          voice: config.tts.kokoro?.useCustomVoicepack
            ? `custom_${config.tts.kokoro.voice || 'default'}`
            : (config.tts.kokoro?.voice || 'af_heart'),
          speed: config.tts.kokoro?.speed || 1.0,
          autoFallbackToPiper: config.tts.kokoro?.autoFallbackToPiper ?? true,
          useCustomVoicepack: config.tts.kokoro?.useCustomVoicepack ?? false,
          device: config.tts.kokoro?.device || 'cpu',
          voices: kokoroVoices,
        },
        stt: {
          model: config.stt?.whisper?.model || 'base.en',
          device: config.stt?.whisper?.device || 'cpu',
          computeType: config.stt?.whisper?.computeType || 'int8',
          language: config.stt?.whisper?.language || 'en',
          useServer: config.stt?.whisper?.server?.useServer ?? true,
          autoStart: config.stt?.whisper?.server?.autoStart ?? true,
          serverStatus: whisperServerStatus,
          vad: {
            voiceThreshold: config.stt?.whisper?.vad?.voiceThreshold ?? 12,
            silenceDelay: config.stt?.whisper?.vad?.silenceDelay ?? 5000,
            minDuration: config.stt?.whisper?.vad?.minDuration ?? 500,
          },
        },
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

    const body = await request.json();
    const { provider, piper, sovits, rvc, kokoro, stt } = body;

    console.log('[voice-settings POST] Received body:', { provider, hasPiper: !!piper, hasSovits: !!sovits, hasRvc: !!rvc, hasKokoro: !!kokoro, hasStt: !!stt });

    const voiceConfigPath = context.profilePaths.voiceConfig;
    const voicesDir = context.systemPaths.voiceModels;
    const rootDir = context.systemPaths.root;
    const voices = getAvailableVoices(voicesDir);
    const config = ensureVoiceConfig(voiceConfigPath, voicesDir, rootDir, voices);
    const previousProvider = config.tts.provider;
    const previousRvcDevice = config.tts.rvc?.device;
    const previousKokoroDevice = config.tts.kokoro?.device;

    console.log('[voice-settings POST] Previous provider:', previousProvider, '→ New provider:', provider);

    // Update provider (normalize sovits → sovits for internal storage)
    if (provider) {
      config.tts.provider = provider === 'sovits' ? 'gpt-sovits' : provider;
    }

    // Update Piper settings
    if (piper) {
      config.tts.piper = config.tts.piper || {} as any;

      if (piper.currentVoice) {
        const selectedVoice = voices.find(v => v.id === piper.currentVoice);
        if (selectedVoice) {
          config.tts.piper.model = selectedVoice.modelPath;
          config.tts.piper.config = selectedVoice.configPath;
        }
      }

      if (typeof piper.speakingRate === 'number') {
        config.tts.piper.speakingRate = Math.max(0.5, Math.min(2.0, piper.speakingRate));
      }
    }

    // Update GPT-SoVITS settings
    if (sovits) {
      config.tts.sovits = config.tts.sovits || {} as any;
      if (sovits.serverUrl) config.tts.sovits.serverUrl = sovits.serverUrl;
      if (sovits.speakerId) config.tts.sovits.speakerId = sovits.speakerId;
      if (typeof sovits.temperature === 'number') config.tts.sovits.temperature = sovits.temperature;
      if (typeof sovits.speed === 'number') config.tts.sovits.speed = sovits.speed;
      if (typeof sovits.autoFallbackToPiper === 'boolean') {
        config.tts.sovits.autoFallbackToPiper = sovits.autoFallbackToPiper;
      }
    }

    // Update RVC settings
    if (rvc) {
      config.tts.rvc = config.tts.rvc || {} as any;
      if (rvc.speakerId) config.tts.rvc.speakerId = rvc.speakerId;
      const parsedPitch = Number(rvc.pitchShift);
      if (Number.isFinite(parsedPitch)) {
        config.tts.rvc.pitchShift = clamp(parsedPitch, -12, 12);
      }
      const parsedSpeed = Number(rvc.speed);
      if (Number.isFinite(parsedSpeed)) {
        config.tts.rvc.speed = clamp(parsedSpeed, 0.5, 2.0);
      }
      if (typeof rvc.autoFallbackToPiper === 'boolean') {
        config.tts.rvc.autoFallbackToPiper = rvc.autoFallbackToPiper;
      }
      const parsedIndexRate = Number(rvc.indexRate);
      if (Number.isFinite(parsedIndexRate)) {
        config.tts.rvc.indexRate = clamp(parsedIndexRate, 0, 1);
      }
      const parsedVolumeEnvelope = Number(rvc.volumeEnvelope);
      if (Number.isFinite(parsedVolumeEnvelope)) {
        config.tts.rvc.volumeEnvelope = clamp(parsedVolumeEnvelope, 0, 1);
      }
      const parsedProtect = Number(rvc.protect);
      if (Number.isFinite(parsedProtect)) {
        config.tts.rvc.protect = clamp(parsedProtect, 0, 0.5);
      }
      if (typeof rvc.f0Method === 'string' && rvc.f0Method.trim()) {
        config.tts.rvc.f0Method = rvc.f0Method.trim();
      }
      if (rvc.device === 'cuda' || rvc.device === 'cpu') {
        config.tts.rvc.device = rvc.device;
      }
    }

    // Update Kokoro settings
    if (kokoro) {
      config.tts.kokoro = config.tts.kokoro || {} as any;
      if (kokoro.langCode) config.tts.kokoro.langCode = kokoro.langCode;

      // Handle voice selection (detect custom voicepacks)
      if (kokoro.voice) {
        if (kokoro.voice.startsWith('custom_')) {
          // Custom voicepack selected
          const voicepackName = kokoro.voice.replace('custom_', '');
          const profileRoot = path.resolve(path.dirname(voiceConfigPath), '..');
          const voicepackPath = path.join(profileRoot, 'out', 'voices', 'kokoro-voicepacks', `${voicepackName}.pt`);

          config.tts.kokoro.useCustomVoicepack = true;
          config.tts.kokoro.customVoicepackPath = voicepackPath;
          // Keep the voice ID without the custom_ prefix for display
          config.tts.kokoro.voice = voicepackName;
        } else {
          // Built-in voice selected
          config.tts.kokoro.voice = kokoro.voice;
          config.tts.kokoro.useCustomVoicepack = false;
        }
      }

      const parsedSpeed = Number(kokoro.speed);
      if (Number.isFinite(parsedSpeed)) {
        config.tts.kokoro.speed = clamp(parsedSpeed, 0.5, 2.0);
      }
      if (typeof kokoro.autoFallbackToPiper === 'boolean') {
        config.tts.kokoro.autoFallbackToPiper = kokoro.autoFallbackToPiper;
      }
      if (typeof kokoro.useCustomVoicepack === 'boolean' && !kokoro.voice?.startsWith('custom_')) {
        // Only allow manual override if not using custom voice from dropdown
        config.tts.kokoro.useCustomVoicepack = kokoro.useCustomVoicepack;
      }
      if (kokoro.customVoicepackPath && !kokoro.voice?.startsWith('custom_')) {
        config.tts.kokoro.customVoicepackPath = kokoro.customVoicepackPath;
      }
      if (kokoro.device === 'cuda' || kokoro.device === 'cpu') {
        config.tts.kokoro.device = kokoro.device;
      }
    }

    // Update STT (Whisper) settings
    if (stt) {
      // Ensure stt.whisper structure exists
      config.stt = config.stt || { provider: 'whisper', whisper: {} };
      config.stt.whisper = config.stt.whisper || {};
      config.stt.whisper.server = config.stt.whisper.server || { useServer: true, url: 'http://127.0.0.1:9883', autoStart: true, port: 9883 };
      config.stt.whisper.vad = config.stt.whisper.vad || { voiceThreshold: 12, silenceDelay: 5000, minDuration: 500 };

      // Update model
      if (stt.model && ['tiny.en', 'base.en', 'small.en', 'medium.en'].includes(stt.model)) {
        config.stt.whisper.model = stt.model;
      }

      // Update device
      if (stt.device === 'cpu' || stt.device === 'cuda') {
        config.stt.whisper.device = stt.device;

        // Auto-adjust compute type based on device
        if (stt.device === 'cuda' && config.stt.whisper.computeType === 'int8') {
          config.stt.whisper.computeType = 'float16';
        }
      }

      // Update compute type
      if (stt.computeType && ['int8', 'float16', 'float32'].includes(stt.computeType)) {
        config.stt.whisper.computeType = stt.computeType;
      }

      // Update language
      if (stt.language && typeof stt.language === 'string') {
        config.stt.whisper.language = stt.language;
      }

      // Update server settings
      if (typeof stt.useServer === 'boolean') {
        config.stt.whisper.server.useServer = stt.useServer;
      }

      if (typeof stt.autoStart === 'boolean') {
        config.stt.whisper.server.autoStart = stt.autoStart;
      }

      // Update VAD settings
      if (stt.vad) {
        if (typeof stt.vad.voiceThreshold === 'number') {
          config.stt.whisper.vad.voiceThreshold = clamp(stt.vad.voiceThreshold, 0, 100);
        }
        if (typeof stt.vad.silenceDelay === 'number') {
          config.stt.whisper.vad.silenceDelay = clamp(stt.vad.silenceDelay, 1000, 30000);
        }
        if (typeof stt.vad.minDuration === 'number') {
          config.stt.whisper.vad.minDuration = clamp(stt.vad.minDuration, 100, 5000);
        }
      }
    }

    // Save configuration
    fs.writeFileSync(voiceConfigPath, JSON.stringify(config, null, 2), 'utf8');

    // Handle provider switching and service orchestration
    try {
      await syncTTSBackends(previousProvider, config.tts.provider, config, {
        previousRvcDevice,
        previousKokoroDevice,
      });

      const responseProvider = config.tts.provider === 'gpt-sovits' ? 'sovits' : config.tts.provider;
      return new Response(
        JSON.stringify({
          success: true,
          provider: responseProvider,
          message: responseProvider === 'sovits'
            ? 'Voice settings saved. SoVITS server started successfully.'
            : `Voice settings saved. Provider switched to ${responseProvider}.`,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (serviceError) {
      // Settings were saved, but service failed to start
      console.error('[voice-settings] Service orchestration failed:', serviceError);
      const responseProvider = config.tts.provider === 'gpt-sovits' ? 'sovits' : config.tts.provider;
      return new Response(
        JSON.stringify({
          success: false,
          error: `Settings saved, but failed to start ${responseProvider} server: ${(serviceError as Error).message}`,
          provider: responseProvider,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
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

async function syncTTSBackends(
  previousProvider: string,
  nextProvider: string,
  config: VoiceConfig,
  previousDeviceSettings?: {
    previousRvcDevice?: 'cuda' | 'cpu';
    previousKokoroDevice?: 'cuda' | 'cpu';
  }
): Promise<void> {
  const normalize = (provider: string) => provider === 'sovits' || provider === 'gpt-sovits' ? 'gpt-sovits' : provider;
  const prev = normalize(previousProvider);
  const next = normalize(nextProvider);

  // Check for device changes within the same provider
  const rvcDeviceChanged = previousDeviceSettings?.previousRvcDevice &&
    config.tts.rvc?.device &&
    previousDeviceSettings.previousRvcDevice !== config.tts.rvc.device;

  const kokoroDeviceChanged = previousDeviceSettings?.previousKokoroDevice &&
    config.tts.kokoro?.device &&
    previousDeviceSettings.previousKokoroDevice !== config.tts.kokoro.device;

  // If provider didn't change and no device changes, nothing to do
  if (prev === next && !rvcDeviceChanged && !kokoroDeviceChanged) {
    return;
  }

  if (prev !== next) {
    console.log(`[voice-settings] Provider switch: ${previousProvider} → ${nextProvider}`);
  }

  if (rvcDeviceChanged) {
    console.log(`[voice-settings] RVC device changed: ${previousDeviceSettings?.previousRvcDevice} → ${config.tts.rvc?.device}`);
  }

  if (kokoroDeviceChanged) {
    console.log(`[voice-settings] Kokoro device changed: ${previousDeviceSettings?.previousKokoroDevice} → ${config.tts.kokoro?.device}`);
  }

  // Handle device changes for active providers (restart servers)
  if (rvcDeviceChanged && next === 'rvc') {
    try {
      console.log('[voice-settings] Restarting RVC server with new device...');
      await stopServer('rvc');
      // The RVC server will auto-start with new device settings on next TTS request
      // via the server-manager in createTTSService()
      console.log('[voice-settings] RVC server stopped. Will restart with new device on next use.');
    } catch (error) {
      console.error('[voice-settings] Failed to restart RVC server:', error);
    }
  }

  if (kokoroDeviceChanged && next === 'kokoro') {
    try {
      console.log('[voice-settings] Restarting Kokoro server with new device...');
      await stopServer('kokoro');
      // The Kokoro server will auto-start with new device settings on next TTS request
      // via the server-manager in createTTSService()
      console.log('[voice-settings] Kokoro server stopped. Will restart with new device on next use.');
    } catch (error) {
      console.error('[voice-settings] Failed to restart Kokoro server:', error);
    }
  }

  // Stop previous provider's services (only if provider actually changed)
  if (prev !== next) {
    if (prev === 'gpt-sovits') {
      try {
        console.log('[voice-settings] Stopping SoVITS server...');
        await stopSovitsServer();
      } catch (error) {
        console.error('[voice-settings] Failed to stop SoVITS server:', error);
      }
    } else if (prev === 'rvc') {
      try {
        console.log('[voice-settings] Stopping RVC server...');
        await stopServer('rvc');
      } catch (error) {
        console.error('[voice-settings] Failed to stop RVC server:', error);
      }
    } else if (prev === 'kokoro') {
      try {
        console.log('[voice-settings] Stopping Kokoro server...');
        await stopServer('kokoro');
      } catch (error) {
        console.error('[voice-settings] Failed to stop Kokoro server:', error);
      }
    }

    // Start new provider's services
    if (next === 'gpt-sovits') {
      const port = extractSovitsPort(config);
      try {
        console.log(`[voice-settings] Starting SoVITS server on port ${port}...`);
        const result = await startSovitsServer(port);
        if (!result.success) {
          console.error('[voice-settings] Failed to start SoVITS server:', result.error);
          throw new Error(result.error || 'Failed to start SoVITS server');
        }
        console.log(`[voice-settings] SoVITS server started successfully`);
      } catch (error) {
        console.error('[voice-settings] Error starting SoVITS server:', error);
        throw error; // Propagate error so user knows the server didn't start
      }
    } else if (next === 'rvc') {
      console.log('[voice-settings] Switched to RVC (server will auto-start on next use)');
    } else if (next === 'kokoro') {
      console.log('[voice-settings] Switched to Kokoro (server will auto-start on next use)');
    } else if (next === 'piper') {
      console.log('[voice-settings] Switched to Piper (no background service needed)');
    }
  }
}

function extractSovitsPort(config: VoiceConfig): number {
  const serverUrl = config.tts.sovits?.serverUrl;
  if (!serverUrl) return 9880;

  try {
    const parsed = new URL(serverUrl);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return 9880;
  }
}

export const GET = withUserContext(getHandler);
export const POST = withUserContext(postHandler);

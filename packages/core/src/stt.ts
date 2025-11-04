/**
 * Speech-to-Text Service
 * Converts audio to text using Whisper (faster-whisper)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { transcribe as transcribeFlexible } from './transcription.js';
import { audit } from './audit.js';

export interface STTConfig {
  provider: 'whisper';
  whisper: {
    model: string; // 'tiny.en', 'base.en', 'small.en', 'medium.en'
    device: 'auto' | 'cpu' | 'cuda';
    computeType: 'int8' | 'float16' | 'float32';
    language: string;
  };
}

interface VoiceConfig {
  stt: STTConfig;
  providerPriority?: Array<'python' | 'whisper.cpp' | 'mock'>;
}

let config: VoiceConfig | null = null;

/**
 * Load voice configuration from etc/voice.json
 */
function loadConfig(): VoiceConfig {
  if (config) return config;

  const configPath = path.join(paths.root, 'etc', 'voice.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Voice configuration not found at etc/voice.json');
  }

  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config!;
}

/**
 * Transcribe audio buffer to text using Whisper
 */
export async function transcribeAudio(audioBuffer: Buffer, audioFormat: 'wav' | 'webm' | 'mp3' = 'wav'): Promise<string> {
  const cfg = loadConfig();
  const startTime = Date.now();
  const priority = cfg.providerPriority && cfg.providerPriority.length > 0
    ? cfg.providerPriority
    : ['python', 'whisper.cpp', 'mock'];

  // Save audio buffer to temp file
  const cacheDir = path.join(paths.root, 'out', 'voice-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const tempAudioFile = path.join(cacheDir, `stt_${Date.now()}.${audioFormat}`);
  fs.writeFileSync(tempAudioFile, audioBuffer);

  // Try providers in configured priority order
  // 1) Python faster-whisper
  if (priority.includes('python')) try {
    // Use the temp audio file directly - PyAV (in faster-whisper) handles webm/mp3/wav
    const inputForWhisper = tempAudioFile;

    // If local Python venv is unavailable, fall back to flexible transcriber
    const venvPython = path.join(paths.root, 'venv', 'bin', 'python3');
    if (!fs.existsSync(venvPython)) {
      // Try whisper.cpp via flexible transcriber with explicit binary/model paths
      const whisperBinCandidates = [
        path.join(paths.root, 'vendor', 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
        path.join(paths.root, 'vendor', 'whisper.cpp', 'build', 'bin', 'main'),
        process.env.WHISPER_BIN,
      ].filter(Boolean) as string[];
      const modelCandidates = [
        path.join(paths.root, 'vendor', 'whisper.cpp', 'models', 'ggml-base.en.bin'),
        path.join(paths.root, 'vendor', 'whisper.cpp', 'models', 'for-tests-ggml-base.en.bin'),
        process.env.WHISPER_MODEL,
      ].filter(Boolean) as string[];

      const fallback = await transcribeFlexible(inputForWhisper, {
        provider: 'mock', // auto-switch to whisper.cpp if available
        language: cfg.stt.whisper.language,
        whisperCppPath: whisperBinCandidates.find(p => p && fs.existsSync(p)),
        modelPath: modelCandidates.find(p => p && fs.existsSync(p)),
      });

      // Clean up temp file
      try { fs.unlinkSync(tempAudioFile) } catch {}

      const duration = Date.now() - startTime;
      audit({
        level: 'info',
        category: 'action',
        event: 'stt_transcribed_fallback',
        details: {
          provider: 'transcription',
          audioSize: audioBuffer.length,
          audioFormat,
          textLength: (fallback.text || '').length,
          language: fallback.language || cfg.stt.whisper.language,
          durationMs: duration,
          note: 'Python venv not found; used mock or whisper.cpp',
        },
        actor: 'system',
      });

      return fallback.text || '';
    }

    // Call Python script to run Whisper transcription (faster-whisper)
    const pythonScript = `
from faster_whisper import WhisperModel
import sys
import json

model = WhisperModel('${cfg.stt.whisper.model}', device='${cfg.stt.whisper.device}', compute_type='${cfg.stt.whisper.computeType}')
segments, info = model.transcribe(r'${inputForWhisper.replace(/\\/g, '\\\\')}', language='${cfg.stt.whisper.language}')

result = {
  'text': ' '.join([segment.text.strip() for segment in segments]),
  'language': info.language,
  'language_probability': info.language_probability
}

print(json.dumps(result))
`;

    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(venvPython, ['-c', pythonScript], {
        cwd: paths.root,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Whisper process exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });

    // Parse result
    const parsed = JSON.parse(result);
    const transcript = parsed.text;

    // Clean up temp file
    try { fs.unlinkSync(tempAudioFile); } catch {}

    const duration = Date.now() - startTime;

    audit({
      level: 'info',
      category: 'action',
      event: 'stt_transcribed',
      details: {
        audioSize: audioBuffer.length,
        audioFormat,
        textLength: transcript.length,
        language: parsed.language,
        languageProbability: parsed.language_probability,
        durationMs: duration,
      },
      actor: 'system',
    });

    return transcript;
  } catch (error) {
    // continue to next provider
  }

  // 2) whisper.cpp via transcription.ts, if allowed by priority
  if (priority.includes('whisper.cpp')) try {
    const whisperBinCandidates = [
      path.join(paths.root, 'vendor', 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
      path.join(paths.root, 'vendor', 'whisper.cpp', 'build', 'bin', 'main'),
      process.env.WHISPER_BIN,
    ].filter(Boolean) as string[];
    const modelCandidates = [
      path.join(paths.root, 'vendor', 'whisper.cpp', 'models', 'ggml-base.en.bin'),
      path.join(paths.root, 'vendor', 'whisper.cpp', 'models', 'ggml-small.en.bin'),
      process.env.WHISPER_MODEL,
    ].filter(Boolean) as string[];

    const fallback = await transcribeFlexible(tempAudioFile, {
      provider: 'whisper.cpp',
      language: cfg.stt.whisper.language,
      whisperCppPath: whisperBinCandidates.find(p => p && fs.existsSync(p)),
      modelPath: modelCandidates.find(p => p && fs.existsSync(p)),
    });

    try { if (fs.existsSync(tempAudioFile)) fs.unlinkSync(tempAudioFile); } catch {}

    const duration = Date.now() - startTime;
    audit({
      level: 'info',
      category: 'action',
      event: 'stt_transcribed_fallback',
      details: {
        provider: 'whisper.cpp',
        audioSize: audioBuffer.length,
        audioFormat,
        textLength: (fallback.text || '').length,
        language: fallback.language || cfg.stt.whisper.language,
        durationMs: duration,
      },
      actor: 'system',
    });
    return fallback.text || '';
  } catch (error) {
    // continue to next provider
  }

  // 3) mock (always allowed as last resort)
  if (priority.includes('mock')) {
    try { if (fs.existsSync(tempAudioFile)) fs.unlinkSync(tempAudioFile); } catch {}
    const m = await transcribeFlexible(tempAudioFile, { provider: 'mock', language: cfg.stt.whisper.language });
    return m.text || '';
  }

  // If none succeed and mock not allowed, throw
  try { if (fs.existsSync(tempAudioFile)) fs.unlinkSync(tempAudioFile); } catch {}
  throw new Error('No STT provider available (python/whisper.cpp/mock all failed or disabled)');
}

/**
 * Get STT status and configuration
 */
export function getSTTStatus(): {
  provider: string;
  model: string;
  device: string;
  computeType: string;
} {
  const cfg = loadConfig();

  return {
    provider: cfg.stt.provider,
    model: cfg.stt.whisper.model,
    device: cfg.stt.whisper.device,
    computeType: cfg.stt.whisper.computeType,
  };
}

/**
 * Transcription Module
 * Provides flexible audio transcription with multiple backends:
 * - whisper.cpp (local, fast)
 * - OpenAI Whisper API (explicit cloud provider)
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './path-builder.js';

export interface TranscriptionConfig {
  provider: 'whisper.cpp' | 'openai';
  whisperCppPath?: string; // Path to whisper.cpp executable
  modelPath?: string; // Path to whisper model file
  openaiApiKey?: string;
  language?: string;
  temperature?: number;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number; // seconds
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Transcribe using whisper.cpp
 */
function resolveWhisperBinary(customPath?: string): string | null {
  const candidates = [
    customPath,
    process.env.WHISPER_BIN,
    path.join(ROOT, 'vendor', 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
    path.join(ROOT, 'vendor', 'whisper.cpp', 'build', 'bin', 'main'),
    'whisper',
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      const res = spawnSync(p, ['--help'], { stdio: 'ignore' });
      if (res.status === 0 || res.status === null) return p;
    } catch {}
  }
  return null;
}

function resolveWhisperModel(customModelPath?: string): string | null {
  const candidates = [
    customModelPath,
    process.env.WHISPER_MODEL,
    path.join(ROOT, 'vendor', 'whisper.cpp', 'models', 'ggml-base.en.bin'),
    // Do NOT use "for-tests" placeholder models unless nothing else is present
    path.join(ROOT, 'vendor', 'whisper.cpp', 'models', 'for-tests-ggml-base.en.bin'),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const stat = fs.statSync(p);
      // Skip tiny placeholder models and explicit "for-tests" files
      if (p.includes('for-tests') || stat.size < 5_000_000) continue;
      return p;
    } catch {}
  }
  return null;
}

async function transcribeWhisperCpp(
  audioPath: string,
  config: TranscriptionConfig
): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    const whisperPath = resolveWhisperBinary(config.whisperCppPath || undefined);
    const modelPath = resolveWhisperModel(config.modelPath || undefined);
    if (!whisperPath) return reject(new Error('whisper.cpp executable not found'));
    if (!modelPath) return reject(new Error('A real whisper.cpp model was not found'));

    // Ensure input is WAV for whisper.cpp; transcode WEBM/MP3 if needed
    let inputPath = audioPath;
    const ext = path.extname(audioPath).toLowerCase();
    let tempWav: string | null = null;
    if (ext !== '.wav') {
      try {
        const outDir = path.dirname(audioPath);
        tempWav = path.join(outDir, `${path.basename(audioPath, ext)}.wav`);
        const ff = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', audioPath, '-ac', '1', '-ar', '16000', tempWav], { cwd: ROOT });
        if (ff.status !== 0) throw new Error('ffmpeg conversion failed');
        inputPath = tempWav;
      } catch (e) {
        return reject(new Error(`Failed to convert input to WAV for whisper.cpp: ${(e as Error).message}`));
      }
    }

    // Build whisper.cpp command
    const args = [
      '-m', modelPath,
      '-f', inputPath,
      '--output-txt',
      '--output-json',
    ];

    if (config.language) {
      args.push('-l', config.language);
    }

    if (config.temperature !== undefined) {
      args.push('--temperature', config.temperature.toString());
    }

    console.log(`Spawning whisper.cpp: ${whisperPath} ${args.join(' ')}`);
    const whisper = spawn(whisperPath, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    whisper.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('whisper.cpp stdout:', output);
    });

    whisper.stderr.on('data', (data) => {
      const errorOutput = data.toString();
      stderr += errorOutput;
      console.error('whisper.cpp stderr:', errorOutput);
    });

    whisper.on('close', (code) => {
      console.log(`whisper.cpp process exited with code ${code}`);
      if (tempWav) { try { fs.unlinkSync(tempWav) } catch {} }
      if (code !== 0) {
        reject(new Error(`whisper.cpp failed with code ${code}: ${stderr}`));
        return;
      }

      // whisper.cpp writes output files as: <input>.txt and <input>.json
      // Try both patterns: exact inputPath + ext, and basePath replacement
      const basePath = inputPath.replace(/\.[^.]+$/, '');
      const txtCandidates = [
        `${inputPath}.txt`,
        `${basePath}.txt`,
      ];
      const jsonCandidates = [
        `${inputPath}.json`,
        `${basePath}.json`,
      ];

      console.log(`Looking for transcription files among candidates:`);
      console.log(`  txt: ${txtCandidates.join(' | ')}`);
      console.log(`  json: ${jsonCandidates.join(' | ')}`);

      try {
        let text = '';
        let segments: TranscriptionResult['segments'] = undefined;

        // Read text output
        let txtPath: string | null = null;
        for (const p of txtCandidates) {
          if (fs.existsSync(p)) { txtPath = p; break }
        }
        console.log(`Checking for txt file at ${txtPath || txtCandidates.join(' | ')}: ${txtPath ? 'true' : 'false'}`);
        if (txtPath) {
          text = fs.readFileSync(txtPath, 'utf8').trim();
          console.log(`Read ${text.length} chars from txt file.`);
          try { fs.unlinkSync(txtPath) } catch {}
        }

        // Read JSON output for segments
        let jsonPath: string | null = null;
        for (const p of jsonCandidates) {
          if (fs.existsSync(p)) { jsonPath = p; break }
        }
        console.log(`Checking for json file at ${jsonPath || jsonCandidates.join(' | ')}: ${jsonPath ? 'true' : 'false'}`);
        if (jsonPath) {
          const jsonContent = fs.readFileSync(jsonPath, 'utf8');
          console.log(`Read ${jsonContent.length} chars from json file.`);
          const json = JSON.parse(jsonContent);
          segments = json.transcription?.map((seg: any) => ({
            start: seg.offsets?.from || 0,
            end: seg.offsets?.to || 0,
            text: seg.text || '',
          }));
          // Clean up temp file
          try { fs.unlinkSync(jsonPath) } catch {}
        }

        if (!text) {
          console.warn(`No transcription text generated for ${audioPath}. The audio file may be too short or silent. Full stderr: ${stderr}`);
          resolve({ text: '' });
          return;
        }

        resolve({
          text,
          language: config.language || 'en',
          segments,
        });
      } catch (error) {
        reject(error);
      }
    });

    whisper.on('error', (error) => {
      reject(new Error(`Failed to spawn whisper.cpp: ${error.message}`));
    });
  });
}

/**
 * Transcribe using OpenAI Whisper API
 */
async function transcribeOpenAI(
  audioPath: string,
  config: TranscriptionConfig
): Promise<TranscriptionResult> {
  if (!config.openaiApiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const formData = new FormData();
  const audio = new Blob([fs.readFileSync(audioPath)]);
  formData.append('file', audio, path.basename(audioPath));
  formData.append('model', 'whisper-1');

  if (config.language) {
    formData.append('language', config.language);
  }

  if (config.temperature !== undefined) {
    formData.append('temperature', config.temperature.toString());
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openaiApiKey}`,
    },
    body: formData as any,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const result = await response.json() as any;

  return {
    text: result.text,
    language: result.language || config.language,
    duration: result.duration,
  };
}

/**
 * Check if whisper.cpp is available
 */
export function isWhisperCppAvailable(whisperPath?: string): boolean {
  try {
    const result = spawnSync(whisperPath || 'whisper', ['--help'], {
      stdio: 'ignore',
    });
    return result.status === 0 || result.status === null;
  } catch {
    return false;
  }
}

/**
 * Main transcription function
 * Automatically selects best available provider
 */
export async function transcribe(
  audioPath: string,
  config?: Partial<TranscriptionConfig>
): Promise<TranscriptionResult> {
  const fullConfig: TranscriptionConfig = {
    provider: config?.provider || (isWhisperCppAvailable(config?.whisperCppPath) ? 'whisper.cpp' : 'openai'),
    language: config?.language || 'en',
    temperature: config?.temperature ?? 0.0,
    whisperCppPath: config?.whisperCppPath,
    modelPath: config?.modelPath,
    openaiApiKey: config?.openaiApiKey,
  };

  switch (fullConfig.provider) {
    case 'whisper.cpp':
      return transcribeWhisperCpp(audioPath, fullConfig);

    case 'openai':
      return transcribeOpenAI(audioPath, fullConfig);
  }
}

/**
 * Get recommended provider based on availability
 */
export function getRecommendedProvider(config?: Partial<TranscriptionConfig>): string {
  if (isWhisperCppAvailable(config?.whisperCppPath)) {
    return 'whisper.cpp (local, fast)';
  }
  if (config?.openaiApiKey) {
    return 'openai (cloud, requires API key)';
  }
  return 'unavailable';
}

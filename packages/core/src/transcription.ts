/**
 * Transcription Module
 * Provides flexible audio transcription with multiple backends:
 * - Mock (for testing without Whisper)
 * - whisper.cpp (local, fast)
 * - OpenAI Whisper API (cloud fallback)
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';

export interface TranscriptionConfig {
  provider: 'mock' | 'whisper.cpp' | 'openai';
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
 * Mock transcription for testing
 */
async function transcribeMock(audioPath: string): Promise<TranscriptionResult> {
  const filename = path.basename(audioPath);
  const stats = fs.statSync(audioPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  return {
    text: `[Mock Transcription]\n\nThis is a placeholder transcription for: ${filename}\nFile size: ${sizeMB}MB\n\nIn production, this would contain the actual transcribed text from the audio file. To enable real transcription, install whisper.cpp or configure OpenAI API key.`,
    language: 'en',
    duration: 0,
  };
}

/**
 * Transcribe using whisper.cpp
 */
function resolveWhisperBinary(customPath?: string): string | null {
  const candidates = [
    customPath,
    process.env.WHISPER_BIN,
    path.join(paths.root, 'vendor', 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
    path.join(paths.root, 'vendor', 'whisper.cpp', 'build', 'bin', 'main'),
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

function resolveWhisperModel(customModelPath?: string): string {
  const candidates = [
    customModelPath,
    process.env.WHISPER_MODEL,
    path.join(paths.root, 'vendor', 'whisper.cpp', 'models', 'ggml-base.en.bin'),
    // Do NOT use "for-tests" placeholder models unless nothing else is present
    path.join(paths.root, 'vendor', 'whisper.cpp', 'models', 'for-tests-ggml-base.en.bin'),
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
  // Final fallback: let whisper.cpp attempt relative path (may fail)
  return 'models/ggml-base.en.bin';
}

async function transcribeWhisperCpp(
  audioPath: string,
  config: TranscriptionConfig
): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    const whisperPath = resolveWhisperBinary(config.whisperCppPath || undefined) || 'whisper';
    const modelPath = resolveWhisperModel(config.modelPath || undefined);
    if (modelPath.includes('for-tests')) {
      return reject(new Error('whisper.cpp model is a placeholder (for-tests). Download a real model (e.g., ggml-base.en.bin).'));
    }

    // Ensure input is WAV for whisper.cpp; transcode WEBM/MP3 if needed
    let inputPath = audioPath;
    const ext = path.extname(audioPath).toLowerCase();
    let tempWav: string | null = null;
    if (ext !== '.wav') {
      try {
        const outDir = path.dirname(audioPath);
        tempWav = path.join(outDir, `${path.basename(audioPath, ext)}.wav`);
        const ff = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', audioPath, '-ac', '1', '-ar', '16000', tempWav], { cwd: paths.root });
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
      cwd: paths.root,
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

  // Use global FormData (Node 18/undici) and append file stream
  const formData = new (globalThis as any).FormData();
  const fileStream = fs.createReadStream(audioPath);
  formData.append('file', fileStream as any, path.basename(audioPath));
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
    provider: config?.provider || 'mock',
    language: config?.language || 'en',
    temperature: config?.temperature ?? 0.0,
    whisperCppPath: config?.whisperCppPath,
    modelPath: config?.modelPath,
    openaiApiKey: config?.openaiApiKey,
  };

  // Auto-detect provider if set to mock but whisper.cpp is available
  if (fullConfig.provider === 'mock' && isWhisperCppAvailable(fullConfig.whisperCppPath)) {
    fullConfig.provider = 'whisper.cpp';
  }

  switch (fullConfig.provider) {
    case 'whisper.cpp':
      try {
        return await transcribeWhisperCpp(audioPath, fullConfig);
      } catch (e) {
        console.warn(`[transcription] whisper.cpp failed, falling back to mock: ${(e as Error).message}`)
        return transcribeMock(audioPath);
      }

    case 'openai':
      try {
        return await transcribeOpenAI(audioPath, fullConfig);
      } catch (e) {
        console.warn(`[transcription] openai failed, falling back to mock: ${(e as Error).message}`)
        return transcribeMock(audioPath);
      }

    case 'mock':
    default:
      return transcribeMock(audioPath);
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
  return 'mock (placeholder only)';
}

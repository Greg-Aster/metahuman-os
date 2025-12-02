/**
 * Speech-to-Text Service
 * Converts audio to text using Whisper (faster-whisper)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './path-builder.js';
import { transcribe as transcribeFlexible } from './transcription.js';
import { audit } from './audit.js';
import { WhisperService } from './stt/providers/whisper-service.js';
import type { WhisperConfig } from './stt/providers/whisper-service.js';

export interface STTConfig {
  provider: 'whisper';
  whisper: WhisperConfig;
}

interface VoiceConfig {
  stt: STTConfig;
  providerPriority?: Array<'python' | 'whisper.cpp' | 'mock'>;
}

let config: VoiceConfig | null = null;
let whisperService: WhisperService | null = null;

/**
 * Load voice configuration from etc/voice.json
 */
function loadConfig(): VoiceConfig {
  if (config) return config;

  const configPath = path.join(systemPaths.etc, 'voice.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Voice configuration not found at etc/voice.json');
  }

  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Initialize WhisperService
  if (config && config.stt && config.stt.whisper) {
    whisperService = new WhisperService(config.stt.whisper);
  }

  return config!;
}

/**
 * Transcribe audio buffer to text using Whisper
 */
export async function transcribeAudio(audioBuffer: Buffer, audioFormat: 'wav' | 'webm' | 'mp3' = 'wav'): Promise<string> {
  loadConfig(); // Ensure config and whisperService are initialized

  if (!whisperService) {
    throw new Error('Whisper service not initialized. Check voice.json configuration.');
  }

  return whisperService.transcribe(audioBuffer, audioFormat);
}

/**
 * Get STT status and configuration
 */
export async function getSTTStatus(): Promise<{
  provider: string;
  model: string;
  device: string;
  computeType: string;
  serverUrl?: string;
  serverAvailable?: boolean;
  available: boolean;
  error?: string;
}> {
  loadConfig();

  if (!whisperService) {
    return {
      provider: 'whisper',
      model: 'unknown',
      device: 'unknown',
      computeType: 'unknown',
      available: false,
      error: 'Whisper service not initialized',
    };
  }

  return whisperService.getStatus();
}

/**
 * Stop the Whisper server
 */
export async function stopWhisperServer(): Promise<void> {
  if (whisperService) {
    await whisperService.stopServer();
  }
}

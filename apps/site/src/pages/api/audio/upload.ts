/**
 * API endpoint for uploading audio files
 * Saves to memory/audio/inbox for processing by transcriber agent
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths, generateId, audit } from '@metahuman/core';

const AUDIO_CONFIG_PATH = path.join(paths.etc, 'audio.json');

interface AudioConfig {
  formats: {
    supported: string[];
    maxSizeMB: number;
  };
}

function loadAudioConfig(): AudioConfig {
  if (!fs.existsSync(AUDIO_CONFIG_PATH)) {
    // Return defaults if config doesn't exist
    return {
      formats: {
        supported: ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'flac'],
        maxSizeMB: 100,
      },
    };
  }
  return JSON.parse(fs.readFileSync(AUDIO_CONFIG_PATH, 'utf8'));
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('audio') as File;

    if (!file) {
      return new Response(
        JSON.stringify({ success: false, error: 'No audio file provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load configuration
    const config = loadAudioConfig();

    // Validate file type
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !config.formats.supported.includes(ext)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Unsupported format. Supported: ${config.formats.supported.join(', ')}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > config.formats.maxSizeMB) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `File too large. Max size: ${config.formats.maxSizeMB}MB`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Generate unique filename
    const audioId = generateId('audio');
    const filename = `${audioId}.${ext}`;
    const filepath = path.join(paths.audioInbox, filename);

    // Ensure directory exists
    fs.mkdirSync(paths.audioInbox, { recursive: true });

    // Save file
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    // Audit the upload
    audit({
      level: 'info',
      category: 'data',
      event: 'audio_uploaded',
      details: {
        audioId,
        filename,
        size: file.size,
        sizeMB: sizeMB.toFixed(2),
        format: ext,
      },
      actor: 'human',
    });

    return new Response(
      JSON.stringify({
        success: true,
        audioId,
        filename,
        size: file.size,
        message: 'Audio uploaded successfully. Transcription will begin automatically.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Audio upload error:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'audio_upload_failed',
      details: { error: (error as Error).message },
      actor: 'system',
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to upload audio file',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

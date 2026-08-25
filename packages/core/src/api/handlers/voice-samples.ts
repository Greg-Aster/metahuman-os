/**
 * Voice Samples Handler
 *
 * Serves voice training audio files
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { storageClient } from '../../storage-client.js';

/**
 * GET /api/voice-samples/:sampleId
 *
 * Serves voice training sample audio files
 */
export async function handleGetVoiceSample(req: UnifiedRequest): Promise<UnifiedResponse> {
  const sampleId = req.params?.sampleId;

  if (!sampleId || !/^[A-Za-z0-9_-]{1,128}$/.test(sampleId)) {
    return {
      status: 400,
      error: 'Sample ID required',
    };
  }

  // Look for the audio file in the voice training directory
  const trainingResult = storageClient.resolvePath({
    username: req.user.username,
    category: 'voice',
    subcategory: 'training',
  });
  if (!trainingResult.success || !trainingResult.path) {
    return {
      status: 500,
      error: 'Cannot resolve voice training path',
    };
  }

  const trainingDir = trainingResult.path;
  const audioPath = path.join(trainingDir, `${sampleId}.wav`);

  if (!fs.existsSync(audioPath)) {
    return {
      status: 404,
      error: 'Sample not found',
    };
  }

  try {
    // Read and serve the audio file
    const audioBuffer = fs.readFileSync(audioPath);

    return {
      status: 200,
      binary: audioBuffer,
      contentType: 'audio/wav',
      headers: {
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    };
  } catch (error) {
    console.error('[voice-samples] Error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

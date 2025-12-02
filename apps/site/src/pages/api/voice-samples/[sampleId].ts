/**
 * API endpoint to serve voice training sample audio files
 * GET /api/voice-samples/:sampleId
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { storageClient } from '@metahuman/core';

export const GET: APIRoute = async ({ params }) => {
  try {
    const { sampleId } = params;

    if (!sampleId) {
      return new Response(JSON.stringify({ error: 'Sample ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Look for the audio file in the voice training directory
    const trainingResult = storageClient.resolvePath({ category: 'voice', subcategory: 'training' });
    if (!trainingResult.success || !trainingResult.path) {
      return new Response(JSON.stringify({ error: 'Cannot resolve voice training path' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const trainingDir = trainingResult.path;
    const audioPath = path.join(trainingDir, `${sampleId}.wav`);

    if (!fs.existsSync(audioPath)) {
      return new Response(JSON.stringify({ error: 'Sample not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Read and serve the audio file
    const audioBuffer = fs.readFileSync(audioPath);

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error('[voice-samples API] Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

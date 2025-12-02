import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import {
  copyToKokoroDataset,
  deleteKokoroSample,
  getKokoroTrainingReadiness,
  getKokoroTrainingStatus,
  getReferenceSamples,
  listKokoroSamples,
  startKokoroVoicepackTraining,
  storageClient,
  systemPaths,
} from '@metahuman/core';

/**
 * Kokoro Voice Training API
 * Handles dataset management and StyleTTS2-style voicepack training.
 */

const getHandler: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const speakerId = url.searchParams.get('speakerId') || 'default';

  const pathResult = storageClient.resolvePath({
    category: 'voice',
    subcategory: 'training-data',
  });
  if (!pathResult.success || !pathResult.path) {
    return new Response(
      JSON.stringify({ error: 'Authentication required for voice training' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    switch (action) {
      case 'training-readiness': {
        const readiness = getKokoroTrainingReadiness(speakerId);
        return new Response(JSON.stringify(readiness), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'list-samples': {
        const samples = listKokoroSamples(speakerId);
        return new Response(JSON.stringify({ samples }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'training-status': {
        const status = getKokoroTrainingStatus(speakerId);
        return new Response(JSON.stringify(status), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'training-logs': {
        const logPath = path.join(systemPaths.logs, 'run', `kokoro-training-${speakerId}.log`);

        if (!fs.existsSync(logPath)) {
          return new Response(JSON.stringify({ logs: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        try {
          const content = fs.readFileSync(logPath, 'utf-8');
          const lines = content.split('\n').filter(line => line.trim());

          // Return last 100 lines to avoid overwhelming the UI
          const recentLines = lines.slice(-100);

          return new Response(JSON.stringify({ logs: recentLines }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('[kokoro-training] Error reading log file:', error);
          return new Response(JSON.stringify({ logs: [], error: 'Failed to read logs' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('[kokoro-training] GET error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process request' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

const postHandler: APIRoute = async ({ request }) => {
  const pathResult = storageClient.resolvePath({
    category: 'voice',
    subcategory: 'training-data',
  });
  if (!pathResult.success || !pathResult.path) {
    return new Response(
      JSON.stringify({ error: 'Authentication required for voice training' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const {
      action,
      speakerId = 'default',
      sampleIds,
      sampleId,
      minQuality = 0.75,
      langCode,
      baseVoice,
      epochs,
      learningRate,
      regularization,
      device,
      maxSamples,
      continueFromCheckpoint,
      pureTraining,
    } = body;

    switch (action) {
      case 'copy-samples': {
        if (!sampleIds || !Array.isArray(sampleIds)) {
          return new Response(
            JSON.stringify({ error: 'sampleIds array required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const copied = copyToKokoroDataset(sampleIds, speakerId);
        return new Response(JSON.stringify({
          success: true,
          message: `Copied ${copied} samples to Kokoro dataset`,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'auto-export': {
        // Auto-export with configurable options
        const selectionMethod = body.selectionMethod || 'quality';
        const targetDuration = body.targetDuration; // in seconds
        const exportMaxSamples = body.maxSamples || 300;

        const samples = getReferenceSamples(minQuality, selectionMethod);
        if (samples.length === 0) {
          return new Response(
            JSON.stringify({ error: 'No suitable samples found. Need high-quality recordings.' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Select samples based on duration and count limits
        let selectedSamples = samples;
        if (targetDuration || exportMaxSamples) {
          let totalDuration = 0;
          selectedSamples = [];
          for (const sample of samples) {
            if (exportMaxSamples && selectedSamples.length >= exportMaxSamples) break;
            if (targetDuration && totalDuration >= targetDuration) break;
            selectedSamples.push(sample);
            totalDuration += sample.duration;
          }
        }

        const ids = selectedSamples.map(s => s.id);
        const copied = copyToKokoroDataset(ids, speakerId);
        return new Response(JSON.stringify({
          success: true,
          message: `Auto-exported ${copied} samples to Kokoro dataset (${selectionMethod} selection)`,
          selectionMethod,
          targetDuration,
          maxSamples: exportMaxSamples,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'delete-sample': {
        if (!sampleId) {
          return new Response(
            JSON.stringify({ error: 'sampleId required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        deleteKokoroSample(speakerId, sampleId);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'start-training': {
        const result = await startKokoroVoicepackTraining(speakerId, {
          langCode,
          baseVoice,
          epochs,
          learningRate,
          regularization,
          device,
          maxSamples,
          continueFromCheckpoint,
          pureTraining,
        });

        if (!result.success) {
          return new Response(
            JSON.stringify({ error: result.error || 'Failed to start training' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(JSON.stringify({
          success: true,
          message: result.message || 'Voicepack training started',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'cancel-training': {
        // Kill the training process by finding and terminating it
        try {
          const { execSync } = await import('node:child_process');
          // Find and kill the build_voicepack.py process
          execSync('pkill -9 -f "build_voicepack.py"', { stdio: 'ignore' });

          // Clean up status file
          const statusPath = path.join(systemPaths.logs, 'run', `kokoro-training-${speakerId}.json`);
          if (fs.existsSync(statusPath)) {
            fs.unlinkSync(statusPath);
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'Training cancelled successfully',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('[kokoro-training] Failed to cancel training:', error);
          return new Response(JSON.stringify({
            error: 'Failed to cancel training',
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('[kokoro-training] POST error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process request' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Wrap handlers with user context middleware
// MIGRATED: 2025-11-20 - Explicit authentication pattern
export const GET = getHandler;
// MIGRATED: 2025-11-20 - Explicit authentication pattern
export const POST = postHandler;

/**
 * RVC Training API Endpoint
 * Handles RVC-specific training operations
 */

import type { APIRoute } from 'astro';
import {
  copyToRVC,
  listRVCSamples,
  deleteRVCSample,
  getRVCTrainingReadiness,
  getRVCTrainingStatus,
  startRVCTraining,
  getReferenceSamples,
} from '@metahuman/core';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const speakerId = url.searchParams.get('speakerId') || 'default';

  try {
    switch (action) {
      case 'training-readiness': {
        const readiness = getRVCTrainingReadiness(speakerId);

        // Also get info about samples already copied to RVC directory
        const copiedSamples = listRVCSamples(speakerId);
        const copiedCount = copiedSamples.length;
        const copiedDuration = copiedSamples.reduce((sum, s) => sum + s.duration, 0);

        return new Response(JSON.stringify({
          ...readiness,
          copied: {
            count: copiedCount,
            duration: copiedDuration
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'list-samples': {
        const samples = listRVCSamples(speakerId);
        return new Response(JSON.stringify({ samples }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'training-status': {
        const status = getRVCTrainingStatus(speakerId);
        return new Response(JSON.stringify(status), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'training-logs': {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { systemPaths } = await import('@metahuman/core');

        const logPath = path.join(systemPaths.logs, 'run', `rvc-training-${speakerId}.log`);

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
          console.error('[rvc-training] Error reading training logs:', error);
          return new Response(JSON.stringify({ logs: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('[rvc-training API] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, speakerId = 'default', sampleIds, minQuality = 0.7 } = body;

    console.log('[rvc-training POST] Action:', action, 'Body:', body);

    switch (action) {
      case 'copy-samples': {
        if (!sampleIds || !Array.isArray(sampleIds)) {
          return new Response(JSON.stringify({ error: 'Sample IDs required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const copiedCount = copyToRVC(sampleIds, speakerId);
        return new Response(JSON.stringify({
          success: true,
          message: `Copied ${copiedCount} samples to RVC training directory`,
          copiedCount
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'auto-export': {
        // Auto-export best samples for RVC training
        const samples = getReferenceSamples(minQuality);

        if (samples.length === 0) {
          return new Response(JSON.stringify({
            error: 'No suitable samples found. Need high-quality recordings (quality ≥ 70%)'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Get sample IDs
        const sampleIds = samples.map(s => s.id);

        // Copy to RVC directory
        const copiedCount = copyToRVC(sampleIds, speakerId);

        return new Response(JSON.stringify({
          success: true,
          message: `Auto-exported ${copiedCount} high-quality samples to RVC training directory`,
          copiedCount
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'delete-sample': {
        const { sampleId } = body;
        if (!sampleId) {
          return new Response(JSON.stringify({ error: 'Sample ID required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        deleteRVCSample(speakerId, sampleId);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'start-training': {
        const { totalEpochs, saveEveryEpoch, batchSize, device } = body;

        const result = startRVCTraining(speakerId, {
          totalEpochs,
          saveEveryEpoch,
          batchSize,
          device
        });

        if (!result.success) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'RVC training started. This will take 30-60 minutes depending on your hardware.'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('[rvc-training API] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

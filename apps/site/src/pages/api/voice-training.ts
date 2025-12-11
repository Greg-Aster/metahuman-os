/**
 * Voice Training API Endpoint
 * Provides training progress and sample management
 */

import type { APIRoute } from 'astro';
import {
  getTrainingProgress,
  listVoiceSamples,
  deleteVoiceSample,
  exportTrainingDataset,
  getVoiceTrainingStatus,
  setVoiceTrainingEnabled,
  purgeVoiceTrainingData,
} from '@metahuman/core';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'progress';

  try {
    switch (action) {
      case 'progress': {
        const progress = getTrainingProgress();
        return new Response(JSON.stringify(progress), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'samples': {
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        const samples = listVoiceSamples(limit);
        return new Response(JSON.stringify({ samples }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'status': {
        const status = getVoiceTrainingStatus();
        return new Response(JSON.stringify(status), {
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
    console.error('[voice-training API] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, sampleId, enabled } = body;

    switch (action) {
      case 'delete': {
        if (!sampleId) {
          return new Response(JSON.stringify({ error: 'Sample ID required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const success = deleteVoiceSample(sampleId);
        return new Response(JSON.stringify({ success }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'export': {
        const exportPath = exportTrainingDataset();
        return new Response(JSON.stringify({ exportPath }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'toggle': {
        const result = setVoiceTrainingEnabled(enabled || false);
        return new Response(JSON.stringify({ success: true, enabled: result.enabled }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      case 'purge': {
        const result = purgeVoiceTrainingData();
        return new Response(JSON.stringify({ success: true, deletedCount: result.deletedCount }), {
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
    console.error('[voice-training API] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

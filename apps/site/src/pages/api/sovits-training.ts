import type { APIRoute } from 'astro';
import {
  copyToReference,
  autoExportBestSamples,
  listReferenceSamples,
  deleteReference,
  validateReferenceAudio,
  getTrainingReadiness,
  getAvailableSamples,
  type VoiceProvider,
} from '@metahuman/core';

/**
 * GET /api/sovits-training
 * Get training status and available samples
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const provider = (url.searchParams.get('provider') as VoiceProvider) || 'gpt-sovits';
    const speakerId = url.searchParams.get('speakerId') || 'default';
    const minQuality = parseFloat(url.searchParams.get('minQuality') || '0.7');
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);

    if (action === 'available-samples') {
      // Get available voice samples for training
      const samples = getAvailableSamples(provider, minQuality, limit);
      return new Response(JSON.stringify({ samples }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (action === 'reference-samples') {
      // Get reference audio files already copied to provider directory
      const samples = listReferenceSamples(provider, speakerId);
      return new Response(JSON.stringify({ samples }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (action === 'training-readiness') {
      // Check if enough samples exist to start training
      const readiness = getTrainingReadiness(provider, speakerId);
      return new Response(JSON.stringify(readiness), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (action === 'validate-audio') {
      // Validate a specific audio file
      const filePath = url.searchParams.get('filePath');
      if (!filePath) {
        return new Response(
          JSON.stringify({ error: 'filePath parameter required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const validation = validateReferenceAudio(filePath, provider);
      return new Response(JSON.stringify(validation), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use: available-samples, reference-samples, training-readiness, validate-audio' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('[API /sovits-training GET] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/sovits-training
 * Manage training data (copy samples, export datasets, delete references)
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, provider = 'gpt-sovits', speakerId = 'default', sampleIds, sampleId, minQuality = 0.8 } = body;

    if (action === 'copy-samples') {
      // Copy specific samples to reference directory
      if (!sampleIds || !Array.isArray(sampleIds)) {
        return new Response(
          JSON.stringify({ error: 'sampleIds array required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const copiedCount = copyToReference(sampleIds, provider as VoiceProvider, speakerId);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Copied ${copiedCount} samples to ${provider} reference directory`,
          copiedCount,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else if (action === 'auto-export') {
      // Automatically select and export best samples
      const outputDir = autoExportBestSamples(provider as VoiceProvider, speakerId, minQuality);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Exported best samples to ${provider} directory`,
          outputDir,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else if (action === 'delete-reference') {
      // Delete a specific reference audio file
      if (!sampleId) {
        return new Response(
          JSON.stringify({ error: 'sampleId required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      deleteReference(provider as VoiceProvider, speakerId, sampleId);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Deleted reference audio: ${sampleId}`,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use: copy-samples, auto-export, delete-reference' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('[API /sovits-training POST] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

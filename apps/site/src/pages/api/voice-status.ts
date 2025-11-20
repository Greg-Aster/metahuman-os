import type { APIRoute } from 'astro';
import { getTTSStatus, getUserOrAnonymous, getProfilePaths } from '@metahuman/core';
import fs from 'node:fs';
import path from 'node:path';

/**
 * GET /api/voice-status
 * Get voice system status including active provider and training metrics
 * MIGRATED: 2025-11-20 - Explicit authentication pattern
 */
const handler: APIRoute = async ({ cookies }) => {
  try {
    // Explicit auth - allow anonymous users to view TTS status (limited data)
    const user = getUserOrAnonymous(cookies);
    const username = user.username;

    // Get TTS status (provider, server availability)
    const ttsStatus = await getTTSStatus();
    console.log('[voice-status] TTS Status:', JSON.stringify(ttsStatus, null, 2));

    // Get voice training metrics
    let trainingMetrics: any = {
      totalSamples: 0,
      totalDuration: 0,
      recentSamples: [],
      providers: {
        sovits: { samples: 0, hasReference: false },
        rvc: { samples: 0, hasTrained: false },
      },
    };

    if (username !== 'anonymous') {
      const profilePaths = getProfilePaths(username);

      // Check SoVITS samples
      const sovitsDir = path.join(profilePaths.root, 'out/voices/sovits/default');
      if (fs.existsSync(sovitsDir)) {
        const files = fs.readdirSync(sovitsDir).filter(f => f.endsWith('.wav'));
        trainingMetrics.providers.sovits.samples = files.length;
        trainingMetrics.providers.sovits.hasReference = files.some(f => f.startsWith('reference'));

        // Get sample details
        const samples = files
          .filter(f => !f.includes('backup'))
          .map(f => {
            try {
              const fullPath = path.join(sovitsDir, f);
              const stats = fs.statSync(fullPath);
              const txtPath = fullPath.replace('.wav', '.txt');
              let transcript = '';
              if (fs.existsSync(txtPath)) {
                transcript = fs.readFileSync(txtPath, 'utf-8').trim();
              }
              return {
                filename: f,
                size: stats.size,
                created: stats.birthtime.toISOString(),
                transcript: transcript.substring(0, 50),
              };
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .sort((a: any, b: any) => new Date(b.created).getTime() - new Date(a.created).getTime())
          .slice(0, 5);

        trainingMetrics.recentSamples = samples;
        trainingMetrics.totalSamples += files.length;
      }

      // Check RVC samples
      const rvcSamplesDir = path.join(profilePaths.root, 'out/voices/rvc-samples/default');
      const rvcModelsDir = path.join(profilePaths.root, 'out/voices/rvc-models/default');

      if (fs.existsSync(rvcSamplesDir)) {
        const files = fs.readdirSync(rvcSamplesDir).filter(f => f.endsWith('.wav'));
        trainingMetrics.providers.rvc.samples = files.length;
        trainingMetrics.totalSamples += files.length;
      }

      if (fs.existsSync(rvcModelsDir)) {
        const modelFiles = fs.readdirSync(rvcModelsDir).filter(f => f.endsWith('.pth'));
        trainingMetrics.providers.rvc.hasTrained = modelFiles.length > 0;
      }
    }

    return new Response(
      JSON.stringify({
        tts: ttsStatus,
        training: trainingMetrics,
        username,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('[voice-status] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// Anonymous users allowed (TTS status only, no training metrics)
// Authenticated users see training metrics
export const GET = handler;

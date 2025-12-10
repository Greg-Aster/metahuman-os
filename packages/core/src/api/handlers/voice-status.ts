/**
 * Voice Status API Handlers
 *
 * Unified handlers for voice system status.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getTTSStatus } from '../../tts.js';
import { getProfilePaths } from '../../paths.js';
import fs from 'node:fs';
import path from 'node:path';

interface TrainingMetrics {
  totalSamples: number;
  totalDuration: number;
  recentSamples: Array<{
    filename: string;
    size: number;
    created: string;
    transcript: string;
  }>;
  providers: {
    sovits: { samples: number; hasReference: boolean };
    rvc: { samples: number; hasTrained: boolean };
  };
}

/**
 * GET /api/voice-status - Get voice system status including TTS and training metrics
 */
export async function handleGetVoiceStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    const username = user.isAuthenticated ? user.username : 'anonymous';

    // Get TTS status (provider, server availability)
    const ttsStatus = await getTTSStatus();
    // Only log when unavailable to reduce noise
    if (!ttsStatus.available) {
      console.log('[voice-status] TTS unavailable:', ttsStatus.error || 'server not responding');
    }

    // Get voice training metrics
    let trainingMetrics: TrainingMetrics = {
      totalSamples: 0,
      totalDuration: 0,
      recentSamples: [],
      providers: {
        sovits: { samples: 0, hasReference: false },
        rvc: { samples: 0, hasTrained: false },
      },
    };

    if (user.isAuthenticated) {
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
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
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

    return successResponse({
      tts: ttsStatus,
      training: trainingMetrics,
      username,
    });
  } catch (error) {
    console.error('[voice-status] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

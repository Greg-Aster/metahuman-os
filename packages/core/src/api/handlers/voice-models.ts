/**
 * Voice Models API Handlers
 *
 * Returns voice model paths for TTS based on current session profile.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths, ROOT } from '../../paths.js';
import { getSession } from '../../sessions.js';
import fs from 'node:fs';
import path from 'node:path';

function getDefaultVoiceModel(): string {
  try {
    const voiceConfigPath = path.join(systemPaths.etc, 'voice.json');
    if (fs.existsSync(voiceConfigPath)) {
      const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
      return voiceConfig.tts?.piper?.model || path.join(ROOT, 'out', 'voices', 'en_US-amy-medium.onnx');
    }
  } catch (error) {
    console.error('[voice-models] Failed to load default voice config:', error);
  }
  // Fallback to amy voice
  return path.join(ROOT, 'out', 'voices', 'en_US-amy-medium.onnx');
}

/**
 * GET /api/voice-models - Get voice model paths for TTS
 */
export async function handleGetVoiceModels(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    // Get session from headers if available
    const sessionId = req.headers?.['cookie']?.match(/mh_session=([^;]+)/)?.[1];

    if (!sessionId) {
      // No session - use default system voice
      return successResponse({
        models: [getDefaultVoiceModel()],
        multiVoice: false,
      });
    }

    const session = getSession(sessionId);

    if (!session) {
      // Invalid session - use default
      return successResponse({
        models: [getDefaultVoiceModel()],
        multiVoice: false,
      });
    }

    // Check if mutant-super-intelligence is active
    const sourceProfile = session.metadata?.sourceProfile;
    const mergedProfiles = session.metadata?.mergedProfiles;

    if (sourceProfile === 'mutant-super-intelligence' && Array.isArray(mergedProfiles) && mergedProfiles.length > 0) {
      // For mutant mode, use Amy voice twice (will be pitch-shifted for dual-voice effect)
      const voicesDir = path.join(ROOT, 'out', 'voices');
      const amyVoice = path.join(voicesDir, 'en_US-amy-medium.onnx');

      const voiceModels: string[] = [];

      // Add Amy twice - same voice, will be pitch-shifted differently
      if (fs.existsSync(amyVoice)) {
        voiceModels.push(amyVoice);
        voiceModels.push(amyVoice); // Same voice, will apply pitch shift to second one
      } else {
        // Fallback to first available voice
        if (fs.existsSync(voicesDir)) {
          const allVoices = fs.readdirSync(voicesDir).filter(f => f.endsWith('.onnx'));
          if (allVoices.length > 0) {
            const fallbackVoice = path.join(voicesDir, allVoices[0]);
            voiceModels.push(fallbackVoice);
            voiceModels.push(fallbackVoice); // Duplicate
          }
        }
      }

      return successResponse({
        models: voiceModels,
        multiVoice: true,
        mergedProfiles,
      });
    }

    // Regular profile - return single voice model
    return successResponse({
      models: [getDefaultVoiceModel()],
      multiVoice: false,
    });
  } catch (error) {
    console.error('[voice-models] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

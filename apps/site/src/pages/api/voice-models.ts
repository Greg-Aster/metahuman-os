import type { APIRoute } from 'astro';
import { getSession } from '@metahuman/core/sessions';
import { getUserByUsername } from '@metahuman/core/users';
import { systemPaths, ROOT } from '@metahuman/core/paths';
import fs from 'node:fs';
import path from 'node:path';

/**
 * GET /api/voice-models
 *
 * Returns voice model paths for TTS based on current session profile.
 * For mutant-super-intelligence, returns multiple voice models from merged profiles.
 * For regular profiles, returns single voice model.
 */

function getDefaultVoiceModel(): string {
  try {
    const voiceConfigPath = path.join(systemPaths.etc, 'voice.json');
    if (fs.existsSync(voiceConfigPath)) {
      const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
      return voiceConfig.tts.piper.model;
    }
  } catch (error) {
    console.error('[voice-models] Failed to load default voice config:', error);
  }
  // Fallback to amy voice
  return path.join(ROOT, 'out', 'voices', 'en_US-amy-medium.onnx');
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const sessionCookie = cookies.get('mh_session');

    if (!sessionCookie) {
      // No session - use default system voice
      return new Response(
        JSON.stringify({
          models: [getDefaultVoiceModel()],
          multiVoice: false
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const session = getSession(sessionCookie.value);

    if (!session) {
      // Invalid session - use default
      return new Response(
        JSON.stringify({
          models: [getDefaultVoiceModel()],
          multiVoice: false
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
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
        const allVoices = fs.readdirSync(voicesDir).filter(f => f.endsWith('.onnx'));
        if (allVoices.length > 0) {
          const fallbackVoice = path.join(voicesDir, allVoices[0]);
          voiceModels.push(fallbackVoice);
          voiceModels.push(fallbackVoice); // Duplicate
        }
      }

      return new Response(
        JSON.stringify({
          models: voiceModels,
          multiVoice: true,
          mergedProfiles: mergedProfiles
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Regular profile - return single voice model
    return new Response(
      JSON.stringify({
        models: [getDefaultVoiceModel()],
        multiVoice: false
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[voice-models] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

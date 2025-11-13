/**
 * API endpoint for uploading voice profile recordings
 * Saves directly to voice training directory and optionally copies to SoVITS reference
 */
import type { APIRoute } from 'astro';
import { saveVoiceSample, copyToSoVITS, setSoVITSReferenceSample } from '@metahuman/core';

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const transcript = formData.get('transcript') as string;
    const providerRaw = formData.get('provider') as string;
    const provider = providerRaw === 'sovits' ? 'gpt-sovits' : providerRaw;
    const speakerId = formData.get('speakerId') as string || 'default';
    const duration = parseFloat(formData.get('duration') as string);
    const quality = parseFloat(formData.get('quality') as string) || 1.0;
    const copyToReference = formData.get('copyToReference') === 'true';

    if (!audioFile) {
      return new Response(
        JSON.stringify({ success: false, error: 'No audio file provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!transcript || transcript.trim().length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Transcript required (at least 10 characters)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Convert audio file to buffer
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const format = audioFile.name.endsWith('.wav') ? 'wav' : 'webm';

    // Save the voice sample
    const sample = saveVoiceSample(audioBuffer, transcript, duration, quality, format);

    if (!sample) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to save voice sample (possibly too short, low quality, or training disabled)'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // If GPT-SoVITS and copyToReference is true, immediately copy to reference directory
    let copiedToReference = false;
    let referencePath: string | undefined;
    if (provider === 'gpt-sovits' && copyToReference) {
      const copiedCount = copyToSoVITS([sample.id], speakerId);
      copiedToReference = copiedCount > 0;
      if (copiedToReference) {
        try {
          const result = setSoVITSReferenceSample(speakerId, sample.id);
          referencePath = result.referencePath;
        } catch (error) {
          console.error('[voice-profile/upload] Failed to set SoVITS reference:', error);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sampleId: sample.id,
        audioPath: sample.audioPath,
        duration: sample.duration,
        quality: sample.quality,
        copiedToReference,
        referencePath,
        message: copiedToReference
          ? `Voice profile saved and set as reference audio for ${speakerId}`
          : 'Voice sample saved successfully',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[voice-profile/upload] Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

import { apiFetch } from '../api-config';

export interface KokoroTrainingConfig {
  speakerId: string;
  langCode: string;
  baseVoice: string;
  epochs: number;
  learningRate: number;
  regularization: number;
  device: 'auto' | 'cpu' | 'cuda';
  maxSamples: number;
  continueFromCheckpoint: boolean;
  pureTraining: boolean;
}

export function createDefaultKokoroConfig(): KokoroTrainingConfig {
  return {
    speakerId: 'default',
    langCode: 'a',
    baseVoice: 'af_heart',
    epochs: 120,
    learningRate: 0.0005,
    regularization: 0.005,
    device: 'cpu', // Default to CPU to avoid VRAM issues (16GB GPU not enough for 13B model + training)
    maxSamples: 200,
    continueFromCheckpoint: false,
    pureTraining: false,
  };
}

export async function startKokoroTrainingRequest(
  config: KokoroTrainingConfig
): Promise<{ ok: boolean; message: string }> {
  const response = await apiFetch('/api/kokoro-training', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'start-training',
      speakerId: config.speakerId,
      langCode: config.langCode,
      baseVoice: config.baseVoice,
      epochs: config.epochs,
      learningRate: config.learningRate,
      regularization: config.regularization,
      device: config.device,
      maxSamples: config.maxSamples,
      continueFromCheckpoint: config.continueFromCheckpoint,
      pureTraining: config.pureTraining,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to start Kokoro training');
  }

  return {
    ok: true,
    message: data.message || 'Kokoro training started',
  };
}

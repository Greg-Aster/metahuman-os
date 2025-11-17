export interface KokoroTrainingConfig {
  speakerId: string;
  langCode: string;
  baseVoice: string;
  epochs: number;
  learningRate: number;
  device: 'auto' | 'cpu' | 'cuda';
  maxSamples: number;
}

export function createDefaultKokoroConfig(): KokoroTrainingConfig {
  return {
    speakerId: 'default',
    langCode: 'a',
    baseVoice: 'af_heart',
    epochs: 120,
    learningRate: 0.0005,
    device: 'auto',
    maxSamples: 200,
  };
}

export async function startKokoroTrainingRequest(
  config: KokoroTrainingConfig
): Promise<{ ok: boolean; message: string }> {
  const response = await fetch('/api/kokoro-training', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'start-training',
      speakerId: config.speakerId,
      langCode: config.langCode,
      baseVoice: config.baseVoice,
      epochs: config.epochs,
      learningRate: config.learningRate,
      device: config.device,
      maxSamples: config.maxSamples,
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

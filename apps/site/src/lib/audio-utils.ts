/**
 * Audio Utilities
 * Shared utilities for voice recording and volume detection
 */

/**
 * Calculate volume level from voice frequencies (80-3000 Hz)
 *
 * This function focuses on the human voice frequency range instead of
 * averaging all frequencies, which prevents strong mic signals from
 * being diluted by thousands of silent high-frequency bins.
 *
 * @param analyser - The AnalyserNode to read frequency data from
 * @param boost - Volume boost multiplier (default: 150 = 150% boost)
 * @returns Volume level from 0-100
 */
export function calculateVoiceVolume(
  analyser: AnalyserNode,
  boost: number = 150
): number {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);

  // Human voice is concentrated in 80-3000 Hz range
  const sampleRate = 48000; // Typical browser sample rate
  const binSize = sampleRate / analyser.fftSize;
  const voiceStartBin = Math.floor(80 / binSize);   // ~80 Hz
  const voiceEndBin = Math.floor(3000 / binSize);   // ~3000 Hz

  // Calculate average volume from voice frequency range only
  let sum = 0;
  let count = 0;
  for (let i = voiceStartBin; i <= voiceEndBin && i < data.length; i++) {
    sum += data[i];
    count++;
  }

  const avg = count > 0 ? sum / count : 0;

  // Scale to 0-100 range with boost for better visibility
  return Math.min(100, (avg / 255) * boost);
}

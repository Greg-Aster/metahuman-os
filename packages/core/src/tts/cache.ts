/**
 * Shared TTS Cache Utilities
 * Used by all TTS providers for consistent caching
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { audit } from '../audit.js';
import type { CacheConfig } from './interface.js';

/**
 * Generate a cache key for text, model/provider, and speaking rate
 */
export function getCacheKey(text: string, identifier: string, speakingRate: number): string {
  const key = `${text}|${identifier}|${speakingRate}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Check if cached audio exists
 */
export function getCachedAudio(
  cacheConfig: CacheConfig,
  text: string,
  identifier: string,
  speakingRate: number
): Buffer | null {
  if (!cacheConfig.enabled) return null;

  const cacheKey = getCacheKey(text, identifier, speakingRate);
  const cachePath = path.join(cacheConfig.directory, `${cacheKey}.wav`);

  if (fs.existsSync(cachePath)) {
    audit({
      level: 'info',
      category: 'action',
      event: 'tts_cache_hit',
      details: { cacheKey, textLength: text.length, identifier, speakingRate },
      actor: 'system',
    });
    return fs.readFileSync(cachePath);
  }

  return null;
}

/**
 * Save audio to cache
 */
export function cacheAudio(
  cacheConfig: CacheConfig,
  text: string,
  identifier: string,
  speakingRate: number,
  audioBuffer: Buffer
): void {
  if (!cacheConfig.enabled) return;

  const cacheKey = getCacheKey(text, identifier, speakingRate);
  const cachePath = path.join(cacheConfig.directory, `${cacheKey}.wav`);

  // Ensure cache directory exists
  if (!fs.existsSync(cacheConfig.directory)) {
    fs.mkdirSync(cacheConfig.directory, { recursive: true });
  }

  fs.writeFileSync(cachePath, audioBuffer);

  audit({
    level: 'info',
    category: 'action',
    event: 'tts_cache_write',
    details: {
      cacheKey,
      textLength: text.length,
      audioSize: audioBuffer.length,
      identifier,
      speakingRate,
    },
    actor: 'system',
  });
}

/**
 * Get cache statistics
 */
export function getCacheStats(cacheConfig: CacheConfig): { size: number; files: number } {
  let cacheSize = 0;
  let cacheFiles = 0;

  if (cacheConfig.enabled && fs.existsSync(cacheConfig.directory)) {
    const files = fs.readdirSync(cacheConfig.directory).filter((f) => f.endsWith('.wav'));
    cacheFiles = files.length;

    for (const file of files) {
      const filePath = path.join(cacheConfig.directory, file);
      cacheSize += fs.statSync(filePath).size;
    }
  }

  return {
    size: Math.round((cacheSize / (1024 * 1024)) * 100) / 100, // MB
    files: cacheFiles,
  };
}

/**
 * Clear cache directory
 */
export function clearCache(cacheConfig: CacheConfig): number {
  if (!cacheConfig.enabled || !fs.existsSync(cacheConfig.directory)) {
    return 0;
  }

  const files = fs.readdirSync(cacheConfig.directory).filter((f) => f.endsWith('.wav'));

  for (const file of files) {
    fs.unlinkSync(path.join(cacheConfig.directory, file));
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'tts_cache_cleared',
    details: { filesDeleted: files.length },
    actor: 'system',
  });

  return files.length;
}

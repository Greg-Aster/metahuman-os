/**
 * LoRA State API Handlers
 *
 * Unified handlers for LoRA adapter state.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { listAdapterDatasets, getActiveAdapter } from '../../adapters.js';

/**
 * GET /api/lora-state - Get LoRA adapter state
 */
export async function handleGetLoraState(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    // Anonymous users get default values
    if (!user.isAuthenticated) {
      return successResponse({
        success: true,
        enabled: false,
        datasets: [],
        dualAvailable: false,
        dualEnabled: false,
      });
    }

    // Load LoRA enabled state from sleep.json
    let loraEnabled = false;
    try {
      const sleepPath = path.join(systemPaths.etc, 'sleep.json');
      if (fs.existsSync(sleepPath)) {
        const sleep = JSON.parse(fs.readFileSync(sleepPath, 'utf-8'));
        loraEnabled = !!(sleep?.adapters?.lora);
      }
    } catch (err) {
      console.warn('[lora-state] Failed to read sleep.json:', (err as Error).message);
    }

    // Get available adapter datasets
    const datasets = listAdapterDatasets();

    // Check for dual-adapter availability
    const historyMergedPath = path.join(
      systemPaths.out,
      'adapters',
      'history-merged',
      'adapter-merged.gguf'
    );
    const dualAvailable = fs.existsSync(historyMergedPath);

    // Get active adapter info to check if dual mode is enabled
    const activeAdapter = getActiveAdapter();
    const dualEnabled = activeAdapter?.dual || false;

    return successResponse({
      success: true,
      enabled: loraEnabled,
      datasets: datasets.map((d) => ({
        date: d.date,
        evalScore: d.evalScore,
        pairCount: d.pairCount,
      })),
      dualAvailable,
      dualEnabled,
    });
  } catch (error) {
    console.error('[lora-state] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

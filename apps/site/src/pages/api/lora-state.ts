import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import {
  listAdapterDatasets,
  getActiveAdapter,
  systemPaths,
  getUserOrAnonymous,
} from '@metahuman/core';

/**
 * GET /api/lora-state
 * Returns LoRA adapter state for SystemSettings component
 * - enabled: whether LoRA is currently enabled
 * - datasets: available adapter datasets
 * - dualAvailable: whether dual-adapter mode is available
 * - dualEnabled: whether dual mode is currently enabled
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);

    // Anonymous users get default values
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({
          success: true,
          enabled: false,
          datasets: [],
          dualAvailable: false,
          dualEnabled: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
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
    const historyMergedPath = path.join(systemPaths.out, 'adapters', 'history-merged', 'adapter-merged.gguf');
    const dualAvailable = fs.existsSync(historyMergedPath);

    // Get active adapter info to check if dual mode is enabled
    const activeAdapter = getActiveAdapter();
    const dualEnabled = activeAdapter?.dual || false;

    return new Response(
      JSON.stringify({
        success: true,
        enabled: loraEnabled,
        datasets: datasets.map(d => ({
          date: d.date,
          evalScore: d.evalScore,
          pairCount: d.pairCount,
        })),
        dualAvailable,
        dualEnabled,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[lora-state] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

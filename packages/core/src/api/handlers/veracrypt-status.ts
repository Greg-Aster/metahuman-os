/**
 * VeraCrypt Status API Handler
 *
 * GET VeraCrypt installation status.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports for optional veracrypt module
let checkVeraCrypt: (() => any) | null = null;
let getInstallInstructions: (() => any) | null = null;

async function ensureVeracryptModule(): Promise<boolean> {
  if (checkVeraCrypt) return true;
  try {
    const core = await import('../../index.js');
    checkVeraCrypt = core.checkVeraCrypt;
    getInstallInstructions = core.getInstallInstructions;
    return !!checkVeraCrypt;
  } catch {
    return false;
  }
}

/**
 * GET /api/veracrypt/status - Get VeraCrypt installation status
 */
export async function handleGetVeracryptStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureVeracryptModule();
    if (!available || !checkVeraCrypt) {
      return successResponse({
        installed: false,
        platform: 'unknown',
        error: 'VeraCrypt module not available',
      });
    }

    const status = checkVeraCrypt();

    return successResponse({
      ...status,
      installInstructions: status.installed ? undefined : (getInstallInstructions ? getInstallInstructions() : undefined),
    });
  } catch (error) {
    console.error('[veracrypt-status] GET failed:', error);
    return successResponse({
      installed: false,
      platform: 'unknown',
      error: (error as Error).message,
    });
  }
}

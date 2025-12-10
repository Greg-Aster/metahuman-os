/**
 * Cloudflare Tunnel API Handlers
 *
 * GET status, POST start/stop/toggle for Cloudflare tunnel.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports for optional cloudflare module
let tunnelFunctions: {
  getTunnelStatus?: () => any;
  startTunnel?: () => boolean;
  stopTunnel?: () => boolean;
  isCloudflaredInstalled?: () => boolean;
  saveCloudflareConfig?: (config: { enabled: boolean; autoStart: boolean }) => void;
} = {};

async function ensureCloudflareModule(): Promise<boolean> {
  if (Object.keys(tunnelFunctions).length > 0) return true;
  try {
    const cloudflareModule = await import('../../cloudflare-tunnel.js');
    tunnelFunctions = {
      getTunnelStatus: cloudflareModule.getTunnelStatus,
      startTunnel: cloudflareModule.startTunnel,
      stopTunnel: cloudflareModule.stopTunnel,
      isCloudflaredInstalled: cloudflareModule.isCloudflaredInstalled,
      saveCloudflareConfig: cloudflareModule.saveCloudflareConfig,
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/cloudflare/status - Get Cloudflare tunnel status
 */
export async function handleGetCloudflareStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureCloudflareModule();
    if (!available || !tunnelFunctions.getTunnelStatus) {
      return { status: 501, error: 'Cloudflare tunnel module not available' };
    }

    const status = tunnelFunctions.getTunnelStatus();

    return successResponse(status);
  } catch (error) {
    console.error('[cloudflare] GET status failed:', error);
    return { status: 500, error: 'Failed to get tunnel status' };
  }
}

/**
 * POST /api/cloudflare/start - Start Cloudflare tunnel
 */
export async function handleCloudflareStart(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureCloudflareModule();
    if (!available) {
      return { status: 501, error: 'Cloudflare tunnel module not available' };
    }

    if (tunnelFunctions.isCloudflaredInstalled && !tunnelFunctions.isCloudflaredInstalled()) {
      return { status: 400, error: 'cloudflared is not installed' };
    }

    if (!tunnelFunctions.startTunnel) {
      return { status: 501, error: 'startTunnel function not available' };
    }

    const success = tunnelFunctions.startTunnel();

    if (success) {
      return successResponse({ success: true, message: 'Tunnel started successfully' });
    } else {
      return { status: 500, error: 'Failed to start tunnel' };
    }
  } catch (error) {
    console.error('[cloudflare] POST start failed:', error);
    return { status: 500, error: 'Failed to start tunnel' };
  }
}

/**
 * POST /api/cloudflare/stop - Stop Cloudflare tunnel
 */
export async function handleCloudflareStop(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureCloudflareModule();
    if (!available || !tunnelFunctions.stopTunnel) {
      return { status: 501, error: 'Cloudflare tunnel module not available' };
    }

    const success = tunnelFunctions.stopTunnel();

    if (success) {
      return successResponse({ success: true, message: 'Tunnel stopped successfully' });
    } else {
      return { status: 500, error: 'Failed to stop tunnel' };
    }
  } catch (error) {
    console.error('[cloudflare] POST stop failed:', error);
    return { status: 500, error: 'Failed to stop tunnel' };
  }
}

/**
 * POST /api/cloudflare/toggle - Toggle tunnel auto-start config
 */
export async function handleCloudflareToggle(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { body } = req;
    const enabled = body?.enabled;

    if (typeof enabled !== 'boolean') {
      return { status: 400, error: 'Invalid request: enabled must be a boolean' };
    }

    const available = await ensureCloudflareModule();
    if (!available || !tunnelFunctions.saveCloudflareConfig) {
      return { status: 501, error: 'Cloudflare tunnel module not available' };
    }

    tunnelFunctions.saveCloudflareConfig({ enabled, autoStart: enabled });

    return successResponse({ success: true, enabled });
  } catch (error) {
    console.error('[cloudflare] POST toggle failed:', error);
    return { status: 500, error: 'Failed to toggle tunnel configuration' };
  }
}

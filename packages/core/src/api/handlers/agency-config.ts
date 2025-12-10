/**
 * Agency Config API Handlers
 *
 * Unified handlers for agency system configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { audit } from '../../audit.js';
import { loadConfig } from '../../agency/config.js';
import { saveAgencyConfig } from '../../agency/storage.js';
import type { AgencyConfig } from '../../agency/types.js';

/**
 * GET /api/agency/config - Get agency configuration
 */
export async function handleGetAgencyConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return {
        status: 401,
        error: 'Authentication required to view agency config.',
      };
    }

    const config = await loadConfig(user.username);

    return successResponse({ config });
  } catch (error) {
    console.error('[agency-config] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * PUT /api/agency/config - Update agency configuration (owner only)
 * Body: Partial<AgencyConfig>
 */
export async function handleSetAgencyConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return {
        status: 401,
        error: 'Authentication required to update agency config.',
      };
    }

    // Owner check is handled by router guard, but double-check here
    if (user.role !== 'owner') {
      return {
        status: 403,
        error: 'Owner role required to update agency config.',
      };
    }

    const updates = (body || {}) as Partial<AgencyConfig>;

    // Load current config
    const currentConfig = await loadConfig(user.username);

    // Merge with updates (deep merge for nested objects)
    const updatedConfig: AgencyConfig = {
      ...currentConfig,
      ...updates,
      // Deep merge specific sections
      thresholds: {
        ...currentConfig.thresholds,
        ...(updates.thresholds || {}),
        decay: {
          ...currentConfig.thresholds.decay,
          ...(updates.thresholds?.decay || {}),
        },
      },
      sources: {
        ...currentConfig.sources,
        ...(updates.sources || {}),
      },
      scheduling: {
        ...currentConfig.scheduling,
        ...(updates.scheduling || {}),
      },
      riskPolicy: {
        ...currentConfig.riskPolicy,
        ...(updates.riskPolicy || {}),
      },
    };

    // Save user overrides
    await saveAgencyConfig(updatedConfig, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'agency_config_updated',
      actor: user.username,
      details: {
        updates: Object.keys(updates),
      },
    });

    return successResponse({
      config: updatedConfig,
      success: true,
    });
  } catch (error) {
    console.error('[agency-config] PUT error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

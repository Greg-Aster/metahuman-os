/**
 * Persona Facets Manage API Handlers
 *
 * GET/POST complete facets.json for facets editing.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  loadPersonaFacetConfig,
  PersonaFacetConfigurationError,
  savePersonaFacetConfig,
} from '../../persona-facets.js';

const DEFAULT_FACETS = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  version: "0.2.0",
  lastUpdated: new Date().toISOString(),
  activeFacet: "default",
  description: "Persona facets configuration",
  facets: {
    default: {
      name: "Default",
      description: "Default persona",
      personaFile: "core.json",
      enabled: true,
      color: "violet",
      usageHints: []
    }
  }
};

/**
 * GET /api/persona-facets-manage - Get complete facets.json
 */
export async function handleGetPersonaFacetsManage(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    // Anonymous users see default structure
    if (!user.isAuthenticated) {
      return successResponse({
        success: true,
        facets: { ...DEFAULT_FACETS, lastUpdated: new Date().toISOString() }
      });
    }

    const facetsData = loadPersonaFacetConfig(user.username);

    return successResponse({
      success: true,
      facets: facetsData
    });
  } catch (error) {
    console.error('[persona-facets-manage] GET error:', error);
    return {
      status: error instanceof PersonaFacetConfigurationError ? 409 : 500,
      error: error instanceof PersonaFacetConfigurationError
        ? error.message
        : 'Failed to load facets configuration',
    };
  }
}

/**
 * POST /api/persona-facets-manage - Update complete facets.json
 */
export async function handleUpdatePersonaFacetsManage(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const { facets } = body || {};

    if (!facets || typeof facets !== 'object') {
      return { status: 400, error: 'Invalid facets data' };
    }

    savePersonaFacetConfig(user.username, facets, user.username);

    return successResponse({
      success: true,
      message: 'Facets configuration saved successfully'
    });
  } catch (error) {
    console.error('[persona-facets-manage] POST error:', error);
    return {
      status: error instanceof PersonaFacetConfigurationError ? 400 : 500,
      error: error instanceof PersonaFacetConfigurationError
        ? error.message
        : 'Failed to save facets configuration',
    };
  }
}

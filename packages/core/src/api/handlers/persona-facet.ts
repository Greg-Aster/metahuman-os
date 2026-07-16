/**
 * Persona Facet API Handlers
 *
 * GET/POST for managing persona facets (alternate persona modes).
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  loadPersonaFacetConfig,
  PersonaFacetConfigurationError,
  personaFacetResolvedPath,
  setActivePersonaFacet,
} from '../../persona-facets.js';

const INACTIVE_FACET = {
  name: 'Persona Off',
  description: 'Disable persona context and use the raw model behavior',
  personaFile: null,
  enabled: true,
  color: 'gray',
};

/**
 * GET /api/persona-facet - Get active facet and available facets
 */
export async function handleGetPersonaFacet(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return successResponse({
        activeFacet: 'default',
        facets: { inactive: { ...INACTIVE_FACET, resolvedPath: null } },
      });
    }

    const facetsData = loadPersonaFacetConfig(user.username);

    return successResponse({
      success: true,
      activeFacet: facetsData.activeFacet,
      facets: Object.fromEntries(Object.entries(facetsData.facets).map(([id, facet]) => [id, {
        ...facet,
        resolvedPath: personaFacetResolvedPath(user.username, facet),
      }])),
    });
  } catch (error) {
    console.error('[persona-facet] GET error:', error);
    return {
      status: error instanceof PersonaFacetConfigurationError ? 409 : 500,
      error: error instanceof PersonaFacetConfigurationError
        ? error.message
        : 'Failed to load facets',
    };
  }
}

/**
 * POST /api/persona-facet - Switch active facet
 */
export async function handleSetPersonaFacet(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const { facet } = body || {};

    if (!facet || typeof facet !== 'string') {
      return {
        status: 400,
        error: 'Invalid facet name',
      };
    }

    const result = setActivePersonaFacet(user.username, facet, user.username, 'Persona UI selection');

    return successResponse({
      success: true,
      activeFacet: result.activeFacet,
      facetName: result.facet.name,
      message: `Switched to ${result.facet.name} facet`,
    });
  } catch (error) {
    console.error('[persona-facet] POST error:', error);
    return {
      status: error instanceof PersonaFacetConfigurationError ? 409 : 500,
      error: error instanceof PersonaFacetConfigurationError
        ? error.message
        : 'Failed to switch facet',
    };
  }
}

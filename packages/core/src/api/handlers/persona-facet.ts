/**
 * Persona Facet API Handlers
 *
 * GET/POST for managing persona facets (alternate persona modes).
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { getProfilePaths } from '../../paths.js';
import { audit } from '../../audit.js';

const INACTIVE_FACET = {
  name: 'Persona Off',
  description: 'Disable persona context and use the raw model behavior',
  personaFile: null,
  enabled: true,
  color: 'gray',
};

function buildFacetResponse(
  facetsPath: string,
  facets: Record<string, any>
): Record<string, any> {
  const personasDir = path.dirname(facetsPath);
  const augmented = { ...facets };
  if (!augmented.inactive) {
    augmented.inactive = { ...INACTIVE_FACET };
  }

  return Object.fromEntries(
    Object.entries(augmented).map(([key, config]) => {
      const personaFile = config.personaFile ?? null;
      const resolvedPath =
        personaFile && typeof personaFile === 'string'
          ? path.join(personasDir, personaFile)
          : null;

      return [
        key,
        {
          ...config,
          personaFile,
          resolvedPath,
        },
      ];
    })
  );
}

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

    const profilePaths = getProfilePaths(user.username);
    const facetsPath = profilePaths.personaFacets;

    if (!fs.existsSync(facetsPath)) {
      return successResponse({
        activeFacet: 'default',
        facets: buildFacetResponse(facetsPath, {}),
      });
    }

    const facetsData = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
    if (!facetsData.facets) {
      facetsData.facets = {};
    }

    return successResponse({
      activeFacet: facetsData.activeFacet || 'default',
      facets: buildFacetResponse(facetsPath, facetsData.facets),
    });
  } catch (error) {
    console.error('[persona-facet] GET error:', error);
    return {
      status: 500,
      error: 'Failed to load facets',
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

    const profilePaths = getProfilePaths(user.username);
    const facetsPath = profilePaths.personaFacets;

    // Load current facets config
    if (!fs.existsSync(facetsPath)) {
      return {
        status: 404,
        error: 'Facets configuration not found',
      };
    }

    const facetsData = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
    facetsData.facets = facetsData.facets || {};
    if (!facetsData.facets.inactive) {
      facetsData.facets.inactive = { ...INACTIVE_FACET };
    }

    // Validate facet exists and is enabled
    if (!facetsData.facets[facet]) {
      return {
        status: 404,
        error: `Facet "${facet}" not found`,
      };
    }

    if (!facetsData.facets[facet].enabled) {
      return {
        status: 400,
        error: `Facet "${facet}" is disabled`,
      };
    }

    // Update active facet
    const previousFacet = facetsData.activeFacet;
    facetsData.activeFacet = facet;
    facetsData.lastUpdated = new Date().toISOString();

    // Write updated config
    fs.mkdirSync(path.dirname(facetsPath), { recursive: true });
    fs.writeFileSync(facetsPath, JSON.stringify(facetsData, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'system',
      event: 'persona_facet_changed',
      details: {
        previousFacet,
        newFacet: facet,
        facetName: facetsData.facets[facet].name,
        facetDescription: facetsData.facets[facet].description,
      },
      actor: user.username,
    });

    return successResponse({
      success: true,
      activeFacet: facet,
      facetName: facetsData.facets[facet].name,
      message: `Switched to ${facetsData.facets[facet].name} facet`,
    });
  } catch (error) {
    console.error('[persona-facet] POST error:', error);
    return {
      status: 500,
      error: 'Failed to switch facet',
    };
  }
}

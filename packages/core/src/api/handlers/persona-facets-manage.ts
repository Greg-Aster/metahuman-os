/**
 * Persona Facets Manage API Handlers
 *
 * GET/POST complete facets.json for facets editing.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { getProfilePaths } from '../../paths.js';
import { audit } from '../../audit.js';

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

    const profilePaths = getProfilePaths(user.username);
    const facetsPath = profilePaths.personaFacets;

    if (!existsSync(facetsPath)) {
      // File doesn't exist - return default structure
      return successResponse({
        success: true,
        facets: { ...DEFAULT_FACETS, lastUpdated: new Date().toISOString() }
      });
    }

    const facetsData = JSON.parse(await fs.readFile(facetsPath, 'utf-8'));

    return successResponse({
      success: true,
      facets: facetsData
    });
  } catch (error) {
    console.error('[persona-facets-manage] GET error:', error);
    return { status: 500, error: 'Failed to load facets configuration' };
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

    const profilePaths = getProfilePaths(user.username);
    const facetsPath = profilePaths.personaFacets;

    // Update lastUpdated timestamp
    const updatedFacets = {
      ...facets,
      lastUpdated: new Date().toISOString()
    };

    // Ensure directory exists and write
    await fs.mkdir(profilePaths.persona, { recursive: true });
    await fs.writeFile(facetsPath, JSON.stringify(updatedFacets, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'data_change',
      event: 'persona_facets_updated',
      details: {
        activeFacet: updatedFacets.activeFacet,
        facetCount: Object.keys(updatedFacets.facets || {}).length,
      },
      actor: user.username,
    });

    return successResponse({
      success: true,
      message: 'Facets configuration saved successfully'
    });
  } catch (error) {
    console.error('[persona-facets-manage] POST error:', error);
    return { status: 500, error: 'Failed to save facets configuration' };
  }
}

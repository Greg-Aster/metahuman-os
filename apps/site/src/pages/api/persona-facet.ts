/**
 * API endpoint to get/set active persona facet
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core/paths';
import { audit } from '@metahuman/core/audit';
import { withUserContext } from '../../middleware/userContext';

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

const getHandler: APIRoute = async () => {
  try {
    // Use context-aware paths.personaFacets which resolves to user profile
    // For anonymous users without a profile, return default
    let facetsPath: string;
    try {
      facetsPath = paths.personaFacets;
    } catch (error) {
      // Anonymous user without profile - return default
      return new Response(
        JSON.stringify({
          activeFacet: 'default',
          facets: { inactive: { ...INACTIVE_FACET, resolvedPath: null } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!fs.existsSync(facetsPath)) {
      return new Response(
        JSON.stringify({
          activeFacet: 'default',
          facets: buildFacetResponse(facetsPath, {}),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const facetsData = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
    if (!facetsData.facets) {
      facetsData.facets = {};
    }

    return new Response(
      JSON.stringify({
        activeFacet: facetsData.activeFacet || 'default',
        facets: buildFacetResponse(facetsPath, facetsData.facets),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[persona-facet] GET error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load facets' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

const postHandler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { facet } = body;

    if (!facet || typeof facet !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid facet name' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Use context-aware paths.personaFacets which resolves to user profile
    // For anonymous users, deny write access
    let facetsPath: string;
    try {
      facetsPath = paths.personaFacets;
    } catch (error) {
      // Anonymous user without profile - deny write
      return new Response(
        JSON.stringify({ error: 'Authentication required to change facets' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load current facets config
    if (!fs.existsSync(facetsPath)) {
      return new Response(
        JSON.stringify({ error: 'Facets configuration not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const facetsData = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
    facetsData.facets = facetsData.facets || {};
    if (!facetsData.facets.inactive) {
      facetsData.facets.inactive = { ...INACTIVE_FACET };
    }

    // Validate facet exists and is enabled
    if (!facetsData.facets[facet]) {
      return new Response(
        JSON.stringify({ error: `Facet "${facet}" not found` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!facetsData.facets[facet].enabled) {
      return new Response(
        JSON.stringify({ error: `Facet "${facet}" is disabled` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update active facet
    const previousFacet = facetsData.activeFacet;
    facetsData.activeFacet = facet;
    facetsData.lastUpdated = new Date().toISOString();

    // Write updated config
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
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({
        success: true,
        activeFacet: facet,
        facetName: facetsData.facets[facet].name,
        message: `Switched to ${facetsData.facets[facet].name} facet`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[persona-facet] POST error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to switch facet' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Wrap with user context middleware for automatic profile path resolution
export const GET = withUserContext(getHandler);
export const POST = withUserContext(postHandler);

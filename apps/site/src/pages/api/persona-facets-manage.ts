/**
 * API endpoint to read and write the complete facets.json file
 * This allows editing the entire facets configuration, not just switching active facet
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import { tryResolveProfilePath } from '@metahuman/core/paths';
import { audit } from '@metahuman/core/audit';
import { withUserContext } from '../../middleware/userContext';

const getHandler: APIRoute = async () => {
  try {
    // Use safe path resolution
    const result = tryResolveProfilePath('personaFacets');

    if (!result.ok) {
      // Anonymous user - return default structure
      return new Response(
        JSON.stringify({
          success: true,
          facets: {
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
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const facetsPath = result.path;

    if (!fs.existsSync(facetsPath)) {
      // File doesn't exist - return default structure
      return new Response(
        JSON.stringify({
          success: true,
          facets: {
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
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const facetsData = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));

    return new Response(
      JSON.stringify({
        success: true,
        facets: facetsData
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[persona-facets-manage] GET error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to load facets configuration' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

const postHandler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { facets } = body;

    if (!facets || typeof facets !== 'object') {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid facets data' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Use safe path resolution - require authentication for writes
    const result = tryResolveProfilePath('personaFacets');

    if (!result.ok) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required to save facets' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const facetsPath = result.path;

    // Update lastUpdated timestamp
    const updatedFacets = {
      ...facets,
      lastUpdated: new Date().toISOString()
    };

    // Write the updated facets
    fs.writeFileSync(facetsPath, JSON.stringify(updatedFacets, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'data_change',
      event: 'persona_facets_updated',
      details: {
        activeFacet: updatedFacets.activeFacet,
        facetCount: Object.keys(updatedFacets.facets || {}).length,
      },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Facets configuration saved successfully'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[persona-facets-manage] POST error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to save facets configuration' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Wrap with user context middleware for automatic profile path resolution
export const GET = withUserContext(getHandler);
export const POST = withUserContext(postHandler);

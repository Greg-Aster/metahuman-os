/**
 * API endpoint to get/set active persona facet
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core/paths';
import { audit } from '@metahuman/core/audit';

const facetsPath = path.join(paths.persona, 'facets.json');

export const GET: APIRoute = async () => {
  try {
    if (!fs.existsSync(facetsPath)) {
      return new Response(
        JSON.stringify({ activeFacet: 'default', facets: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const facetsData = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));

    return new Response(
      JSON.stringify({
        activeFacet: facetsData.activeFacet || 'default',
        facets: facetsData.facets || {},
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { facet } = body;

    if (!facet || typeof facet !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid facet name' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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

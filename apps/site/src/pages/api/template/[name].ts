/**
 * API endpoint for fetching graph templates
 * Supports hot-reload by returning the latest version of a template
 */

import type { APIRoute } from 'astro';
import { getTemplate } from '../../../lib/client/visual-editor/template-loader';
import { validateGraph } from '@metahuman/core/graph-error-handler';

/**
 * GET /api/template/:name
 * Returns the latest version of a graph template with validation
 */
export const GET: APIRoute = async ({ params, url }) => {
  const { name } = params;
  const skipValidation = url.searchParams.get('skipValidation') === 'true';

  if (!name) {
    return new Response(
      JSON.stringify({ error: 'Template name required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const template = await getTemplate(name);

    if (!template) {
      return new Response(
        JSON.stringify({ error: `Template '${name}' not found` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate template structure
    let validation = { valid: true, errors: [] as string[] };
    if (!skipValidation) {
      validation = validateGraph(template);

      if (!validation.valid) {
        console.warn(`[API] Template ${name} has validation errors:`, validation.errors);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        template,
        validation,
        timestamp: Date.now(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error(`[API] Error loading template ${name}:`, error);
    return new Response(
      JSON.stringify({
        error: 'Failed to load template',
        details: (error as Error).message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

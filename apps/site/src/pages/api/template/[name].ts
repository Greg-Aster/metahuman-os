/**
 * API endpoint for fetching graph templates
 * Supports hot-reload by returning the latest version of a template
 */

import type { APIRoute } from 'astro';
import fs from 'fs';
import path from 'path';
import { systemPaths } from '@metahuman/core';

/**
 * GET /api/template/:name
 * Returns the latest version of a graph template
 */
export const GET: APIRoute = async ({ params }) => {
  const { name } = params;

  if (!name) {
    return new Response(
      JSON.stringify({ error: 'Template name required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Look for template in cognitive-graphs directory
    const templatePath = path.join(systemPaths.root, 'etc', 'cognitive-graphs', `${name}.json`);

    if (!fs.existsSync(templatePath)) {
      return new Response(
        JSON.stringify({ error: `Template '${name}' not found` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const content = fs.readFileSync(templatePath, 'utf-8');
    const template = JSON.parse(content);

    return new Response(
      JSON.stringify({
        success: true,
        template,
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

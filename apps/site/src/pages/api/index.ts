/**
 * Vector Index API
 * Handles semantic search index operations (status, build, query)
 */

import type { APIRoute } from 'astro';
import { getIndexStatus, buildMemoryIndex } from '@metahuman/core/vector-index';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { audit } from '@metahuman/core/audit';

/**
 * GET - Get index status
 */
export const GET: APIRoute = async (context) => {
  try {
    // Require authentication to access index info
    const policy = getSecurityPolicy(context);
    if (!policy.canReadMemory()) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to access index' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const status = await getIndexStatus();

    return new Response(
      JSON.stringify(status),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[api/index] GET error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST - Build or rebuild index
 */
export const POST: APIRoute = async (context) => {
  try {
    // Require authentication to build index
    const policy = getSecurityPolicy(context);
    if (!policy.canWriteMemory()) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to build index' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json();
    const { action } = body;

    if (action !== 'build') {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use action: "build"' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build the index
    console.log('[api/index] Starting index build...');
    const result = await buildMemoryIndex();

    audit({
      level: 'info',
      category: 'action',
      event: 'index_built',
      details: {
        items: result.items,
        model: result.model,
        provider: result.provider
      },
      actor: 'web_ui'
    });

    // Get updated status
    const status = await getIndexStatus();

    return new Response(
      JSON.stringify({
        success: true,
        message: `Index built with ${result.items} items`,
        status
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[api/index] POST error:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'index_build_error',
      details: { error: (error as Error).message },
      actor: 'web_ui'
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

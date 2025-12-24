/**
 * Active Operator Configuration API
 *
 * GET: Load current active operator config
 * POST: Update active operator config
 */

import type { APIRoute } from 'astro';
import {
  loadActiveOperatorConfig,
  saveActiveOperatorConfig,
  updateActiveOperatorConfig,
} from '@metahuman/core/active-operator';
import { getAuthenticatedUser } from '@metahuman/core';

export const GET: APIRoute = async () => {
  try {
    // System-level config - no auth required to read
    const config = loadActiveOperatorConfig();

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[active-operator/config] GET error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    // Require authentication for config changes
    const user = getAuthenticatedUser(cookies);

    // Only owner can change config
    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Only owner can modify active operator config' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();

    // If full config provided, save it
    if (body.enabled !== undefined && body.enabledTaskTypes !== undefined) {
      saveActiveOperatorConfig(body);
    } else {
      // Otherwise, merge with existing
      updateActiveOperatorConfig(body);
    }

    const updatedConfig = loadActiveOperatorConfig();

    return new Response(JSON.stringify(updatedConfig), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[active-operator/config] POST error:', error);

    if ((error as Error).message.includes('Not authenticated')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

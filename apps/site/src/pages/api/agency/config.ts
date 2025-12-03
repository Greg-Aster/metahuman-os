import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getUserOrAnonymous, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadConfig, saveAgencyConfig, type AgencyConfig } from '@metahuman/core';

/**
 * GET /api/agency/config
 * Returns agency configuration
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view agency config.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const config = await loadConfig(user.username);

    return new Response(JSON.stringify({ config }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * PUT /api/agency/config
 * Update agency configuration (user overrides)
 * Body: Partial AgencyConfig
 */
export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to update agency config.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role for config changes
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Owner role required to update agency config.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json() as Partial<AgencyConfig>;

    // Load current config
    const currentConfig = await loadConfig(user.username);

    // Merge with updates
    const updatedConfig: AgencyConfig = {
      ...currentConfig,
      ...body,
      // Deep merge specific sections
      thresholds: {
        ...currentConfig.thresholds,
        ...(body.thresholds || {}),
        decay: {
          ...currentConfig.thresholds.decay,
          ...(body.thresholds?.decay || {}),
        },
      },
      sources: {
        ...currentConfig.sources,
        ...(body.sources || {}),
      },
      scheduling: {
        ...currentConfig.scheduling,
        ...(body.scheduling || {}),
      },
      riskPolicy: {
        ...currentConfig.riskPolicy,
        ...(body.riskPolicy || {}),
      },
    };

    // Save user overrides
    await saveAgencyConfig(updatedConfig, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'agency_config_updated',
      actor: user.username,
      details: {
        updates: Object.keys(body),
      },
    });

    return new Response(JSON.stringify({ config: updatedConfig, success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

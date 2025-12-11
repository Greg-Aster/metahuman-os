import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import {
  getNodePipelineEnvOverride,
  readNodePipelineRuntime,
  writeNodePipelineRuntime,
} from '../../utils/node-pipeline';

function buildResponseBody() {
  const envOverride = getNodePipelineEnvOverride();
  if (envOverride) {
    return {
      enabled: envOverride.value,
      locked: true,
      source: envOverride.source,
    };
  }
  return {
    enabled: readNodePipelineRuntime(),
    locked: false,
    source: 'runtime',
  };
}

const getHandler: APIRoute = async ({ cookies }) => {
  return new Response(JSON.stringify(buildResponseBody()), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const postHandler: APIRoute = async ({ cookies, request }) => {
  const envOverride = getNodePipelineEnvOverride();
  if (envOverride) {
    return new Response(
      JSON.stringify({
        error: 'Node pipeline is locked by environment configuration',
        ...buildResponseBody(),
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const user = getAuthenticatedUser(cookies);
  if (user.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let enabled: boolean;
  try {
    const body = await request.json();
    if (typeof body?.enabled !== 'boolean') {
      throw new Error('enabled must be boolean');
    }
    enabled = body.enabled;
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: `Invalid request: ${(error as Error).message}`,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  writeNodePipelineRuntime(enabled, user.username || 'owner');

  return new Response(
    JSON.stringify({
      enabled,
      locked: false,
      source: 'runtime',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
export const GET = getHandler;
export const POST = postHandler;

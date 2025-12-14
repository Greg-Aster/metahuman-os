/**
 * API Endpoint: GET /api/update-state
 *
 * Reads the update state file written by the update-check agent.
 * Returns the latest update check results.
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';

export const GET: APIRoute = async () => {
  try {
    const statePath = path.join(systemPaths.root, 'logs', 'run', 'update-state.json');

    if (!fs.existsSync(statePath)) {
      return new Response(JSON.stringify({
        updateAvailable: false,
        currentVersion: 'unknown',
        latestVersion: null,
        checkedAt: null,
        reason: 'No update check has been performed yet',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

    return new Response(JSON.stringify(state), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to read update state',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

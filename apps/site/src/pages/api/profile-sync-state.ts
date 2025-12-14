/**
 * API Endpoint: GET /api/profile-sync-state
 *
 * Reads the profile sync state file written by the profile-sync agent.
 * Returns the current sync progress or final results.
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';

export const GET: APIRoute = async () => {
  try {
    const statePath = path.join(systemPaths.root, 'logs', 'run', 'profile-sync-state.json');

    if (!fs.existsSync(statePath)) {
      return new Response(JSON.stringify({
        phase: 'idle',
        message: 'No sync in progress',
        profileFiles: 0,
        memoriesImported: 0,
        credentialsSynced: false,
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
      error: error instanceof Error ? error.message : 'Failed to read sync state',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * Server Update API - GET, POST /api/server-update
 *
 * Astro adapter - ONE LINE to call unified handler.
 * GET: Check for available updates (git fetch + compare)
 * POST: Perform update (git pull)
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
export const POST = astroHandler;

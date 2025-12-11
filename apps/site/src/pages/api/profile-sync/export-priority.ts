/**
 * Priority Profile Export API - GET/POST /api/profile-sync/export-priority
 *
 * Astro adapter - ONE LINE to call unified handler.
 * Returns essential profile files only (persona, config, conversation buffer).
 * Avoids mobile OOM crashes by excluding large memory/training data.
 *
 * GET: Cookie-based auth (same-origin)
 * POST: Credentials in body (cross-origin mobile sync)
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
export const POST = astroHandler;
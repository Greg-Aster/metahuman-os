/**
 * Priority Profile Export API - GET /api/profile-sync/export-priority
 *
 * Astro adapter - ONE LINE to call unified handler.
 * Returns essential profile files only (persona, config, conversation buffer).
 * Avoids mobile OOM crashes by excluding large memory/training data.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
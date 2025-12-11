/**
 * System Coder API - List Fixes
 * GET /api/system-coder/fixes
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;

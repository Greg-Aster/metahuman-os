/**
 * System Coder API - Get/Update Request
 * GET/PUT /api/system-coder/requests/{id}
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
export const PUT = astroHandler;

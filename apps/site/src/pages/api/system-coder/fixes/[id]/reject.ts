/**
 * System Coder API - Reject Fix
 * POST /api/system-coder/fixes/{id}/reject
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const POST = astroHandler;

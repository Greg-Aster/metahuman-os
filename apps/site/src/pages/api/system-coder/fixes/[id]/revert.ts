/**
 * System Coder API - Revert Fix
 * POST /api/system-coder/fixes/{id}/revert
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const POST = astroHandler;

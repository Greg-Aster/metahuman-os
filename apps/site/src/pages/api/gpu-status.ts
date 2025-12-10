/**
 * GPU Status API - GET /api/gpu-status
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;

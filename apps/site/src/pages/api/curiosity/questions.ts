/**
 * Curiosity Questions API - GET /api/curiosity/questions
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 *
 * DEPRECATED: Questions now flow through conversation stream via SSE
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;

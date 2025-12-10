/**
 * Tasks API - GET, POST, PATCH /api/tasks
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
export const POST = astroHandler;
export const PATCH = astroHandler;

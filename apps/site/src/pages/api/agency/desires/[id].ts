/**
 * Agency Desire by ID - GET/PUT/DELETE /api/agency/desires/:id
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
export const PUT = astroHandler;
export const DELETE = astroHandler;

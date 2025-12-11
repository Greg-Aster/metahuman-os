/**
 * Chat API - POST/DELETE /api/chat
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const POST = astroHandler;
export const DELETE = astroHandler;

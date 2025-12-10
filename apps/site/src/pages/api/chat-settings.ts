/**
 * Chat Settings API - GET/PUT/POST /api/chat-settings
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
export const PUT = astroHandler;
export const POST = astroHandler;

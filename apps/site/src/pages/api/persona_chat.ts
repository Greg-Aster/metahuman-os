/**
 * Persona Chat API - GET/POST/DELETE /api/persona_chat
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 *
 * Full cognitive graph pipeline with SSE streaming.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
export const POST = astroHandler;
export const DELETE = astroHandler;

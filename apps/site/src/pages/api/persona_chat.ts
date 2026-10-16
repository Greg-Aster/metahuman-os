/**
 * Persona chat history - DELETE /api/persona_chat.
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 *
 * Conversation submissions use /api/unified-queue.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const DELETE = astroHandler;

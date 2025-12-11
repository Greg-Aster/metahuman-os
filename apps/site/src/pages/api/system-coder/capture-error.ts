/**
 * System Coder API - Capture Error
 * POST /api/system-coder/capture-error
 *
 * Astro adapter - ONE LINE to call unified handler.
 * All business logic is in @metahuman/core (same as mobile).
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const POST = astroHandler;

/**
 * Server Restart API - POST /api/server-update/restart
 *
 * Astro adapter - ONE LINE to call unified handler.
 * Triggers server restart after update.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const POST = astroHandler;

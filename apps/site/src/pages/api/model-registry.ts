/**
 * Model Registry API
 *
 * This is a thin adapter that routes to unified handlers.
 * SAME code path as mobile - both use handleHttpRequest().
 */

import { astroHandler } from '@metahuman/core/api/adapters/astro';

// All methods route through unified handler
export const GET = astroHandler;
export const POST = astroHandler;
export const PUT = astroHandler;

/**
 * Status API - System Status
 *
 * ONE LINE - calls unified handler via astroHandler.
 * SAME business logic as mobile.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';
export const GET = astroHandler;

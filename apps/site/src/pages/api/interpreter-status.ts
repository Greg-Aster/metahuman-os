/**
 * Open Interpreter Status API
 *
 * GET /api/interpreter-status - Get interpreter server status
 * POST /api/interpreter-status - Control interpreter (start/stop/restart/configure)
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
export const POST = astroHandler;

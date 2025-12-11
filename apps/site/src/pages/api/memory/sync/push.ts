/**
 * Memory Sync Push API
 *
 * Receives memories from mobile/offline clients and saves them to the server.
 * Handles both new memories (POST) and updates (PUT).
 *
 * MIGRATED: Uses unified handler from @metahuman/core
 */

import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const POST = astroHandler;
export const PUT = astroHandler;

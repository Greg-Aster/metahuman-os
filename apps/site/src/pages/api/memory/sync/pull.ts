/**
 * Memory Sync Pull API
 *
 * Returns memories modified since a given timestamp for client sync.
 * Supports incremental sync to minimize data transfer.
 *
 * MIGRATED: Uses unified handler from @metahuman/core
 */

import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;

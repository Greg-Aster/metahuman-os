/**
 * Addons Uninstall API
 * POST /api/addons/uninstall - Uninstall an addon
 *
 * MIGRATED: Uses unified handler via astroHandler
 */

import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const POST = astroHandler;

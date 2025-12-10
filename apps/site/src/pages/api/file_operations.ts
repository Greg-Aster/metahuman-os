/**
 * File Operations API
 * GET /api/file_operations - Get file operations status
 * POST /api/file_operations - Execute file operation
 *
 * MIGRATED: Uses unified handler via astroHandler
 */

import { astroHandler } from '@metahuman/core/api';

export const GET = astroHandler;
export const POST = astroHandler;

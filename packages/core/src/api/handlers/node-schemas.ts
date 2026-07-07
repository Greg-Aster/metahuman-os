/**
 * Node Schemas API Handlers
 *
 * GET node schemas for the cognitive graph system.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * Schemas are extracted from the executable node registry so node files remain
 * the single source of truth for defaults, editable properties, slots, and
 * aliases.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

import {
  getNodeSchema as getSchemaById,
  getAllSchemas,
} from '../../nodes/index.js';

/**
 * GET /api/node-schemas - Get node schemas
 * Query params:
 *   - id: string (optional) - Get single schema by ID
 *   - category: string (optional) - Get schemas by category
 */
export async function handleGetNodeSchemas(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { id, category } = req.query || {};

    if (id) {
      // Get single schema by ID
      const schema = getSchemaById(id);
      if (!schema) {
        return { status: 404, error: `Node schema not found: ${id}` };
      }
      return successResponse(schema);
    }

    if (category) {
      // Get schemas by category - filter from full list
      const nodeSchemas = getAllSchemas();
      const schemas = nodeSchemas.filter(s => s.category === category);
      return successResponse(schemas);
    }

    return successResponse(getAllSchemas());
  } catch (error) {
    console.error('[node-schemas API] Error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

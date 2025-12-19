/**
 * Node Schemas API Handlers
 *
 * GET node schemas for the cognitive graph system.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * NOTE: Uses static schemas from schemas.ts (browser-safe definitions)
 * NOT the node definitions from nodes/index.ts (which may have different input/output names)
 * This ensures templates and visual editor match the schema definitions.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Import from static browser-safe schemas (NOT node definitions)
// This ensures API returns schemas that match the template definitions
import {
  nodeSchemas,
  getNodeSchema as getSchemaById,
  getNodesByCategory as getSchemasByCategory,
} from '../../nodes/schemas.js';

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
      const schemas = nodeSchemas.filter(s => s.category === category);
      return successResponse(schemas);
    }

    // Get all schemas - return the full static array
    return successResponse(nodeSchemas);
  } catch (error) {
    console.error('[node-schemas API] Error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

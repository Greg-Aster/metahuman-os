/**
 * Node Schemas API Handlers
 *
 * GET node schemas for the cognitive graph system.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports for node schema functions
let getAllSchemas: any;
let getNodeSchema: any;
let getNodesByCategory: any;

async function ensureSchemaFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    getAllSchemas = core.getAllSchemas;
    getNodeSchema = core.getNodeSchema;
    getNodesByCategory = core.getNodesByCategory;
    return !!(getAllSchemas && getNodeSchema && getNodesByCategory);
  } catch {
    return false;
  }
}

/**
 * GET /api/node-schemas - Get node schemas
 * Query params:
 *   - id: string (optional) - Get single schema by ID
 *   - category: string (optional) - Get schemas by category
 */
export async function handleGetNodeSchemas(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureSchemaFunctions();
    if (!available) {
      return { status: 501, error: 'Node schemas not available' };
    }

    const { id, category } = req.query || {};

    if (id) {
      // Get single schema by ID
      const schema = getNodeSchema(id);
      if (!schema) {
        return { status: 404, error: `Node schema not found: ${id}` };
      }
      return successResponse(schema);
    }

    if (category) {
      // Get schemas by category
      const nodes = getNodesByCategory(category);
      const schemas = nodes.map((node: any) => ({
        id: node.id,
        name: node.name,
        category: node.category,
        color: node.color,
        bgColor: node.bgColor,
        inputs: node.inputs,
        outputs: node.outputs,
        properties: node.properties,
        propertySchemas: node.propertySchemas,
        description: node.description,
        size: node.size,
      }));
      return successResponse(schemas);
    }

    // Get all schemas
    const schemas = getAllSchemas();
    return successResponse(schemas);
  } catch (error) {
    console.error('[node-schemas API] Error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

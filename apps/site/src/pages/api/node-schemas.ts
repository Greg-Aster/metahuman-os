import type { APIRoute } from 'astro'
import { getAllSchemas, getNodeSchema, getNodesByCategory } from '@metahuman/core'

/**
 * API endpoint for serving node schemas from the unified node system
 *
 * GET /api/node-schemas - Get all schemas
 * GET /api/node-schemas?id=user_input - Get schema by ID
 * GET /api/node-schemas?category=input - Get schemas by category
 */

export const GET: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id')
    const category = url.searchParams.get('category')

    if (id) {
      // Get single schema by ID
      const schema = getNodeSchema(id)
      if (!schema) {
        return new Response(JSON.stringify({ error: `Node schema not found: ${id}` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(schema), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (category) {
      // Get schemas by category
      const schemas = getNodesByCategory(category).map(node => ({
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
      }))
      return new Response(JSON.stringify(schemas), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get all schemas
    const schemas = getAllSchemas()
    return new Response(JSON.stringify(schemas), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[node-schemas API] Error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

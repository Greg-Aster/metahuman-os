import type { APIRoute } from 'astro';
import { loadFunction, deleteFunction } from '@metahuman/core/function-memory';
import { auditDataChange } from '@metahuman/core/audit';
import { requireWriteMode } from '../../../middleware/cognitiveModeGuard';

/**
 * GET /api/functions/:id
 *
 * Get a specific function by ID
 */
const getHandler: APIRoute = async ({ params }) => {
  try {
    const { id } = params;

    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Function ID is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Load function (checks both verified and draft)
    const func = await loadFunction(id);

    if (!func) {
      return new Response(
        JSON.stringify({ error: 'Function not found' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    return new Response(JSON.stringify({ function: func }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('[API /api/functions/:id] Error loading function:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};

/**
 * DELETE /api/functions/:id
 *
 * Delete a function
 */
const deleteHandler: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params;

    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Function ID is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Load function to check trust level
    const func = await loadFunction(id);

    if (!func) {
      return new Response(
        JSON.stringify({ error: 'Function not found' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Delete function
    await deleteFunction(id, func.metadata.trustLevel);

    // Audit the deletion
    auditDataChange({
      type: 'delete',
      resource: 'function',
      path: id,
      actor: 'human',
      details: {
        title: func.title,
        trustLevel: func.metadata.trustLevel,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Function "${func.title}" deleted`,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/functions/:id] Error deleting function:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};

// Wrap with middleware
// MIGRATED: 2025-11-20 - Explicit authentication pattern
export const GET = getHandler;
export const DELETE = requireWriteMode(deleteHandler);

import type { APIRoute } from 'astro';
import { loadFunction, promoteFunction } from '@metahuman/core/function-memory';
import { auditDataChange } from '@metahuman/core/audit';
import { requireWriteMode } from '../../../../middleware/cognitiveModeGuard';
import { withUserContext } from '../../../../middleware/userContext';

/**
 * POST /api/functions/:id/promote
 *
 * Promote a draft function to verified status
 */
const postHandler: APIRoute = async ({ params }) => {
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

    // Load function to verify it exists and is a draft
    const func = await loadFunction(id, 'draft');

    if (!func) {
      return new Response(
        JSON.stringify({
          error: 'Function not found or already verified',
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Promote to verified
    await promoteFunction(id);

    // Audit the promotion
    auditDataChange({
      type: 'update',
      resource: 'function',
      path: id,
      actor: 'human',
      details: {
        title: func.title,
        action: 'promoted',
        from: 'draft',
        to: 'verified',
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Function "${func.title}" promoted to verified`,
        functionId: id,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/functions/:id/promote] Error promoting function:', error);
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

// Wrap with middleware (requires write mode)
export const POST = withUserContext(requireWriteMode(postHandler));

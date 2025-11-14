import type { APIRoute } from 'astro';
import {
  maintainFunctionMemory,
  consolidateDraftFunctions,
  cleanupDraftFunctions,
} from '@metahuman/core/function-memory';
import { auditAction } from '@metahuman/core/audit';
import { requireWriteMode } from '../../../middleware/cognitiveModeGuard';
import { withUserContext } from '../../../middleware/userContext';

/**
 * POST /api/functions/maintenance
 *
 * Run function memory maintenance operations
 *
 * Body parameters:
 * - operation: 'full' | 'consolidate' | 'cleanup' (default: 'full')
 * - dryRun: boolean (default: false)
 */
const postHandler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const operation = body.operation || 'full';
    const dryRun = body.dryRun === true;

    let result: any;

    switch (operation) {
      case 'consolidate':
        // Only consolidate similar drafts
        result = await consolidateDraftFunctions({ dryRun });
        break;

      case 'cleanup':
        // Only clean up low-quality drafts
        result = await cleanupDraftFunctions({ dryRun });
        break;

      case 'full':
      default:
        // Run full maintenance cycle
        result = await maintainFunctionMemory({ dryRun });
        break;
    }

    // Audit the maintenance operation
    auditAction({
      event: 'function_memory_maintenance',
      details: {
        operation,
        dryRun,
        result,
      },
      actor: 'human',
    });

    return new Response(
      JSON.stringify({
        success: true,
        operation,
        dryRun,
        result,
        message: dryRun
          ? 'Maintenance preview completed (no changes made)'
          : 'Maintenance completed successfully',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/functions/maintenance] Error running maintenance:', error);
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
 * GET /api/functions/maintenance
 *
 * Get maintenance recommendations (dry run of full maintenance)
 */
const getHandler: APIRoute = async () => {
  try {
    // Run maintenance in dry-run mode to get recommendations
    const result = await maintainFunctionMemory({ dryRun: true });

    return new Response(
      JSON.stringify({
        recommendations: result,
        summary: {
          willConsolidate: result.consolidation.functionsMerged,
          willRemove: result.consolidation.functionsRemoved + result.cleanup.functionsRemoved,
          willReclaimBytes: result.cleanup.spaceReclaimed,
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/functions/maintenance] Error getting recommendations:', error);
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
export const GET = withUserContext(getHandler);
export const POST = withUserContext(requireWriteMode(postHandler));

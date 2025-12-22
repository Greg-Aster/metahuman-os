/**
 * Task Suggestions API Handlers
 *
 * Endpoints for managing task suggestions extracted from reflections.
 * Part of Phase 4: Task Graph + Projects
 *
 * POST /api/task-suggestions/extract - Extract suggestions from reflections
 * GET /api/task-suggestions - List pending suggestions
 * GET /api/task-suggestions/:id - Get a specific suggestion
 * POST /api/task-suggestions/:id/approve - Approve and create task
 * POST /api/task-suggestions/:id/reject - Reject suggestion
 * POST /api/task-suggestions/bulk-approve - Approve all high-confidence suggestions
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  extractTaskSuggestions,
  listTaskSuggestions,
  getTaskSuggestion,
  approveTaskSuggestion,
  rejectTaskSuggestion,
  bulkApprove,
  cleanupSuggestions,
  type ExtractionOptions,
  type TaskSuggestion,
} from '../../reflection-to-task.js';
import { audit } from '../../audit.js';

/**
 * POST /api/task-suggestions/extract
 * Extract task suggestions from recent reflections
 */
export async function handleExtractSuggestions(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as ExtractionOptions | undefined;

    const options: ExtractionOptions = {
      maxReflections: body?.maxReflections ?? 50,
      minConfidence: body?.minConfidence ?? 0.5,
      daysBack: body?.daysBack ?? 7,
      skipProcessed: body?.skipProcessed ?? true,
    };

    const result = await extractTaskSuggestions(options);

    audit({
      category: 'action',
      level: 'info',
      event: 'task_suggestions_extraction_api',
      actor: req.user.username,
      details: {
        reflectionsProcessed: result.reflectionsProcessed,
        suggestionsCreated: result.suggestions.length,
      },
    });

    return successResponse({
      success: true,
      reflectionsProcessed: result.reflectionsProcessed,
      suggestionsCreated: result.suggestions.length,
      suggestions: result.suggestions,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/task-suggestions
 * List task suggestions
 */
export async function handleListSuggestions(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const status = req.query?.status as TaskSuggestion['status'] | undefined;
    const suggestions = listTaskSuggestions(status);

    return successResponse({
      success: true,
      suggestions,
      count: suggestions.length,
      byStatus: {
        pending: suggestions.filter((s) => s.status === 'pending').length,
        approved: suggestions.filter((s) => s.status === 'approved').length,
        rejected: suggestions.filter((s) => s.status === 'rejected').length,
        created: suggestions.filter((s) => s.status === 'created').length,
      },
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/task-suggestions/:id
 * Get a specific suggestion
 */
export async function handleGetSuggestion(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const id = req.params?.id;
    if (!id) {
      return badRequestResponse('suggestion ID is required');
    }

    const suggestion = getTaskSuggestion(id);
    if (!suggestion) {
      return errorResponse('Suggestion not found', 404);
    }

    return successResponse({
      success: true,
      suggestion,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/task-suggestions/:id/approve
 * Approve a suggestion and create the task
 */
export async function handleApproveSuggestion(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const id = req.params?.id;
    if (!id) {
      return badRequestResponse('suggestion ID is required');
    }

    const body = req.body as {
      title?: string;
      description?: string;
      priority?: string;
      tags?: string[];
      projectId?: string;
    } | undefined;

    const result = approveTaskSuggestion(id, body ? {
      title: body.title,
      description: body.description,
      priority: body.priority,
      tags: body.tags,
      projectId: body.projectId,
    } : undefined);

    if (!result.success) {
      return errorResponse(result.error || 'Failed to approve suggestion', 400);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'task_suggestion_approved_api',
      actor: req.user.username,
      details: {
        suggestionId: id,
        taskId: result.taskId,
      },
    });

    return successResponse({
      success: true,
      taskId: result.taskId,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/task-suggestions/:id/reject
 * Reject a suggestion
 */
export async function handleRejectSuggestion(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const id = req.params?.id;
    if (!id) {
      return badRequestResponse('suggestion ID is required');
    }

    const success = rejectTaskSuggestion(id);
    if (!success) {
      return errorResponse('Suggestion not found or already reviewed', 400);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'task_suggestion_rejected_api',
      actor: req.user.username,
      details: { suggestionId: id },
    });

    return successResponse({ success: true });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/task-suggestions/bulk-approve
 * Approve all suggestions above a confidence threshold
 */
export async function handleBulkApprove(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { minConfidence?: number } | undefined;
    const minConfidence = body?.minConfidence ?? 0.8;

    const result = bulkApprove(minConfidence);

    audit({
      category: 'action',
      level: 'info',
      event: 'task_suggestions_bulk_approved',
      actor: req.user.username,
      details: {
        minConfidence,
        approved: result.approved,
        skipped: result.skipped,
        errors: result.errors.length,
      },
    });

    return successResponse({
      success: true,
      approved: result.approved,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/task-suggestions/cleanup
 * Clean up old reviewed suggestions
 */
export async function handleCleanupSuggestions(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { daysOld?: number } | undefined;
    const daysOld = body?.daysOld ?? 30;

    const removed = cleanupSuggestions(daysOld);

    return successResponse({
      success: true,
      removed,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

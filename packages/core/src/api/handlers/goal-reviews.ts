/**
 * Goal Review API Handlers
 *
 * Endpoints for managing weekly goal reviews.
 * Part of Phase 4: Continual Learning
 *
 * POST /api/goal-reviews/generate - Generate a weekly review
 * GET /api/goal-reviews - List recent reviews
 * GET /api/goal-reviews/latest - Get the most recent review
 * GET /api/goal-reviews/summary - Get quick goal status summary
 * GET /api/goal-reviews/current-week - Check if current week has review
 * GET /api/goal-reviews/:id - Get a specific review
 * DELETE /api/goal-reviews/:id - Delete a review
 * POST /api/goal-reviews/cleanup - Clean up old reviews
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  generateWeeklyReview,
  getLatestReview,
  getReview,
  listReviews,
  hasCurrentWeekReview,
  getGoalSummary,
  deleteReview,
  cleanupReviews,
  type ReviewOptions,
} from '../../goal-review.js';
import { audit } from '../../audit.js';

/**
 * POST /api/goal-reviews/generate
 * Generate a weekly review
 */
export async function handleGenerateReview(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as ReviewOptions | undefined;

    const options: ReviewOptions = {
      includeArchived: body?.includeArchived ?? false,
      weeksBack: body?.weeksBack ?? 4,
      generateInsights: body?.generateInsights ?? true,
    };

    const review = await generateWeeklyReview(options);

    audit({
      category: 'action',
      level: 'info',
      event: 'goal_review_generated_api',
      actor: req.user.username,
      details: {
        reviewId: review.id,
        weekOf: review.weekOf,
        projectCount: review.projects.length,
      },
    });

    return successResponse({
      success: true,
      review,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/goal-reviews
 * List recent reviews
 */
export async function handleListReviews(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const limit = req.query?.limit ? parseInt(req.query.limit, 10) : 10;
    const reviews = listReviews(limit);

    return successResponse({
      success: true,
      reviews,
      count: reviews.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/goal-reviews/latest
 * Get the most recent review
 */
export async function handleGetLatestReview(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const review = getLatestReview();

    if (!review) {
      return successResponse({
        success: true,
        review: null,
        message: 'No reviews found. Generate one with POST /api/goal-reviews/generate',
      });
    }

    return successResponse({
      success: true,
      review,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/goal-reviews/summary
 * Get quick goal status summary (no LLM)
 */
export async function handleGetGoalSummary(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const summary = getGoalSummary();

    return successResponse({
      success: true,
      summary,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/goal-reviews/current-week
 * Check if current week has a review
 */
export async function handleCheckCurrentWeek(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const hasReview = hasCurrentWeekReview();

    return successResponse({
      success: true,
      hasReview,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/goal-reviews/:id
 * Get a specific review
 */
export async function handleGetReview(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const id = req.params?.id;
    if (!id) {
      return badRequestResponse('review ID is required');
    }

    const review = getReview(id);
    if (!review) {
      return errorResponse('Review not found', 404);
    }

    return successResponse({
      success: true,
      review,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * DELETE /api/goal-reviews/:id
 * Delete a review
 */
export async function handleDeleteReview(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const id = req.params?.id;
    if (!id) {
      return badRequestResponse('review ID is required');
    }

    const success = deleteReview(id);
    if (!success) {
      return errorResponse('Review not found', 404);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'goal_review_deleted',
      actor: req.user.username,
      details: { reviewId: id },
    });

    return successResponse({ success: true });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/goal-reviews/cleanup
 * Clean up old reviews
 */
export async function handleCleanupReviews(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { keepWeeks?: number } | undefined;
    const keepWeeks = body?.keepWeeks ?? 12;

    const removed = cleanupReviews(keepWeeks);

    return successResponse({
      success: true,
      removed,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

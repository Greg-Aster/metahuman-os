/**
 * CLIP Image Tagging API Handler
 *
 * Endpoints for semantic image tagging using CLIP.
 * POST /api/images/tag - Tag a single image
 * POST /api/images/tag-directory - Tag all images in a directory
 * GET /api/images/clip-status - Check CLIP availability
 * GET /api/images/labels - Get available label categories
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  tagImage,
  tagImagesInDirectory,
  getClipStatus,
  getAllDefaultLabels,
  getLabelsByCategory,
  DEFAULT_LABELS,
  type ImageTaggingOptions,
} from '../../connectors/clip-tagger.js';
import { audit } from '../../audit.js';

/**
 * POST /api/images/tag
 * Tag a single image with semantic labels
 * Route requires auth via requiresAuth: true
 */
export async function handleTagImage(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      filepath: string;
      customLabels?: string[];
      topK?: number;
      minConfidence?: number;
      generateDescription?: boolean;
      returnEmbedding?: boolean;
    };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const options: ImageTaggingOptions = {
      customLabels: body.customLabels,
      topK: body.topK ?? 10,
      minConfidence: body.minConfidence ?? 0.1,
      generateDescription: body.generateDescription ?? true,
      returnEmbedding: body.returnEmbedding ?? false,
    };

    const result = await tagImage(body.filepath, options);

    audit({
      category: 'action',
      level: result.success ? 'info' : 'error',
      event: 'image_tagging_api',
      actor: req.user.username,
      details: {
        filepath: body.filepath,
        success: result.success,
        tagCount: result.tags.length,
        topTags: result.tags.slice(0, 5).map((t) => t.label),
        error: result.error,
      },
    });

    if (!result.success) {
      return errorResponse(result.error || 'Image tagging failed', 500);
    }

    return successResponse({
      success: true,
      filepath: result.filepath,
      tags: result.tags,
      description: result.description,
      embedding: result.embedding,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/images/tag-directory
 * Tag all images in a directory
 * Route requires auth via requiresAuth: true
 */
export async function handleTagImageDirectory(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      directory: string;
      recursive?: boolean;
      customLabels?: string[];
      topK?: number;
      minConfidence?: number;
      generateDescription?: boolean;
    };

    if (!body.directory) {
      return badRequestResponse('directory is required');
    }

    const options: ImageTaggingOptions & { recursive?: boolean } = {
      customLabels: body.customLabels,
      topK: body.topK ?? 10,
      minConfidence: body.minConfidence ?? 0.1,
      generateDescription: body.generateDescription ?? false,
      recursive: body.recursive ?? false,
    };

    const result = await tagImagesInDirectory(body.directory, options);

    audit({
      category: 'action',
      level: 'info',
      event: 'image_directory_tagging_api',
      actor: req.user.username,
      details: {
        directory: body.directory,
        recursive: options.recursive,
        total: result.total,
        successful: result.successful,
        failed: result.failed,
      },
    });

    return successResponse({
      success: true,
      total: result.total,
      successful: result.successful,
      failed: result.failed,
      results: result.results.map((r) => ({
        filepath: r.filepath,
        success: r.success,
        tags: r.tags.slice(0, 5), // Limit tags in summary
        description: r.description,
        error: r.error,
      })),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/images/clip-status
 * Check if CLIP is available
 * Route requires auth via requiresAuth: true
 */
export async function handleGetClipStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const status = getClipStatus();

    return successResponse({
      success: true,
      ...status,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/images/labels
 * Get available label categories and labels
 * Route requires auth via requiresAuth: true
 */
export async function handleGetLabels(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    return successResponse({
      success: true,
      categories: Object.keys(DEFAULT_LABELS),
      labelsByCategory: DEFAULT_LABELS,
      totalLabels: getAllDefaultLabels().length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * Photo Ingestion API Handler
 *
 * Endpoints for ingesting photos into the memory system.
 * POST /api/photos/ingest - Ingest a single photo
 * POST /api/photos/ingest-directory - Ingest photos from a directory
 * POST /api/photos/metadata - Extract EXIF metadata without ingesting
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  extractExifMetadata,
  ingestPhoto,
  ingestPhotosFromDirectory,
  type PhotoIngestionOptions,
} from '../../connectors/photo-ingestor.js';
import { audit } from '../../audit.js';

/**
 * POST /api/photos/ingest
 * Ingest a single photo into memory
 * Route requires auth via requiresAuth: true
 */
export async function handleIngestPhoto(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      filepath: string;
      copyToProfile?: boolean;
      additionalTags?: string[];
      source?: string;
    };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const options: PhotoIngestionOptions = {
      copyToProfile: body.copyToProfile ?? false,
      additionalTags: body.additionalTags,
      source: body.source || 'web-upload',
    };

    const result = await ingestPhoto(body.filepath, req.user.username, options);

    audit({
      category: 'action',
      level: result.success ? 'info' : 'error',
      event: 'photo_ingestion_api',
      actor: req.user.username,
      details: {
        filepath: body.filepath,
        success: result.success,
        memoryId: result.memoryId,
        error: result.error,
      },
    });

    if (!result.success) {
      return errorResponse(result.error || 'Photo ingestion failed', 500);
    }

    return successResponse({
      success: true,
      memoryId: result.memoryId,
      metadata: result.metadata,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/photos/ingest-directory
 * Ingest all photos from a directory
 * Route requires auth via requiresAuth: true
 */
export async function handleIngestDirectory(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      directory: string;
      recursive?: boolean;
      copyToProfile?: boolean;
      additionalTags?: string[];
      source?: string;
    };

    if (!body.directory) {
      return badRequestResponse('directory is required');
    }

    const options: PhotoIngestionOptions & { recursive?: boolean } = {
      copyToProfile: body.copyToProfile ?? false,
      additionalTags: body.additionalTags,
      source: body.source || 'directory-import',
      recursive: body.recursive ?? false,
    };

    const result = await ingestPhotosFromDirectory(
      body.directory,
      req.user.username,
      options
    );

    audit({
      category: 'action',
      level: 'info',
      event: 'photo_directory_ingestion_api',
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
      results: result.results.map(r => ({
        filepath: r.filepath,
        success: r.success,
        memoryId: r.memoryId,
        error: r.error,
      })),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/photos/metadata
 * Extract EXIF metadata from a photo without ingesting
 * Route requires auth via requiresAuth: true
 */
export async function handleExtractMetadata(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { filepath: string };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const metadata = await extractExifMetadata(body.filepath);

    return successResponse({
      success: true,
      metadata,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

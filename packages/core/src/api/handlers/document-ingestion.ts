/**
 * Document Ingestion API Handler
 *
 * Endpoints for ingesting documents into the memory system.
 * POST /api/documents/ingest - Ingest a single document
 * POST /api/documents/ingest-directory - Ingest documents from a directory
 * POST /api/documents/extract - Extract content without ingesting
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  extractDocumentContent,
  ingestDocument,
  ingestDocumentsFromDirectory,
  type DocumentIngestionOptions,
} from '../../connectors/document-ingestor.js';
import { audit } from '../../audit.js';

/**
 * POST /api/documents/ingest
 * Ingest a single document into memory
 * Route requires auth via requiresAuth: true
 */
export async function handleIngestDocument(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      filepath: string;
      copyToProfile?: boolean;
      maxContentLength?: number;
      additionalTags?: string[];
      source?: string;
      storeFullContent?: boolean;
    };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const options: DocumentIngestionOptions = {
      copyToProfile: body.copyToProfile ?? false,
      maxContentLength: body.maxContentLength,
      additionalTags: body.additionalTags,
      source: body.source || 'web-upload',
      storeFullContent: body.storeFullContent ?? true,
    };

    const result = await ingestDocument(body.filepath, req.user.username, options);

    audit({
      category: 'action',
      level: result.success ? 'info' : 'error',
      event: 'document_ingestion_api',
      actor: req.user.username,
      details: {
        filepath: body.filepath,
        success: result.success,
        memoryId: result.memoryId,
        error: result.error,
      },
    });

    if (!result.success) {
      return errorResponse(result.error || 'Document ingestion failed', 500);
    }

    return successResponse({
      success: true,
      memoryId: result.memoryId,
      metadata: result.metadata,
      contentPreview: result.contentPreview,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/documents/ingest-directory
 * Ingest all documents from a directory
 * Route requires auth via requiresAuth: true
 */
export async function handleIngestDocumentDirectory(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      directory: string;
      recursive?: boolean;
      copyToProfile?: boolean;
      maxContentLength?: number;
      additionalTags?: string[];
      source?: string;
      storeFullContent?: boolean;
    };

    if (!body.directory) {
      return badRequestResponse('directory is required');
    }

    const options: DocumentIngestionOptions & { recursive?: boolean } = {
      copyToProfile: body.copyToProfile ?? false,
      maxContentLength: body.maxContentLength,
      additionalTags: body.additionalTags,
      source: body.source || 'directory-import',
      storeFullContent: body.storeFullContent ?? true,
      recursive: body.recursive ?? false,
    };

    const result = await ingestDocumentsFromDirectory(
      body.directory,
      req.user.username,
      options
    );

    audit({
      category: 'action',
      level: 'info',
      event: 'document_directory_ingestion_api',
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
        contentPreview: r.contentPreview,
      })),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/documents/extract
 * Extract content from a document without ingesting
 * Route requires auth via requiresAuth: true
 */
export async function handleExtractDocument(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { filepath: string };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const { text, metadata } = await extractDocumentContent(body.filepath);

    return successResponse({
      success: true,
      metadata,
      contentPreview: text.substring(0, 500),
      fullTextLength: text.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

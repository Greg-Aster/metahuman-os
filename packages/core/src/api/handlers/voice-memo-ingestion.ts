/**
 * Voice Memo Ingestion API Handler
 *
 * Endpoints for ingesting voice memos into the memory system.
 * POST /api/voice-memos/ingest - Ingest a single voice memo
 * POST /api/voice-memos/ingest-directory - Ingest voice memos from a directory
 * POST /api/voice-memos/metadata - Extract audio metadata without ingesting
 * GET /api/voice-memos/transcription-status - Check transcription availability
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  extractAudioMetadata,
  ingestVoiceMemo,
  ingestVoiceMemosFromDirectory,
  getTranscriptionStatus,
  type VoiceMemoIngestionOptions,
} from '../../connectors/voice-memo-ingestor.js';
import { audit } from '../../audit.js';

/**
 * POST /api/voice-memos/ingest
 * Ingest a single voice memo into memory
 * Route requires auth via requiresAuth: true
 */
export async function handleIngestVoiceMemo(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      filepath: string;
      copyToProfile?: boolean;
      additionalTags?: string[];
      source?: string;
      language?: string;
      skipTranscription?: boolean;
      maxTranscriptionLength?: number;
    };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const options: VoiceMemoIngestionOptions = {
      copyToProfile: body.copyToProfile ?? false,
      additionalTags: body.additionalTags,
      source: body.source || 'web-upload',
      language: body.language,
      skipTranscription: body.skipTranscription ?? false,
      maxTranscriptionLength: body.maxTranscriptionLength,
    };

    const result = await ingestVoiceMemo(body.filepath, req.user.username, options);

    audit({
      category: 'action',
      level: result.success ? 'info' : 'error',
      event: 'voice_memo_ingestion_api',
      actor: req.user.username,
      details: {
        filepath: body.filepath,
        success: result.success,
        memoryId: result.memoryId,
        hasTranscription: !!result.transcription,
        duration: result.metadata?.duration,
        error: result.error,
      },
    });

    if (!result.success) {
      return errorResponse(result.error || 'Voice memo ingestion failed', 500);
    }

    return successResponse({
      success: true,
      memoryId: result.memoryId,
      metadata: result.metadata,
      transcriptionPreview: result.transcriptionPreview,
      hasTranscription: !!result.transcription,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/voice-memos/ingest-directory
 * Ingest all voice memos from a directory
 * Route requires auth via requiresAuth: true
 */
export async function handleIngestVoiceMemoDirectory(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      directory: string;
      recursive?: boolean;
      copyToProfile?: boolean;
      additionalTags?: string[];
      source?: string;
      language?: string;
      skipTranscription?: boolean;
    };

    if (!body.directory) {
      return badRequestResponse('directory is required');
    }

    const options: VoiceMemoIngestionOptions & { recursive?: boolean } = {
      copyToProfile: body.copyToProfile ?? false,
      additionalTags: body.additionalTags,
      source: body.source || 'directory-import',
      language: body.language,
      skipTranscription: body.skipTranscription ?? false,
      recursive: body.recursive ?? false,
    };

    const result = await ingestVoiceMemosFromDirectory(body.directory, req.user.username, options);

    audit({
      category: 'action',
      level: 'info',
      event: 'voice_memo_directory_ingestion_api',
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
        memoryId: r.memoryId,
        duration: r.metadata?.duration,
        hasTranscription: !!r.transcription,
        error: r.error,
      })),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/voice-memos/metadata
 * Extract audio metadata from a voice memo without ingesting
 * Route requires auth via requiresAuth: true
 */
export async function handleExtractVoiceMemoMetadata(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { filepath: string };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const metadata = await extractAudioMetadata(body.filepath);

    return successResponse({
      success: true,
      metadata,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/voice-memos/transcription-status
 * Check if transcription is available
 * Route requires auth via requiresAuth: true
 */
export async function handleGetTranscriptionStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const status = getTranscriptionStatus();

    return successResponse({
      success: true,
      ...status,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

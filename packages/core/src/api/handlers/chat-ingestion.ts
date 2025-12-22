/**
 * Chat Ingestion API Handler
 *
 * Endpoints for ingesting chat exports into the memory system.
 * POST /api/chats/ingest - Ingest a single chat export
 * POST /api/chats/ingest-directory - Ingest chat exports from a directory
 * POST /api/chats/parse - Parse a chat export without ingesting
 * POST /api/chats/detect-platform - Detect the platform of a chat export
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  detectPlatform,
  parseChatExport,
  ingestChatExport,
  ingestChatsFromDirectory,
  type ChatIngestionOptions,
} from '../../connectors/chat-ingestor.js';
import { audit } from '../../audit.js';

/**
 * POST /api/chats/ingest
 * Ingest a single chat export into memory
 * Route requires auth via requiresAuth: true
 */
export async function handleIngestChat(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      filepath: string;
      myName?: string;
      myAliases?: string[];
      minMessages?: number;
      chunkSize?: number;
      additionalTags?: string[];
      source?: string;
      includeAttachments?: boolean;
    };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const options: ChatIngestionOptions = {
      myName: body.myName,
      myAliases: body.myAliases,
      minMessages: body.minMessages,
      chunkSize: body.chunkSize ?? 50,
      additionalTags: body.additionalTags,
      source: body.source || 'web-upload',
      includeAttachments: body.includeAttachments ?? true,
    };

    const result = await ingestChatExport(body.filepath, req.user.username, options);

    audit({
      category: 'action',
      level: result.success ? 'info' : 'error',
      event: 'chat_ingestion_api',
      actor: req.user.username,
      details: {
        filepath: body.filepath,
        success: result.success,
        platform: result.platform,
        conversationCount: result.conversationCount,
        messageCount: result.messageCount,
        memoryCount: result.memoryIds?.length,
        error: result.error,
      },
    });

    if (!result.success) {
      return errorResponse(result.error || 'Chat ingestion failed', 500);
    }

    return successResponse({
      success: true,
      platform: result.platform,
      conversationCount: result.conversationCount,
      messageCount: result.messageCount,
      memoryCount: result.memoryIds?.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/chats/ingest-directory
 * Ingest all chat exports from a directory
 * Route requires auth via requiresAuth: true
 */
export async function handleIngestChatDirectory(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      directory: string;
      recursive?: boolean;
      myName?: string;
      myAliases?: string[];
      minMessages?: number;
      chunkSize?: number;
      additionalTags?: string[];
      source?: string;
    };

    if (!body.directory) {
      return badRequestResponse('directory is required');
    }

    const options: ChatIngestionOptions & { recursive?: boolean } = {
      myName: body.myName,
      myAliases: body.myAliases,
      minMessages: body.minMessages,
      chunkSize: body.chunkSize ?? 50,
      additionalTags: body.additionalTags,
      source: body.source || 'directory-import',
      recursive: body.recursive ?? false,
    };

    const result = await ingestChatsFromDirectory(body.directory, req.user.username, options);

    audit({
      category: 'action',
      level: 'info',
      event: 'chat_directory_ingestion_api',
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
        platform: r.platform,
        conversationCount: r.conversationCount,
        messageCount: r.messageCount,
        error: r.error,
      })),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/chats/parse
 * Parse a chat export without ingesting - useful for preview
 * Route requires auth via requiresAuth: true
 */
export async function handleParseChat(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      filepath: string;
      myName?: string;
      myAliases?: string[];
    };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const platform = detectPlatform(body.filepath);
    const conversations = await parseChatExport(body.filepath, {
      myName: body.myName,
      myAliases: body.myAliases,
    });

    return successResponse({
      success: true,
      platform,
      conversationCount: conversations.length,
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        platform: c.platform,
        participants: c.participants,
        messageCount: c.messages.length,
        isGroup: c.isGroup,
        startDate: c.startDate?.toISOString(),
        endDate: c.endDate?.toISOString(),
        // Include first few messages as preview
        preview: c.messages.slice(0, 5).map((m) => ({
          timestamp: m.timestamp.toISOString(),
          sender: m.sender,
          content: m.content.substring(0, 200),
          isMe: m.isMe,
        })),
      })),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/chats/detect-platform
 * Detect the platform of a chat export file
 * Route requires auth via requiresAuth: true
 */
export async function handleDetectPlatform(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { filepath: string };

    if (!body.filepath) {
      return badRequestResponse('filepath is required');
    }

    const platform = detectPlatform(body.filepath);

    return successResponse({
      success: true,
      filepath: body.filepath,
      platform,
      description: getPlatformDescription(platform),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

function getPlatformDescription(platform: string): string {
  switch (platform) {
    case 'whatsapp':
      return 'WhatsApp text export (format: DD/MM/YYYY, HH:MM - Sender: Message)';
    case 'telegram':
      return 'Telegram JSON export (from Telegram Desktop or API)';
    case 'discord':
      return 'Discord JSON export (from DiscordChatExporter or similar tools)';
    case 'signal':
      return 'Signal backup export';
    case 'imessage':
      return 'iMessage export';
    default:
      return 'Generic chat format (JSON array or text with Name: Message pattern)';
  }
}

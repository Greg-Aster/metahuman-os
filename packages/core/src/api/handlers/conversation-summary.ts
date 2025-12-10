/**
 * Conversation Summary API Handlers
 *
 * Retrieve existing conversation summary by session ID.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getProfilePaths } from '../../paths.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * GET /api/conversation/summary?sessionId=<id> - Get conversation summary
 */
export async function handleGetConversationSummary(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  try {
    if (!user.isAuthenticated) {
      return {
        status: 401,
        error: 'Authentication required',
      };
    }

    const profilePaths = getProfilePaths(user.username);
    const sessionId = query?.sessionId;

    if (!sessionId) {
      return {
        status: 400,
        error: 'Missing sessionId query parameter',
      };
    }

    // Query summary within user context
    let summaryText: string | null = null;
    let summaryMetadata: any = null;

    const episodicDir = profilePaths.episodic;
    if (fs.existsSync(episodicDir)) {
      // Look back 7 days for summaries
      const today = new Date();
      const lookbackDays = 7;

      for (let i = 0; i < lookbackDays; i++) {
        if (summaryText) break; // Found summary, stop searching

        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const year = date.getFullYear().toString();
        const yearDir = path.join(episodicDir, year);

        if (!fs.existsSync(yearDir)) continue;

        const files = fs.readdirSync(yearDir)
          .filter(f => f.endsWith('.json'))
          .sort()
          .reverse();

        for (const file of files) {
          const filepath = path.join(yearDir, file);
          try {
            const content = fs.readFileSync(filepath, 'utf-8');
            const event = JSON.parse(content);

            // Look for summary events with matching conversation ID
            if (event.type === 'summary' && event.metadata) {
              const summarySessionId = event.metadata.conversationId || event.metadata.sessionId;
              if (summarySessionId === sessionId) {
                summaryText = event.metadata.fullSummary || event.content || null;
                summaryMetadata = {
                  keyTopics: event.metadata.keyTopics || [],
                  decisions: event.metadata.decisions || [],
                  outcomes: event.metadata.outcomes || [],
                  messageCount: event.metadata.messageCount || 0,
                  toolsUsed: event.metadata.toolsUsed || [],
                  startTime: event.metadata.startTime,
                  endTime: event.metadata.endTime,
                  mode: event.metadata.cognitiveMode || 'unknown',
                };
                break;
              }
            }
          } catch {
            continue;
          }
        }
      }
    }

    return successResponse({
      success: true,
      summary: summaryText,
      metadata: summaryMetadata,
      exists: !!summaryText,
    });
  } catch (error) {
    console.error('[conversation-summary] GET error:', error);
    return {
      status: 500,
      error: 'Internal server error',
    };
  }
}

/**
 * API Endpoint: GET /api/conversation/summary?sessionId=<id>
 *
 * Phase 3: Memory Continuity - Retrieve existing conversation summary
 *
 * Query parameters:
 * - sessionId: Conversation session ID (required)
 *
 * Response:
 * {
 *   "success": true,
 *   "summary": "2-3 sentence overview of the conversation",
 *   "exists": true
 * }
 *
 * OR if no summary exists:
 * {
 *   "success": true,
 *   "summary": null,
 *   "exists": false
 * }
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

export const GET: APIRoute = async ({ url, cookies }) => {
  try {
    // Authentication check
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    // Get session ID from query params
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing sessionId query parameter'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Query summary within user context
    let summaryText: string | null = null;
    let summaryMetadata: any = null;

    const episodicDir = profilePaths.episodic;
    if (existsSync(episodicDir)) {
      // Look back 7 days for summaries
      const today = new Date();
      const lookbackDays = 7;

      for (let i = 0; i < lookbackDays; i++) {
        if (summaryText) break; // Found summary, stop searching

        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const year = date.getFullYear().toString();
        const yearDir = path.join(episodicDir, year);

        if (!existsSync(yearDir)) continue;

        const files = readdirSync(yearDir)
          .filter(f => f.endsWith('.json'))
          .sort()
          .reverse();

        for (const file of files) {
          const filepath = path.join(yearDir, file);
          try {
            const content = readFileSync(filepath, 'utf-8');
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
                  mode: event.metadata.cognitiveMode || 'unknown'
                };
                break;
              }
            }
          } catch (error) {
            continue;
          }
        }
      }
    }

    // Return response
    return new Response(
      JSON.stringify({
        success: true,
        summary: summaryText,
        metadata: summaryMetadata,
        exists: !!summaryText
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('[api/conversation/summary] Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

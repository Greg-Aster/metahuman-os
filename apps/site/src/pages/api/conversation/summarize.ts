/**
 * API Endpoint: POST /api/conversation/summarize
 *
 * Phase 3: Memory Continuity - Manual conversation summarization trigger
 *
 * Request body:
 * {
 *   "sessionId": "conv-1699358400-x7k2p9q1"  // Required: conversation session ID
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "summary": {
 *     "sessionId": "conv-1699358400-x7k2p9q1",
 *     "summary": "2-3 sentence overview",
 *     "keyTopics": ["topic1", "topic2"],
 *     "messageCount": 15,
 *     "toolsUsed": ["web_search", "read_file"]
 *   }
 * }
 */

import type { APIRoute } from 'astro';
import { audit, getAuthenticatedUser, getProfilePaths } from '@metahuman/core';

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// Removed withUserContext wrapper, now passes explicit username/profilePaths to summarizer
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Explicit authentication - require authenticated user
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    // Parse request body
    let sessionId: string;
    try {
      const body = await request.json();
      sessionId = body.sessionId;

      if (!sessionId || typeof sessionId !== 'string') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Missing or invalid sessionId'
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid JSON body'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Run summarization with explicit user context
    let summaryResult: any = null;
    let errorMessage: string | null = null;

    try {
      // Dynamic import to avoid circular dependencies
      const { summarizeSession } = await import('@brain/agents/summarizer.js');

      // Run summarization with explicit username and profilePaths
      const summary = await summarizeSession(sessionId, { username: user.username, profilePaths });

      if (summary) {
        summaryResult = {
          sessionId: summary.sessionId,
          summary: summary.summary,
          keyTopics: summary.keyTopics,
          decisions: summary.decisions,
          outcomes: summary.outcomes,
          messageCount: summary.messageCount,
          toolsUsed: summary.toolsUsed,
          mode: summary.mode,
          startTime: summary.startTime,
          endTime: summary.endTime
        };

        audit({
          level: 'info',
          category: 'action',
          event: 'manual_summarization_triggered',
          actor: user.username,
          details: {
            sessionId,
            messageCount: summary.messageCount,
            topicsCount: summary.keyTopics.length
          }
        });
      } else {
        errorMessage = 'No events found for this session';
      }
    } catch (error) {
      console.error('[api/conversation/summarize] Summarization error:', error);
      errorMessage = (error as Error).message || 'Summarization failed';

      audit({
        level: 'error',
        category: 'action',
        event: 'manual_summarization_failed',
        actor: user.username,
        details: {
          sessionId,
          error: errorMessage
        }
      });
    }

    // Return response
    if (summaryResult) {
      return new Response(
        JSON.stringify({
          success: true,
          summary: summaryResult
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage || 'Summarization failed'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } catch (error) {
    console.error('[api/conversation/summarize] Unexpected error:', error);

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

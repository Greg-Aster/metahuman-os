/**
 * Response Pipeline API Endpoint
 *
 * POST /api/response-pipeline
 *
 * Dedicated endpoint for card-based responses.
 * Uses a simple 5-node graph instead of the full dual-consciousness pipeline.
 *
 * Request body:
 * {
 *   message: string,           // User's response text
 *   cardType: string,          // 'desire_rejection', 'clarifying_question', etc.
 *   cardData: {
 *     desireId?: string,       // ID of related desire
 *     questionId?: string,     // ID of specific question
 *     content: string,         // Original card content
 *     ...                      // Other card-specific data
 *   },
 *   responseBufferId?: string, // For multi-turn conversations
 *   streaming?: boolean        // Use SSE streaming (default: false)
 * }
 *
 * Response (non-streaming):
 * {
 *   success: boolean,
 *   response: string,          // LLM response text
 *   responseBufferId: string,  // Buffer ID for follow-up messages
 *   actionTaken: string,       // Description of action taken
 *   pipelineTriggered: boolean,// Whether re-planning was triggered
 *   nextStatus?: string,       // New desire status (if changed)
 *   executionTimeMs: number
 * }
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import {
  handleResponsePipeline,
  streamResponsePipeline,
  type ResponsePipelineRequest,
} from '@metahuman/core';

const LOG_PREFIX = '[API:response-pipeline]';

// Flush stdout to ensure logs appear immediately
const flushLog = (msg: string) => {
  console.log(msg);
  if (process.stdout?.write) {
    process.stdout.write(''); // Force flush
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  // CRITICAL: Log IMMEDIATELY - use flushLog to ensure visibility
  flushLog(`${LOG_PREFIX} ========== ENDPOINT HIT ==========`);
  flushLog(`${LOG_PREFIX} Timestamp: ${new Date().toISOString()}`);
  flushLog(`${LOG_PREFIX} Request URL: ${request.url}`);
  flushLog(`${LOG_PREFIX} Content-Type: ${request.headers.get('content-type')}`);

  // Session check
  const sessionCookie = cookies?.get?.('mh_session');
  flushLog(`${LOG_PREFIX} Session present: ${!!sessionCookie?.value}`);

  try {
    // Authenticate
    console.log(`${LOG_PREFIX} Step 1: Checking authentication...`);
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let body: ResponsePipelineRequest & { streaming?: boolean };
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate required fields
    const { message, cardType, cardData, responseBufferId, streaming } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!cardType || typeof cardType !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Card type is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!cardData || typeof cardData !== 'object') {
      return new Response(
        JSON.stringify({ error: 'Card data is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} Processing ${cardType} response for ${user.username}`);
    console.log(`${LOG_PREFIX}   desireId: ${cardData.desireId || 'none'}`);
    console.log(`${LOG_PREFIX}   streaming: ${!!streaming}`);
    console.log(`${LOG_PREFIX}   message: ${message.substring(0, 50)}...`);

    // Use streaming or non-streaming handler
    if (streaming) {
      return streamResponsePipeline(
        { message, cardType, cardData, responseBufferId },
        user.username
      );
    }

    // Non-streaming: execute and return result
    const result = await handleResponsePipeline(
      { message, cardType, cardData, responseBufferId },
      user.username
    );

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} Success: action=${result.actionTaken}, triggered=${result.pipelineTriggered}`);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`${LOG_PREFIX} Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

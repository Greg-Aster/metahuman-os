/**
 * API Endpoint: GET /api/memory-metrics
 *
 * Phase 5: Observability & Testing - Memory Coverage Metrics
 * Workstream B3: Cache-first serving with stale-but-fast strategy
 *
 * Provides comprehensive metrics about memory capture and coverage:
 * - Total memories count
 * - Memories by type (conversation, tool_invocation, summary, etc.)
 * - Vector index coverage percentage
 * - Recent activity (tool invocations, file operations)
 * - Memory growth rate
 *
 * Response:
 * {
 *   "totalMemories": 1234,
 *   "memoriesByType": {
 *     "conversation": 500,
 *     "tool_invocation": 234,
 *     "summary": 45,
 *     "reflection": 120,
 *     "dream": 50,
 *     ...
 *   },
 *   "vectorIndexCoverage": 95,
 *   "lastCaptureTimestamp": "2025-11-07T14:30:00.000Z",
 *   "conversationSummaries": 45,
 *   "recentToolInvocations": 12,
 *   "recentFileOperations": 8,
 *   "memoryGrowthRate": 15.3,
 *   "lastUpdated": "2025-11-09T12:34:56.789Z",
 *   "computationTimeMs": 245
 * }
 */

import type { APIRoute } from 'astro';
import path from 'node:path';
import { getAuthenticatedUser, getMemoryMetrics } from '@metahuman/core';

/**
 * B3: Handler uses cache-first strategy for instant response
 * Serves stale-but-fast metrics from cache (updated every 5 minutes by background service)
 */
const handler: APIRoute = async (context) => {
  try {
    // Explicit auth - require authentication for memory metrics
    const user = getAuthenticatedUser(context.cookies);

    // B3: Get metrics from cache (stale-but-fast)
    // Falls back to fresh computation if cache miss
    const forceFresh = context.url.searchParams.get('fresh') === 'true';
    const metrics = await getMemoryMetrics(user.username, {
      forceFresh
    });

    return new Response(
      JSON.stringify(metrics, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          // Allow caching for 30 seconds (since metrics update every 5 minutes)
          'Cache-Control': 'public, max-age=30'
        }
      }
    );
  } catch (error) {
    console.error('[memory-metrics] Error:', error);
    return new Response(
      JSON.stringify({
        error: (error as Error).message,
        success: false
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// GET requires authentication for user-specific memory metrics
export const GET = handler;

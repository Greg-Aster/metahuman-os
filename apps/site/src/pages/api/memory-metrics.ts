/**
 * API Endpoint: GET /api/memory-metrics
 *
 * Phase 5: Observability & Testing - Memory Coverage Metrics
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
 *   "memoryGrowthRate": 15.3
 * }
 */

import type { APIRoute } from 'astro';
import { getUserContext, getIndexStatus, withUserContext } from '@metahuman/core';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

interface MemoryMetrics {
  totalMemories: number;
  memoriesByType: Record<string, number>;
  vectorIndexCoverage: number; // Percentage of memories with embeddings
  lastCaptureTimestamp: string;
  conversationSummaries: number;
  recentToolInvocations: number;
  recentFileOperations: number;
  memoryGrowthRate: number; // Memories per day (last 7 days)
}

async function calculateMetrics(): Promise<MemoryMetrics> {
  const ctx = getUserContext();
  if (!ctx) {
    throw new Error('No user context - authentication required');
  }

  const episodicDir = ctx.profilePaths.episodic;
  const indexStatus = getIndexStatus();

  let totalMemories = 0;
  const memoriesByType: Record<string, number> = {};
  let lastCaptureTimestamp = '';
  let recentToolInvocations = 0;
  let recentFileOperations = 0;
  let conversationSummaries = 0;
  const memoryTimestamps: string[] = [];

  // Scan episodic directory
  if (existsSync(episodicDir)) {
    const yearDirs = readdirSync(episodicDir);

    for (const year of yearDirs) {
      const yearPath = path.join(episodicDir, year);
      const stats = statSync(yearPath);

      if (!stats.isDirectory()) continue;

      const files = readdirSync(yearPath).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const filepath = path.join(yearPath, file);
        try {
          const content = readFileSync(filepath, 'utf-8');
          const event = JSON.parse(content);

          totalMemories++;

          // Count by type
          const type = event.type || 'unknown';
          memoriesByType[type] = (memoriesByType[type] || 0) + 1;

          // Count summaries
          if (type === 'summary') {
            conversationSummaries++;
          }

          // Track timestamps
          if (event.timestamp) {
            memoryTimestamps.push(event.timestamp);

            // Recent tool invocations (last 24 hours)
            const ageMs = Date.now() - new Date(event.timestamp).getTime();
            if (type === 'tool_invocation' && ageMs < 86400000) {
              recentToolInvocations++;
            }

            // Recent file operations (last 24 hours)
            if ((type === 'file_read' || type === 'file_write') && ageMs < 86400000) {
              recentFileOperations++;
            }

            // Update last capture
            if (!lastCaptureTimestamp || event.timestamp > lastCaptureTimestamp) {
              lastCaptureTimestamp = event.timestamp;
            }
          }
        } catch (error) {
          // Skip malformed files
          console.warn(`[memory-metrics] Skipping malformed file: ${filepath}`);
        }
      }
    }
  }

  // Calculate vector index coverage
  const indexedItems = (indexStatus as any).items ?? (indexStatus as any).count ?? 0;
  const vectorIndexCoverage = indexStatus.exists && totalMemories > 0
    ? Math.round((indexedItems / totalMemories) * 100)
    : 0;

  // Calculate memory growth rate (last 7 days)
  const sevenDaysAgo = Date.now() - (7 * 86400000);
  const recentMemories = memoryTimestamps.filter(ts => {
    try {
      return new Date(ts).getTime() > sevenDaysAgo;
    } catch {
      return false;
    }
  });
  const memoryGrowthRate = Math.round(recentMemories.length / 7 * 10) / 10; // Per day

  return {
    totalMemories,
    memoriesByType,
    vectorIndexCoverage,
    lastCaptureTimestamp,
    conversationSummaries,
    recentToolInvocations,
    recentFileOperations,
    memoryGrowthRate
  };
}

const handler: APIRoute = async () => {
  try {
    const metrics = await calculateMetrics();

    return new Response(
      JSON.stringify(metrics, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
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

export const GET = withUserContext(handler);

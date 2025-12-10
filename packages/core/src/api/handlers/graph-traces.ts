/**
 * Graph Traces API Handlers
 *
 * GET graph execution traces.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

const TRACE_FILE = path.join(systemPaths.logs, 'graph-traces.ndjson');

interface GraphTraceEntry {
  timestamp: string;
  mode?: string;
  graph?: string;
  sessionId?: string;
  status?: string;
  durationMs?: number;
  eventCount?: number;
  error?: string;
}

/**
 * GET /api/graph-traces - Get recent graph execution traces
 */
export async function handleGetGraphTraces(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const limit = Math.max(1, Math.min(100, parseInt(req.query?.limit || '20', 10)));

    const entries: GraphTraceEntry[] = [];
    const raw = await fs.readFile(TRACE_FILE, 'utf-8').catch(() => '');
    if (raw) {
      const lines = raw.trim().split('\n').filter(Boolean);
      const recent = lines.slice(-limit);
      for (const line of recent.reverse()) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // skip malformed lines
        }
      }
    }

    return successResponse({ traces: entries });
  } catch (error) {
    console.error('[graph-traces] Failed to load traces:', error);
    return { status: 500, error: 'Failed to load graph traces' };
  }
}

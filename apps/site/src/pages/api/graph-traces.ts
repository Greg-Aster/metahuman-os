import type { APIRoute } from 'astro';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT } from '@metahuman/core';

const TRACE_FILE = path.join(ROOT, 'logs', 'graph-traces.ndjson');

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

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 20));

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

    return new Response(JSON.stringify({ traces: entries }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[graph-traces] Failed to load traces:', error);
    return new Response(JSON.stringify({ error: 'Failed to load graph traces' }), { status: 500 });
  }
};

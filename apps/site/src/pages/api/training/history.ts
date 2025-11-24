import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';

interface TrainingRun {
  id: string;
  startTime: string;
  endTime?: string;
  status: 'completed' | 'failed' | 'cancelled';
  pid?: number;
  method: string;
  logFile: string;
  dataset?: string;
  baseModel?: string;
  duration?: string;
  error?: string;
}

/**
 * Parse audit logs to extract training run history
 */
function parseTrainingHistory(): TrainingRun[] {
  const runs: TrainingRun[] = [];
  const auditDir = path.join(systemPaths.logs, 'audit');

  if (!fs.existsSync(auditDir)) {
    return runs;
  }

  // Get all audit log files, sorted by date (newest first)
  const logFiles = fs.readdirSync(auditDir)
    .filter(f => f.endsWith('.ndjson'))
    .sort()
    .reverse()
    .slice(0, 30); // Last 30 days

  // Track training runs by PID
  const runsByPid = new Map<number, TrainingRun>();

  for (const logFile of logFiles) {
    const logPath = path.join(auditDir, logFile);
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);
        const event = entry.event as string;

        // Track full cycle starts
        if (event === 'full_cycle_queued') {
          const pid = entry.details?.pid;
          const logPath = entry.details?.logPath;

          if (pid && logPath) {
            const run: TrainingRun = {
              id: `run-${pid}`,
              startTime: entry.timestamp,
              status: 'completed', // Default, will update if we find errors
              pid,
              method: entry.details?.dualMode ? 'full-cycle (dual)' : 'full-cycle',
              logFile: path.basename(logPath),
              baseModel: entry.details?.model,
            };

            runsByPid.set(pid, run);
          }
        }

        // Track cancellations
        if (event === 'full_cycle_cancelled') {
          const pids = entry.details?.pids || [];
          for (const pid of pids) {
            const run = runsByPid.get(pid);
            if (run) {
              run.status = 'cancelled';
              run.endTime = entry.timestamp;
              run.duration = calculateDuration(run.startTime, entry.timestamp);
            }
          }
        }

        // Track failures
        if (event.includes('_failed') && event.includes('cycle')) {
          // Try to extract PID from context (not always available)
          const pid = entry.details?.pid;
          if (pid) {
            const run = runsByPid.get(pid);
            if (run) {
              run.status = 'failed';
              run.error = entry.details?.error || 'Training failed';
              run.endTime = entry.timestamp;
              run.duration = calculateDuration(run.startTime, entry.timestamp);
            }
          }
        }

        // Track successful completions (adapter activation)
        if (event === 'adapter_activated') {
          const dataset = entry.details?.date || entry.details?.dataset;

          // Find the most recent run that doesn't have a dataset yet
          for (const [pid, run] of runsByPid.entries()) {
            if (!run.dataset && run.status === 'completed') {
              run.dataset = dataset;
              run.endTime = entry.timestamp;
              run.duration = calculateDuration(run.startTime, entry.timestamp);
              break; // Only assign to one run
            }
          }
        }
      } catch (err) {
        // Skip invalid JSON lines
      }
    }
  }

  // Convert map to array and sort by start time (newest first)
  const allRuns = Array.from(runsByPid.values())
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  return allRuns.slice(0, 50); // Return last 50 runs
}

/**
 * Calculate duration between two ISO timestamps
 */
function calculateDuration(start: string, end: string): string {
  try {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const diffMs = endTime - startTime;

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  } catch {
    return 'N/A';
  }
}

/**
 * GET handler - Retrieve training history
 */
export const GET: APIRoute = async () => {
  try {
    const runs = parseTrainingHistory();

    return new Response(
      JSON.stringify({
        success: true,
        runs,
        count: runs.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Failed to load training history',
        runs: [],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

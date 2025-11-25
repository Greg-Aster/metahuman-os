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
  fullLogPath?: string; // Full path for reading logs
}

/**
 * Parse docs/run_logs directory to extract training runs
 */
function parseRunLogsDirectory(): TrainingRun[] {
  const runs: TrainingRun[] = [];
  const runLogsDir = path.join(systemPaths.root, 'docs', 'run_logs');

  if (!fs.existsSync(runLogsDir)) {
    return runs;
  }

  try {
    // Get date directories (YYYY-MM-DD)
    const dateDirs = fs.readdirSync(runLogsDir)
      .filter(f => {
        const fullPath = path.join(runLogsDir, f);
        return fs.statSync(fullPath).isDirectory();
      })
      .sort()
      .reverse()
      .slice(0, 30); // Last 30 days

    for (const dateDir of dateDirs) {
      const datePath = path.join(runLogsDir, dateDir);

      // Get run directories within each date
      const runDirs = fs.readdirSync(datePath)
        .filter(f => {
          const fullPath = path.join(datePath, f);
          return fs.statSync(fullPath).isDirectory();
        });

      for (const runDir of runDirs) {
        const runPath = path.join(datePath, runDir);
        const trainerLogPath = path.join(runPath, 'trainer.log');

        if (!fs.existsSync(trainerLogPath)) {
          continue;
        }

        try {
          // Parse trainer.log to extract metadata (optimized - read only last 50KB for large files)
          const logStats = fs.statSync(trainerLogPath);
          const fileSize = logStats.size;

          let logContent = '';
          if (fileSize > 50000) {
            // For large files, read last 50KB only (roughly 500-1000 lines)
            const fd = fs.openSync(trainerLogPath, 'r');
            const readSize = Math.min(50000, fileSize);
            const buffer = Buffer.alloc(readSize);
            fs.readSync(fd, buffer, 0, readSize, fileSize - readSize);
            fs.closeSync(fd);
            logContent = buffer.toString('utf-8');
          } else {
            // For small files, read entire file
            logContent = fs.readFileSync(trainerLogPath, 'utf-8');
          }

          const lines = logContent.split('\n');

          let startTime = '';
          let endTime = '';
          let status: 'completed' | 'failed' | 'cancelled' = 'completed';
          let method = 'fine-tune';
          let baseModel = '';
          let error = '';

          // Extract metadata from log lines (optimized - scan in reverse for end time)
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];

            // Extract end time first (scan from bottom)
            if (!endTime) {
              const timestampMatch = line.match(/\[([\d-T:.Z]+)\]/);
              if (timestampMatch) {
                endTime = timestampMatch[1];
              }
            }

            // Check for errors
            if (line.includes('Training exit code: 1') || line.includes('failed')) {
              status = 'failed';
            }

            if (line.includes('torch.AcceleratorError') || line.includes('CUDA error')) {
              status = 'failed';
              error = 'CUDA error: GPU busy or unavailable';
            }

            if (line.includes('Training stderr') && line.includes('error')) {
              status = 'failed';
              if (!error) error = 'Training script error';
            }
          }

          // Scan from top for start time and model info
          for (const line of lines) {
            // Extract start time (first timestamp)
            if (!startTime && line.includes('Starting new training run')) {
              const match = line.match(/\[([\d-T:.Z]+)\]/);
              if (match) startTime = match[1];
            }

            // Extract base model
            if (!baseModel && (line.includes('base_model') || line.includes('Loading tokenizer for'))) {
              const modelMatch = line.match(/(?:base_model|tokenizer for)\s+(\S+)/);
              if (modelMatch) baseModel = modelMatch[1];
            }

            // Detect LORA vs full fine-tune
            if (line.includes('LoRA') || line.includes('lora_rank')) {
              method = 'remote-lora';
            } else if (line.includes('FULL FINE-TUNING') || line.includes('full_finetune')) {
              method = 'fine-tune';
            }

            // Early exit if we have all critical metadata
            if (startTime && baseModel && endTime) {
              break;
            }
          }

          // Use directory name for start time if not found in logs
          if (!startTime) {
            const dirMatch = runDir.match(/(\d{4}-\d{2}-\d{2})-(\d{6})/);
            if (dirMatch) {
              const date = dirMatch[1];
              const time = dirMatch[2];
              startTime = `${date}T${time.substring(0, 2)}:${time.substring(2, 4)}:${time.substring(4, 6)}Z`;
            }
          }

          const run: TrainingRun = {
            id: runDir,
            startTime: startTime || new Date().toISOString(),
            endTime: endTime || undefined,
            status,
            method,
            logFile: `${dateDir}/${runDir}/trainer.log`,
            fullLogPath: trainerLogPath,
            baseModel: baseModel || undefined,
            duration: startTime && endTime ? calculateDuration(startTime, endTime) : undefined,
            error: error || undefined,
          };

          runs.push(run);
        } catch (err) {
          // Skip invalid run directories
          console.warn(`[training/history] Failed to parse run ${runDir}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[training/history] Failed to scan run_logs directory:', err);
  }

  return runs;
}

/**
 * Parse audit logs to extract training run history (legacy)
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

        // Track full cycle starts (from /api/adapters fullCycle action)
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

        // Track training starts (from /api/training/launch endpoint)
        if (event === 'training_started') {
          const pid = entry.details?.pid;
          const method = entry.details?.method || 'unknown';
          const logPath = entry.details?.logPath;

          if (pid) {
            const run: TrainingRun = {
              id: `run-${pid}`,
              startTime: entry.timestamp,
              status: 'completed', // Default, will update if we find errors
              pid,
              method: method,
              logFile: logPath || `training-${pid}.log`, // Use logPath from audit or fallback
              baseModel: entry.details?.config?.base_model,
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
    // Parse both sources and merge
    const runLogsRuns = parseRunLogsDirectory();
    const auditRuns = parseTrainingHistory();

    // Merge runs, preferring docs/run_logs data (more detailed)
    const runsById = new Map<string, TrainingRun>();

    // Add audit runs first
    for (const run of auditRuns) {
      runsById.set(run.id, run);
    }

    // Overlay run_logs data (more authoritative)
    for (const run of runLogsRuns) {
      runsById.set(run.id, run);
    }

    const allRuns = Array.from(runsById.values())
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, 50);

    return new Response(
      JSON.stringify({
        success: true,
        runs: allRuns,
        count: allRuns.length,
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

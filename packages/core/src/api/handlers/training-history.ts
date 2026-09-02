/**
 * Training History API Handlers
 *
 * The training launcher owns one persisted process log per run under logs/run.
 * Terminal lifecycle markers are authoritative for new runs; older launcher
 * logs are classified from their explicit pipeline completion/failure output.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';

export interface TrainingRun {
  id: string;
  startTime: string;
  endTime?: string;
  status: 'completed' | 'failed' | 'cancelled' | 'incomplete';
  pid?: number;
  method: 'local-lora' | 'remote-lora' | 'fine-tune';
  logFile: string;
  username?: string;
  baseModel?: string;
  duration?: string;
  error?: string;
}

interface TrainingLifecycleMarker {
  status: 'completed' | 'failed' | 'cancelled';
  endedAt: string;
  pid?: number;
  username?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  error?: string;
}

const TRAINING_LOG_PATTERN = /^(full-cycle-local|full-cycle|fine-tune-cycle)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.log$/;
const LIFECYCLE_PREFIX = '[training-lifecycle] ';

function parseFileTimestamp(encoded: string): string {
  const match = encoded.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!match) throw new Error(`Invalid training log timestamp: ${encoded}`);
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function parseLifecycleMarker(content: string): TrainingLifecycleMarker | undefined {
  const markerLines = content
    .split('\n')
    .filter(line => line.startsWith(LIFECYCLE_PREFIX));
  if (markerLines.length === 0) return undefined;

  const raw = markerLines.at(-1)!.slice(LIFECYCLE_PREFIX.length);
  let marker: unknown;
  try {
    marker = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed training lifecycle marker: ${(error as Error).message}`);
  }

  if (!marker || typeof marker !== 'object') {
    throw new Error('Malformed training lifecycle marker: expected an object');
  }
  const candidate = marker as Record<string, unknown>;
  if (!['completed', 'failed', 'cancelled'].includes(String(candidate.status))) {
    throw new Error(`Malformed training lifecycle marker status: ${String(candidate.status)}`);
  }
  if (typeof candidate.endedAt !== 'string' || !Number.isFinite(Date.parse(candidate.endedAt))) {
    throw new Error('Malformed training lifecycle marker: endedAt must be an ISO timestamp');
  }

  return candidate as unknown as TrainingLifecycleMarker;
}

function lastIndexOfAny(content: string, markers: string[]): number {
  return markers.reduce((latest, marker) => Math.max(latest, content.lastIndexOf(marker)), -1);
}

function legacyOutcome(content: string): Pick<TrainingRun, 'status' | 'error'> {
  const completedAt = lastIndexOfAny(content, [
    '✅ [full-cycle] Training complete for user:',
    '[fine-tune-cycle] ===== PIPELINE COMPLETE =====',
  ]);
  const failedAt = lastIndexOfAny(content, [
    '[full-cycle] Remote training failed',
    '[full-cycle] failed:',
    '[fine-tune-cycle] ===== PIPELINE FAILED =====',
    '====== TRAINING FAILED ======',
    'TRAINING FAILED - Exit code',
    '[lora-trainer] An error occurred:',
  ]);

  if (failedAt > completedAt) {
    const errorMatch = content.match(/(?:\[full-cycle\] failed:|\[fine-tune-cycle\] Error:|\[lora-trainer\] An error occurred:)\s*(.+)/);
    return {
      status: 'failed',
      error: errorMatch?.[1]?.trim() || 'Training pipeline reported failure',
    };
  }
  if (completedAt >= 0) return { status: 'completed' };
  return {
    status: 'incomplete',
    error: 'Training process ended without an explicit terminal outcome',
  };
}

function inferUsername(content: string): string | undefined {
  return content.match(/Starting remote (?:full cycle|training) for (?:user:\s*)?([A-Za-z0-9_-]+)/)?.[1]
    || content.match(/Starting fine-tuning cycle for user:\s*([A-Za-z0-9_-]+)/)?.[1]
    || content.match(/Training complete for user:\s*([A-Za-z0-9_-]+)/)?.[1];
}

function inferBaseModel(content: string): string | undefined {
  return content.match(/(?:Training base model|Base model):\s*([^\s]+)/)?.[1];
}

function methodForAgent(agent: string): TrainingRun['method'] {
  if (agent === 'full-cycle-local') return 'local-lora';
  if (agent === 'fine-tune-cycle') return 'fine-tune';
  return 'remote-lora';
}

function calculateDuration(start: string, end: string): string | undefined {
  const difference = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(difference) || difference < 0) return undefined;

  const totalSeconds = Math.floor(difference / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function parseTrainingConsoleLog(
  fileName: string,
  content: string,
  modifiedAt: Date,
): TrainingRun {
  const match = fileName.match(TRAINING_LOG_PATTERN);
  if (!match) throw new Error(`Unsupported training log name: ${fileName}`);

  const startTime = parseFileTimestamp(match[2]);
  const lifecycle = parseLifecycleMarker(content);
  const legacy = lifecycle ? undefined : legacyOutcome(content);
  const status = lifecycle?.status || legacy!.status;
  const endTime = lifecycle?.endedAt || modifiedAt.toISOString();
  const exitDescription = lifecycle?.status === 'failed' && lifecycle.exitCode !== undefined
    ? `Training process exited with code ${String(lifecycle.exitCode)}`
    : undefined;

  return {
    id: fileName.slice(0, -'.log'.length),
    startTime,
    endTime,
    status,
    pid: lifecycle?.pid,
    method: methodForAgent(match[1]),
    logFile: fileName,
    username: lifecycle?.username || inferUsername(content),
    baseModel: inferBaseModel(content),
    duration: calculateDuration(startTime, endTime),
    error: lifecycle?.error || exitDescription || legacy?.error,
  };
}

export function readTrainingHistory(
  logsDirectory = path.join(systemPaths.logs, 'run'),
  limit = 50,
): TrainingRun[] {
  if (!fs.existsSync(logsDirectory)) return [];

  return fs.readdirSync(logsDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && TRAINING_LOG_PATTERN.test(entry.name))
    .map(entry => {
      const filePath = path.join(logsDirectory, entry.name);
      const stats = fs.statSync(filePath);
      return parseTrainingConsoleLog(entry.name, fs.readFileSync(filePath, 'utf8'), stats.mtime);
    })
    .sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime))
    .slice(0, limit);
}

export function readTrainingHistoryForUser(
  username: string,
  logsDirectory = path.join(systemPaths.logs, 'run'),
): TrainingRun[] {
  return readTrainingHistory(logsDirectory, Number.MAX_SAFE_INTEGER)
    .filter(run => run.username === username)
    .slice(0, 50);
}

/** GET /api/training/history - Get canonical training process history. */
export async function handleGetTrainingHistory(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const runs = readTrainingHistoryForUser(req.user.username);
    return successResponse({ success: true, runs, count: runs.length });
  } catch (error) {
    console.error('[training/history] GET error:', error);
    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to load training history',
      data: { success: false, runs: [] },
    };
  }
}

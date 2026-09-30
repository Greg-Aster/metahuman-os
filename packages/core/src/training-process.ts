import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from './paths.js'
import { safeWriteJSON } from './safe-file.js'
import { acquireLock } from './locks.js'
import { loadRunpodConfig } from './runpod-config.js'
import { terminateTrainingPod } from './providers/runpod.js'
import type { TrainingCleanupReceipt } from './training-schema.js'
import { getProfilePaths } from './path-builder.js'
import type { ProgressState } from './progress-tracker.js'

export interface TrainingRun {
  id: string;
  startTime: string;
  endTime?: string;
  status: 'completed' | 'failed' | 'cancelled' | 'incomplete';
  pid?: number;
  runLabel?: string;
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
  runLabel?: string;
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
    runLabel: lifecycle?.runLabel,
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

/** Resolve console access by the persisted run identity, never by global recency. */
export function readTrainingLogForUser(username: string, fileName?: string): { fileName: string; lines: string[] } | null {
  const running = listTrainingProcesses().filter(item => item.username === username);
  const history = readTrainingHistoryForUser(username);
  const selected = fileName ?? running[0]?.logFile ?? history[0]?.logFile;
  if (!selected) return null;
  if (!TRAINING_LOG_PATTERN.test(selected) || (!running.some(item => item.logFile === selected)
      && !history.some(item => item.logFile === selected))) throw new Error('Training log is not owned by this profile');
  const directory = fs.realpathSync(path.join(systemPaths.logs, 'run'));
  const file = fs.realpathSync(path.join(directory, selected));
  if (path.dirname(file) !== directory) throw new Error('Training log escapes its directory');
  return { fileName: selected, lines: fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) };
}

/** Monitor projects the same run and terminal receipts shown in History. */
export function readTrainingOperations(username: string): Array<ProgressState & { isHung: boolean; elapsedSeconds: number }> {
  const running = listTrainingProcesses().filter(item => item.username === username);
  const history = readTrainingHistoryForUser(username);
  const labels = [...new Set([...running.map(item => item.runLabel), ...history.map(item => item.runLabel)])]
    .filter((label): label is string => typeof label === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(label)).sort().reverse().slice(0, 20);
  return labels.map(runLabel => {
    const live = running.find(item => item.runLabel === runLabel);
    const terminal = history.find(item => item.runLabel === runLabel);
    const root = path.join(getProfilePaths(username).out, 'adapters', runLabel.slice(0, 10), runLabel);
    const file = path.join(root, 'run.json');
    const run = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
    if (run && (run.username !== username || run.runLabel !== runLabel)) throw new Error('Training operation profile identity is invalid');
    const operation = 'lora-training-' + runLabel;
    const progressFile = path.join(systemPaths.root, 'metahuman-runs', username, runLabel.slice(0, 10), runLabel, operation + '.json');
    const detail: ProgressState | undefined = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, 'utf8')) : undefined;
    if (detail && detail.operation !== operation) throw new Error('Training progress identity is invalid');
    const completed = terminal?.status === 'completed' && !live;
    const status = live ? 'running' as const : completed ? 'completed' as const : 'failed' as const;
    const startTime = run?.startedAt ?? terminal?.startTime ?? parseFileTimestamp(runLabel);
    const endTime = live ? undefined : terminal?.endTime;
    const currentStage = live?.cancelRequestedAt ? 'cancelling' : run?.status ?? (live ? 'starting' : terminal?.status ?? 'incomplete');
    return {
      operation, overallStatus: status, overallProgress: completed ? 100 : detail?.overallProgress ?? 0,
      currentStage, stages: detail?.stages ?? [{ name: currentStage, status: live ? 'in_progress' : completed ? 'completed' : 'failed' }],
      startTime, lastHeartbeat: detail?.lastHeartbeat ?? startTime, endTime,
      error: terminal?.error ?? run?.error,
      metadata: { ...detail?.metadata, model: run?.baseModel, samples: run?.trainingSamples, runLabel, username, cancelling: Boolean(live?.cancelRequestedAt) },
      isHung: Boolean(live && detail && Date.now() - Date.parse(detail.lastHeartbeat) > 120_000),
      elapsedSeconds: Math.max(0, Math.floor(((endTime ? Date.parse(endTime) : Date.now()) - Date.parse(startTime)) / 1000)),
    };
  });
}

function cleanupReceipts(username?: string): Array<TrainingCleanupReceipt & { username: string; file: string }> {
  const root = path.join(systemPaths.root, 'metahuman-runs');
  if (!fs.existsSync(root)) return [];
  const receipts: Array<TrainingCleanupReceipt & { username: string; file: string }> = [];
  for (const user of fs.readdirSync(root, { withFileTypes: true })) {
    if (!user.isDirectory() || (username && user.name !== username)) continue;
    const userRoot = path.join(root, user.name);
    for (const date of fs.readdirSync(userRoot, { withFileTypes: true })) {
      if (!date.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(date.name)) continue;
      for (const run of fs.readdirSync(path.join(userRoot, date.name), { withFileTypes: true })) {
        if (!run.isDirectory() || !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(run.name) || !run.name.startsWith(date.name)) continue;
        const file = path.join(userRoot, date.name, run.name, 'run-summary.json');
        if (!fs.existsSync(file)) continue;
        if (fs.realpathSync(file) !== path.join(fs.realpathSync(root), user.name, date.name, run.name, 'run-summary.json')) throw new Error('Training cleanup receipt escapes its run');
        const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (receipt.username !== user.name || receipt.runLabel !== run.name) throw new Error('Invalid training cleanup receipt identity');
        if (!receipt.creationRequestedAt || receipt.terminated === true) continue;
        if (receipt.podName !== 'metahuman-training-' + user.name + '-' + run.name) throw new Error('Invalid training pod receipt identity');
        receipts.push({ username: user.name, file, runLabel: run.name, podId: receipt.pod_id,
          podName: receipt.podName, error: receipt.termination_error ?? receipt.error });
      }
    }
  }
  return receipts;
}

export function listUnconfirmedTrainingCleanup(username?: string): TrainingCleanupReceipt[] {
  return cleanupReceipts(username).map(({ username: _username, file: _file, ...receipt }) => receipt);
}

/** Explicit recovery reuses the worker receipt and the same provider cleanup owner. */
export async function recoverTrainingCleanup(username: string, runLabel: string): Promise<{ confirmedAt: string }> {
  const lock = acquireLock('training-admission', { exitOnSignal: false });
  try {
    if (listTrainingProcesses().some(item => item.username === username && item.runLabel === runLabel)) throw new Error('The worker still owns cleanup; cancel it and wait for its terminal receipt');
    const receipt = cleanupReceipts(username).find(item => item.runLabel === runLabel);
    if (!receipt) throw new Error('No unconfirmed cleanup receipt belongs to this run');
    const provider = loadRunpodConfig(username);
    if (!provider.apiKey) throw new Error('Configure RunPod credentials to recover this run');
    const result = await terminateTrainingPod(provider.apiKey, { podId: receipt.podId, podName: receipt.podName });
    const saved = JSON.parse(fs.readFileSync(receipt.file, 'utf8'));
    safeWriteJSON(receipt.file, { ...saved, pod_id: result.podId, terminated: true, cleanupConfirmedAt: result.confirmedAt, termination_error: null });
    return { confirmedAt: result.confirmedAt };
  } finally { lock.release(); }
}

export const TRAINING_PROCESS_NAMES = [
  'full-cycle',
  'full-cycle-local',
  'fine-tune-cycle',
] as const

export type TrainingProcessName = (typeof TRAINING_PROCESS_NAMES)[number]

export interface TrackedTrainingProcess {
  name: TrainingProcessName
  pid: number
  username?: string
  runLabel?: string
  logFile?: string
  workDirectory?: string
  cancelRequestedAt?: string
}

export interface TrainingTerminalOutcome {
  status: 'completed' | 'failed' | 'cancelled'
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  error?: string
}

function readProcessRecord(name: TrainingProcessName): TrackedTrainingProcess | null {
  const file = pidPath(name)
  if (!fs.existsSync(file)) return null
  const stored: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  // Existing PID-only receipts remain readable in the same storage owner;
  // every new launch writes identity and lifecycle metadata atomically.
  if (typeof stored === 'number') return { name, pid: stored }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('Invalid training process receipt: ' + name)
  const record = stored as TrackedTrainingProcess
  if (record.name !== name || !Number.isSafeInteger(record.pid)) throw new Error('Invalid training process identity: ' + name)
  return record
}

/** The worker records completion even when the web/CLI launcher has exited. */
export function finalizeTrainingProcess(name: TrainingProcessName, pid: number, outcome: TrainingTerminalOutcome): boolean {
  const record = readProcessRecord(name)
  if (!record || record.pid !== pid) return false
  if (record.logFile) {
    if (path.basename(record.logFile) !== record.logFile || !record.logFile.startsWith(name + '-') || !record.logFile.endsWith('.log')) {
      throw new Error('Invalid training lifecycle log identity')
    }
    const logPath = path.join(systemPaths.logs, 'run', record.logFile)
    const previousLine = fs.readFileSync(logPath, 'utf8').split('\n').reverse().find(line => line.startsWith('[training-lifecycle] '))
    if (previousLine) {
      const previous = JSON.parse(previousLine.slice('[training-lifecycle] '.length))
      if (previous.pid === pid && previous.runLabel === record.runLabel) {
        releaseTrainingProcess(name, pid)
        return false
      }
    }
    fs.appendFileSync(logPath, '\n[training-lifecycle] ' + JSON.stringify({
      ...outcome, endedAt: new Date().toISOString(), agent: name, pid,
      username: record.username, runLabel: record.runLabel,
    }) + '\n')
  }
  releaseTrainingProcess(name, pid)
  return true
}

function pidPath(name: TrainingProcessName): string {
  return path.join(systemPaths.logs, 'run', `${name}.pid`)
}

function removePidFile(name: TrainingProcessName): void {
  fs.rmSync(pidPath(name), { force: true })
}

function isExpectedTrainingProcess(name: TrainingProcessName, pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false

  try {
    process.kill(pid, 0)
  } catch {
    return false
  }

  // A stale PID file can outlive its process and the PID can later be reused.
  // Linux exposes enough identity to avoid signalling an unrelated process.
  const commandPath = `/proc/${pid}/cmdline`
  if (process.platform === 'linux' && fs.existsSync(commandPath)) {
    try {
      const command = fs.readFileSync(commandPath, 'utf8').split('\0').join(' ')
      return command.includes(`${name}.ts`)
    } catch {
      return false
    }
  }

  return true
}

export function listTrainingProcesses(): TrackedTrainingProcess[] {
  const running: TrackedTrainingProcess[] = []

  for (const name of TRAINING_PROCESS_NAMES) {
    const file = pidPath(name)
    if (!fs.existsSync(file)) continue

    const record = readProcessRecord(name)!
    const pid = record.pid
    if (!isExpectedTrainingProcess(name, pid)) {
      finalizeTrainingProcess(name, pid, { status: 'failed', error: 'Training process ended without a terminal receipt' })
      continue
    }

    running.push(record)
  }

  return running
}

export function trackTrainingProcess(name: TrainingProcessName, pid: number, details: Omit<TrackedTrainingProcess, 'name' | 'pid'> = {}): void {
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error(`Invalid training process PID: ${pid}`)
  }

  const runDirectory = path.join(systemPaths.logs, 'run')
  const destination = pidPath(name)
  const temporary = `${destination}.tmp.${process.pid}`

  fs.mkdirSync(runDirectory, { recursive: true })
  try {
    fs.writeFileSync(temporary, JSON.stringify({ ...details, name, pid }) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, destination)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

export function releaseTrainingProcess(name: TrainingProcessName, pid: number): void {
  const file = pidPath(name)
  if (!fs.existsSync(file)) return

  const trackedPid = readProcessRecord(name)?.pid
  if (trackedPid === pid) removePidFile(name)
}

export function stopTrainingProcesses(username?: string): TrackedTrainingProcess[] {
  const stopped: TrackedTrainingProcess[] = []

  for (const trainingProcess of listTrainingProcesses()) {
    if (username && trainingProcess.username !== username) continue
    const { name, pid, ...details } = trainingProcess
    trackTrainingProcess(name, pid, { ...details, cancelRequestedAt: new Date().toISOString() })
    try {
      // Training jobs are launched detached, so the PID is also their process
      // group ID. Stopping the group includes trainer and converter children.
      process.kill(-trainingProcess.pid, 'SIGTERM')
    } catch {
      try {
        process.kill(trainingProcess.pid, 'SIGTERM')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }

    // Keep identity until the worker/provider cleanup reaches a terminal state.
    stopped.push(trainingProcess)
  }

  return stopped
}

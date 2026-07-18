import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../paths.js';
import { getQueueManager } from '../queue/index.js';
import type { QueuedTask } from '../queue/types.js';
import type {
  EnvironmentAction,
  EnvironmentActionQueueOptions,
  EnvironmentActionType,
  EnvironmentBridgeState,
  EnvironmentBridgeSummary,
  EnvironmentCommandWork,
  EnvironmentFeedback,
  EnvironmentObservation,
  EnvironmentSessionState,
  EnvironmentTextEvent,
} from './types.js';
import {
  assertBoundedMotionPlanEncoding,
  normalizeEnvironmentMotionPlanFields,
} from './motion-plan.js';

const STATE_FILE = path.join(systemPaths.run, 'environment-bridge-state.json');
const STALE_AFTER_MS = 45_000;
const FUTURE_CLOCK_SKEW_MS = 5_000;
const MAX_FEEDBACK = 200;
const MAX_PROCESSED_TEXT_EVENTS = 1_000;
const DEFAULT_MAX_ACTION_DURATION_MS = 1_500;
const MAX_CONTROL_ACTION_AGE_MS = 2_000;
const ACTION_TYPES = new Set<EnvironmentActionType>([
  'move', 'look', 'jump', 'interact', 'stop', 'captureImage', 'robotCommand', 'robotMotionPlan', 'sendText',
]);
const NON_REPLAYABLE_ACTION_TYPES = new Set<EnvironmentActionType>([
  'move', 'look', 'jump', 'interact', 'stop', 'captureImage', 'robotCommand', 'robotMotionPlan',
]);

type ActionSubscriber = () => void;
type BridgeStateSubscriber = () => void;
const actionSubscribers = new Map<string, Set<ActionSubscriber>>();
const bridgeStateSubscribers = new Set<BridgeStateSubscriber>();
let bridgeStateNotificationPending = false;

function nowIso(): string {
  return new Date().toISOString();
}

function defaultState(): EnvironmentBridgeState {
  return { enabled: false, updatedAt: nowIso(), sessions: {}, feedback: [] };
}

function boundedFeedback(items: EnvironmentFeedback[]): EnvironmentFeedback[] {
  const seen = new Set<string>();
  const unique: EnvironmentFeedback[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.unshift(item);
  }
  return unique.slice(-MAX_FEEDBACK);
}

function normalizeState(value: Partial<EnvironmentBridgeState> | null | undefined): EnvironmentBridgeState {
  const fallback = defaultState();
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : fallback.enabled,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : fallback.updatedAt,
    sessions: value?.sessions && typeof value.sessions === 'object' ? value.sessions : {},
    feedback: Array.isArray(value?.feedback) ? boundedFeedback(value.feedback) : [],
  };
}

function sessionLastSeenMs(session: Pick<EnvironmentSessionState, 'lastSeenAt'>): number {
  const timestamp = Date.parse(session.lastSeenAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionStatus(session: EnvironmentSessionState, now = Date.now()): EnvironmentSessionState['status'] {
  const lastSeen = sessionLastSeenMs(session);
  if (!lastSeen || lastSeen - now > FUTURE_CLOCK_SKEW_MS || now - lastSeen > STALE_AFTER_MS) return 'stale';
  return session.status;
}

function environmentTasks(): QueuedTask[] {
  const manager = getQueueManager();
  return [...manager.getAllTasks(), ...manager.getHistory()]
    .filter(task => task.type === 'environment_command');
}

function commandStatus(task: QueuedTask): EnvironmentCommandWork['status'] {
  if (task.state === 'queued' || task.state === 'waiting') return 'pending';
  if (task.state === 'leased') return 'dispatched';
  if (task.state === 'completed') return 'accepted';
  if (task.state === 'cancelled') return 'cancelled';
  if (task.state === 'expired') return 'expired';
  if (task.state === 'failed') return 'failed';
  return 'rejected';
}

function commandView(task: QueuedTask): EnvironmentCommandWork {
  const action = task.input as Omit<EnvironmentAction, 'id' | 'createdAt'>;
  const feedback = task.result?.feedback as EnvironmentFeedback | undefined;
  return {
    id: task.id,
    createdAt: task.createdAt,
    ...action,
    status: commandStatus(task),
    dispatchedAt: task.startedAt,
    completedAt: task.completedAt,
    result: feedback,
    correlationId: task.correlationId,
  };
}

export function getEnvironmentBridgeStatePath(): string {
  return STATE_FILE;
}

export function readEnvironmentBridgeState(): EnvironmentBridgeState {
  try {
    if (!fs.existsSync(STATE_FILE)) return defaultState();
    return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return defaultState();
  }
}

export function writeEnvironmentBridgeState(state: EnvironmentBridgeState): EnvironmentBridgeState {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const next = normalizeState({ ...state, updatedAt: nowIso() });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  notifyEnvironmentBridgeStateSubscribers();
  return next;
}

export function summarizeEnvironmentBridgeState(state = readEnvironmentBridgeState()): EnvironmentBridgeSummary {
  const now = Date.now();
  const sessions = Object.values(state.sessions).map(session => ({
    ...session,
    status: sessionStatus(session, now),
  }));
  const pendingCommandCount = getQueueManager().getAllTasks()
    .filter(task => task.type === 'environment_command').length;
  return {
    enabled: state.enabled,
    updatedAt: state.updatedAt,
    sessionCount: sessions.length,
    pendingCommandCount,
    sessions,
  };
}

export function setEnvironmentBridgeEnabled(enabled: boolean): EnvironmentBridgeState {
  const state = readEnvironmentBridgeState();
  state.enabled = enabled;
  const next = writeEnvironmentBridgeState(state);
  notifyEnvironmentActionSubscribers();
  return next;
}

export function publishEnvironmentObservation(
  observation: EnvironmentObservation,
  options: { username?: string; graph?: string } = {},
): { summary: EnvironmentBridgeSummary; workId: string } {
  const state = readEnvironmentBridgeState();
  const existing = state.sessions[observation.sessionId];
  const now = nowIso();
  state.sessions[observation.sessionId] = {
    sessionId: observation.sessionId,
    environmentId: observation.environmentId,
    adapter: observation.adapter,
    status: 'connected',
    firstSeenAt: existing?.firstSeenAt ?? observation.timestamp ?? now,
    lastSeenAt: observation.timestamp ?? now,
    latestObservation: observation,
    processedTextEventIds: existing?.processedTextEventIds ?? [],
  };
  if (observation.feedback?.length) {
    state.feedback = boundedFeedback([...state.feedback, ...observation.feedback]);
  }
  const summary = summarizeEnvironmentBridgeState(writeEnvironmentBridgeState(state));
  const work = getQueueManager().enqueue({
    type: 'environment_observation',
    handler: 'environment.observation',
    resource: 'local-llm',
    source: 'environment',
    priority: 'high',
    input: { observation, graph: options.graph },
    username: options.username || 'system',
    cognitiveMode: 'environment',
    correlationId: typeof observation.metadata?.correlationId === 'string'
      ? observation.metadata.correlationId
      : observation.feedback?.find(item => item.actionId)?.actionId,
    idempotencyKey: `environment-observation:${observation.sessionId}:${observation.timestamp}`,
    maxAttempts: 1,
    metadata: {
      producer: 'environment-bridge',
      sessionId: observation.sessionId,
      robotObserver: observation.metadata?.robotObserver,
    },
  });
  return { summary, workId: work.id };
}

export function touchEnvironmentSession(sessionId: string): EnvironmentBridgeSummary {
  const state = readEnvironmentBridgeState();
  const session = state.sessions[sessionId];
  if (!session) return summarizeEnvironmentBridgeState(state);
  session.lastSeenAt = nowIso();
  session.status = 'connected';
  state.sessions[sessionId] = session;
  return summarizeEnvironmentBridgeState(writeEnvironmentBridgeState(state));
}

export function claimEnvironmentTextEvents(observation: EnvironmentObservation): EnvironmentTextEvent[] {
  const state = readEnvironmentBridgeState();
  const session = state.sessions[observation.sessionId];
  if (!session) return [];
  const processed = new Set(session.processedTextEventIds ?? []);
  const claimed = (observation.text ?? []).filter(event => {
    if (!event.id || !event.text.trim() || processed.has(event.id)) return false;
    processed.add(event.id);
    return true;
  });
  if (claimed.length === 0) return [];
  session.processedTextEventIds = [...processed].slice(-MAX_PROCESSED_TEXT_EVENTS);
  writeEnvironmentBridgeState(state);
  return claimed;
}

export function getLatestEnvironmentObservation(sessionId?: string): EnvironmentObservation | undefined {
  const state = readEnvironmentBridgeState();
  if (sessionId) return state.sessions[sessionId]?.latestObservation;
  const now = Date.now();
  return Object.values(state.sessions)
    .filter(session => sessionStatus(session, now) === 'connected')
    .sort((a, b) => sessionLastSeenMs(b) - sessionLastSeenMs(a))[0]
    ?.latestObservation;
}

export function getEnvironmentFeedback(options: { actionId?: string; limit?: number } = {}): EnvironmentFeedback[] {
  const state = readEnvironmentBridgeState();
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit!)) : 20;
  return (options.actionId ? state.feedback.filter(item => item.actionId === options.actionId) : state.feedback)
    .slice(-limit);
}

function normalizeAction(
  action: Partial<EnvironmentAction>,
  options: EnvironmentActionQueueOptions,
): Omit<EnvironmentAction, 'id' | 'createdAt'> {
  if (!action.type || !ACTION_TYPES.has(action.type)) throw new Error(`Invalid environment action type: ${String(action.type ?? '')}`);
  const allowed = options.allowedActions?.length ? new Set(options.allowedActions) : ACTION_TYPES;
  if (!allowed.has(action.type)) throw new Error(`Environment action type is not allowed: ${action.type}`);

  const maxDurationMs = Number.isFinite(options.maxDurationMs)
    ? Math.max(1, Math.floor(options.maxDurationMs!))
    : DEFAULT_MAX_ACTION_DURATION_MS;
  let durationMs = action.durationMs;
  if (durationMs !== undefined) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error(`Invalid durationMs: ${String(durationMs)}`);
    durationMs = Math.min(maxDurationMs, Math.floor(durationMs));
  } else if (action.type === 'move' || action.type === 'look') {
    if (!Number.isFinite(options.defaultDurationMs) || options.defaultDurationMs! <= 0) {
      throw new Error(`Environment action "${action.type}" requires durationMs`);
    }
    durationMs = Math.min(maxDurationMs, Math.floor(options.defaultDurationMs!));
  }
  if (action.type === 'sendText' && !action.text?.trim()) throw new Error('Environment sendText action requires text');
  if (action.type === 'robotCommand' && !action.command?.trim()) throw new Error('Environment robotCommand action requires a semantic command');
  const motionPlan = action.type === 'robotMotionPlan'
    ? normalizeEnvironmentMotionPlanFields(action)
    : undefined;
  if (motionPlan) assertBoundedMotionPlanEncoding({
    type: action.type,
    frames: motionPlan.frames,
    endPose: motionPlan.endPose,
  });

  const sessionId = action.sessionId || options.sessionId || getLatestEnvironmentObservation()?.sessionId;
  if (!sessionId) throw new Error('Environment action requires a connected target session');
  return {
    type: action.type,
    sessionId,
    text: action.text?.trim(),
    vector: action.vector,
    direction: action.direction,
    command: action.command?.trim(),
    units: typeof action.units === 'number' ? Math.max(0, Math.floor(action.units)) : undefined,
    amount: typeof action.amount === 'number' ? Math.max(0, Math.min(1, action.amount)) : undefined,
    durationMs,
    target: action.target,
    frames: motionPlan?.frames,
    endPose: motionPlan?.endPose,
    metadata: action.metadata,
  };
}

export function enqueueEnvironmentAction(
  action: Partial<EnvironmentAction>,
  options: EnvironmentActionQueueOptions = {},
): EnvironmentCommandWork {
  const normalized = normalizeAction(action, options);
  const sessionId = normalized.sessionId!;
  const manager = getQueueManager();
  if (normalized.type === 'stop') {
    for (const task of manager.getAllTasks()) {
      if (
        task.type === 'environment_command'
        && task.input.sessionId === sessionId
        && task.input.type !== 'stop'
        && (task.state === 'queued' || task.state === 'waiting')
      ) manager.cancel(task.id, 'Superseded by semantic stop');
    }
  }

  const sourceCreatedAt = action.createdAt ? Date.parse(action.createdAt) : Date.now();
  const deadline = NON_REPLAYABLE_ACTION_TYPES.has(normalized.type)
    ? new Date((Number.isFinite(sourceCreatedAt) ? sourceCreatedAt : Date.now()) + MAX_CONTROL_ACTION_AGE_MS).toISOString()
    : undefined;
  const task = manager.enqueue({
    type: 'environment_command',
    handler: 'environment.command',
    resource: normalized.type === 'stop' ? `environment-stop:${sessionId}` : `environment:${sessionId}`,
    source: options.source || 'system',
    priority: normalized.type === 'stop' ? 'critical' : 'normal',
    input: normalized,
    username: options.username || 'system',
    cognitiveMode: 'environment',
    deadline,
    correlationId: options.correlationId,
    idempotencyKey: options.idempotencyKey,
    maxAttempts: 1,
    metadata: { producer: 'environment-interface', sessionId },
  });
  notifyEnvironmentActionSubscribers(sessionId);
  return commandView(task);
}

export function enqueueConnectedEnvironmentStops(
  username: string,
  reason = 'Active Operator emergency stop',
  now = Date.now(),
): EnvironmentCommandWork[] {
  const state = readEnvironmentBridgeState();
  if (!state.enabled) return [];
  return Object.values(state.sessions)
    .filter(session => session.status === 'connected')
    .map(session => enqueueEnvironmentAction(
      {
        type: 'stop',
        sessionId: session.sessionId,
        createdAt: new Date(now).toISOString(),
        metadata: { reason },
      },
      {
        username,
        source: 'user',
        idempotencyKey: `operator-emergency-stop:${session.sessionId}:${Math.floor(now / 1_000)}`,
      },
    ));
}

export function dispatchEnvironmentActions(sessionId: string, limit = 10): EnvironmentCommandWork[] {
  const state = readEnvironmentBridgeState();
  if (!state.enabled || !state.sessions[sessionId]) return [];
  const manager = getQueueManager();
  const claimed: EnvironmentCommandWork[] = [];
  while (claimed.length < Math.max(1, limit)) {
    const next = manager.getNextExecutable(task =>
      task.type === 'environment_command'
      && task.handler === 'environment.command'
      && task.input.sessionId === sessionId);
    if (!next) break;
    const task = manager.claim(next.id, `environment-adapter:${sessionId}`);
    if (!task) break;
    claimed.push(commandView(task));
  }
  return claimed;
}

export function subscribeEnvironmentActions(sessionId: string, subscriber: ActionSubscriber): () => void {
  const subscribers = actionSubscribers.get(sessionId) ?? new Set<ActionSubscriber>();
  subscribers.add(subscriber);
  actionSubscribers.set(sessionId, subscribers);
  notifyEnvironmentBridgeStateSubscribers();
  return () => {
    const current = actionSubscribers.get(sessionId);
    current?.delete(subscriber);
    if (current?.size === 0) actionSubscribers.delete(sessionId);
    notifyEnvironmentBridgeStateSubscribers();
  };
}

export function subscribeEnvironmentBridgeState(subscriber: BridgeStateSubscriber): () => void {
  bridgeStateSubscribers.add(subscriber);
  return () => { bridgeStateSubscribers.delete(subscriber); };
}

export function getEnvironmentActionSubscriberCount(sessionId?: string): number {
  if (sessionId) return actionSubscribers.get(sessionId)?.size ?? 0;
  return [...actionSubscribers.values()].reduce((total, subscribers) => total + subscribers.size, 0);
}

function notifyEnvironmentActionSubscribers(sessionId?: string): void {
  const subscribers = sessionId
    ? actionSubscribers.get(sessionId)
    : new Set([...actionSubscribers.values()].flatMap(set => [...set]));
  for (const subscriber of subscribers ?? []) queueMicrotask(subscriber);
}

function notifyEnvironmentBridgeStateSubscribers(): void {
  if (bridgeStateNotificationPending || bridgeStateSubscribers.size === 0) return;
  bridgeStateNotificationPending = true;
  queueMicrotask(() => {
    bridgeStateNotificationPending = false;
    for (const subscriber of bridgeStateSubscribers) subscriber();
  });
}

export function recordEnvironmentActionResult(feedback: EnvironmentFeedback): EnvironmentCommandWork | undefined {
  if (!feedback.actionId) return undefined;

  const manager = getQueueManager();
  const task = manager.getTask(feedback.actionId);
  if (!task || task.type !== 'environment_command') return undefined;
  if (task.state === 'leased') {
    if (feedback.type === 'accepted' || feedback.type === 'completed') {
      manager.complete(task.id, true, { deliveryStatus: feedback.type, feedback });
    } else if (feedback.type === 'cancelled') {
      manager.cancel(task.id, feedback.message);
      manager.acknowledgeCancellation(task.id);
    } else if (feedback.type === 'expired') {
      manager.complete(task.id, false, { code: 'adapter_expired', message: feedback.message, retryable: false });
    } else if (feedback.type === 'failed' || feedback.type === 'rejected') {
      manager.complete(task.id, false, { code: `adapter_${feedback.type}`, message: feedback.message, retryable: false });
    }
  } else if (task.state === 'queued' || task.state === 'waiting') {
    if (feedback.type === 'cancelled') manager.cancel(task.id, feedback.message);
    if (feedback.type === 'expired') manager.expire(task.id);
  }
  return commandView(manager.getTask(task.id) || task);
}

getQueueManager().addEventListener(event => {
  if (!event.taskId) return;
  const task = getQueueManager().getTask(event.taskId);
  if (task?.type !== 'environment_command') return;
  notifyEnvironmentActionSubscribers(String(task.input.sessionId || ''));
  notifyEnvironmentBridgeStateSubscribers();
});

import fs from 'node:fs';
import path from 'node:path';
import { generateId, systemPaths } from '../paths.js';
import type {
  EnvironmentAction,
  EnvironmentActionQueueOptions,
  EnvironmentActionType,
  EnvironmentBridgeState,
  EnvironmentBridgeSummary,
  EnvironmentConnectionConfig,
  EnvironmentFeedback,
  EnvironmentTextEvent,
  EnvironmentObservation,
  EnvironmentSessionState,
  QueuedEnvironmentAction,
} from './types.js';

const STATE_FILE = path.join(systemPaths.run, 'environment-bridge-state.json');
const STALE_AFTER_MS = 15_000;
const FUTURE_CLOCK_SKEW_MS = 5_000;
const MAX_FEEDBACK = 200;
const MAX_ACTIONS = 500;
const MAX_PROCESSED_TEXT_EVENTS = 1000;
const DEFAULT_MAX_ACTION_DURATION_MS = 1500;
const ACTION_TYPES = new Set<EnvironmentActionType>([
  'move',
  'look',
  'jump',
  'interact',
  'stop',
  'sendText',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function sessionLastSeenMs(session: Pick<EnvironmentSessionState, 'lastSeenAt'>): number {
  const timestamp = Date.parse(session.lastSeenAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionStatus(session: EnvironmentSessionState, now = Date.now()): EnvironmentSessionState['status'] {
  const lastSeen = sessionLastSeenMs(session);
  if (!lastSeen || lastSeen - now > FUTURE_CLOCK_SKEW_MS || now - lastSeen > STALE_AFTER_MS) {
    return 'stale';
  }
  return session.status;
}

function sessionSortMs(session: EnvironmentSessionState, now = Date.now()): number {
  const lastSeen = sessionLastSeenMs(session);
  return lastSeen && lastSeen - now <= FUTURE_CLOCK_SKEW_MS ? lastSeen : 0;
}

function defaultState(): EnvironmentBridgeState {
  return {
    enabled: false,
    updatedAt: nowIso(),
    connections: {},
    sessions: {},
    queuedActions: [],
    feedback: [],
  };
}

function ensureStateDir(): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
}

function normalizeState(value: Partial<EnvironmentBridgeState> | null | undefined): EnvironmentBridgeState {
  const fallback = defaultState();
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : fallback.enabled,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : fallback.updatedAt,
    connections: value?.connections && typeof value.connections === 'object' ? value.connections : {},
    sessions: value?.sessions && typeof value.sessions === 'object' ? value.sessions : {},
    queuedActions: Array.isArray(value?.queuedActions) ? value.queuedActions : [],
    feedback: Array.isArray(value?.feedback) ? value.feedback : [],
  };
}

export function getEnvironmentBridgeStatePath(): string {
  return STATE_FILE;
}

export function readEnvironmentBridgeState(): EnvironmentBridgeState {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return defaultState();
    }
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<EnvironmentBridgeState>;
    return normalizeState(parsed);
  } catch {
    return defaultState();
  }
}

export function writeEnvironmentBridgeState(state: EnvironmentBridgeState): EnvironmentBridgeState {
  ensureStateDir();
  const next = normalizeState({ ...state, updatedAt: nowIso() });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function summarizeEnvironmentBridgeState(state = readEnvironmentBridgeState()): EnvironmentBridgeSummary {
  const now = Date.now();
  const sessions = Object.values(state.sessions).map(session => {
    return { ...session, status: sessionStatus(session, now) };
  });

  return {
    enabled: state.enabled,
    updatedAt: state.updatedAt,
    sessionCount: sessions.length,
    queuedActionCount: state.queuedActions.filter(action => action.status === 'queued').length,
    sessions,
  };
}

export function setEnvironmentBridgeEnabled(enabled: boolean): EnvironmentBridgeState {
  const state = readEnvironmentBridgeState();
  state.enabled = enabled;
  return writeEnvironmentBridgeState(state);
}

export function upsertEnvironmentConnection(
  connection: Partial<EnvironmentConnectionConfig> & Pick<EnvironmentConnectionConfig, 'adapter' | 'url'>,
): EnvironmentConnectionConfig {
  const state = readEnvironmentBridgeState();
  const id = connection.id?.trim() || `${connection.adapter}:${connection.url}`;
  const existing = state.connections[id];
  const timestamp = nowIso();
  const next: EnvironmentConnectionConfig = {
    id,
    adapter: connection.adapter,
    enabled: connection.enabled !== false,
    url: connection.url,
    hostName: connection.hostName?.trim() || undefined,
    roomName: connection.roomName?.trim() || undefined,
    graphName: connection.graphName?.trim() || existing?.graphName || 'environment-mode',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    metadata: connection.metadata ?? existing?.metadata,
  };

  state.connections[id] = next;
  writeEnvironmentBridgeState(state);
  return next;
}

export function listEnvironmentConnections(options: { enabledOnly?: boolean } = {}): EnvironmentConnectionConfig[] {
  const connections = Object.values(readEnvironmentBridgeState().connections);
  return options.enabledOnly ? connections.filter(connection => connection.enabled) : connections;
}

export function getEnvironmentConnection(id: string): EnvironmentConnectionConfig | undefined {
  return readEnvironmentBridgeState().connections[id];
}

export function publishEnvironmentObservation(observation: EnvironmentObservation): EnvironmentBridgeSummary {
  const state = readEnvironmentBridgeState();
  const existing = state.sessions[observation.sessionId];
  const now = nowIso();
  const session: EnvironmentSessionState = {
    sessionId: observation.sessionId,
    environmentId: observation.environmentId,
    adapter: observation.adapter,
    status: 'connected',
    firstSeenAt: existing?.firstSeenAt ?? observation.timestamp ?? now,
    lastSeenAt: observation.timestamp ?? now,
    latestObservation: observation,
    processedTextEventIds: existing?.processedTextEventIds ?? [],
  };

  state.sessions[observation.sessionId] = session;
  if (observation.feedback?.length) {
    state.feedback = [...state.feedback, ...observation.feedback].slice(-MAX_FEEDBACK);
  }

  return summarizeEnvironmentBridgeState(writeEnvironmentBridgeState(state));
}

export function claimEnvironmentTextEvents(observation: EnvironmentObservation): EnvironmentTextEvent[] {
  const state = readEnvironmentBridgeState();
  const session = state.sessions[observation.sessionId];
  if (!session) {
    return [];
  }

  const processed = new Set(session.processedTextEventIds ?? []);
  const claimed: EnvironmentTextEvent[] = [];

  for (const event of observation.text ?? []) {
    if (!event.id || !event.text.trim() || processed.has(event.id)) {
      continue;
    }

    processed.add(event.id);
    claimed.push(event);
  }

  if (claimed.length === 0) {
    return [];
  }

  session.processedTextEventIds = Array.from(processed).slice(-MAX_PROCESSED_TEXT_EVENTS);
  state.sessions[observation.sessionId] = session;
  writeEnvironmentBridgeState(state);
  return claimed;
}

export function getLatestEnvironmentObservation(sessionId?: string): EnvironmentObservation | undefined {
  const state = readEnvironmentBridgeState();
  if (sessionId) {
    return state.sessions[sessionId]?.latestObservation;
  }

  const latest = Object.values(state.sessions)
    .map(session => {
      const now = Date.now();
      return { session, status: sessionStatus(session, now), sortMs: sessionSortMs(session, now) };
    })
    .sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (a.status !== 'connected' && b.status === 'connected') return 1;
      return b.sortMs - a.sortMs;
    })[0];

  return latest?.status === 'connected' ? latest.session.latestObservation : undefined;
}

export function getEnvironmentFeedback(options: { actionId?: string; limit?: number } = {}): EnvironmentFeedback[] {
  const state = readEnvironmentBridgeState();
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit!)) : 20;
  const feedback = options.actionId
    ? state.feedback.filter(entry => entry.actionId === options.actionId)
    : state.feedback;

  return feedback.slice(-limit);
}

function normalizeQueuedAction(
  action: Partial<EnvironmentAction>,
  options: EnvironmentActionQueueOptions = {},
): Omit<EnvironmentAction, 'id' | 'createdAt'> {
  if (!action.type || !ACTION_TYPES.has(action.type)) {
    throw new Error(`Invalid environment action type: ${String(action.type ?? '')}`);
  }

  const allowedActions = options.allowedActions?.length ? new Set(options.allowedActions) : ACTION_TYPES;
  if (!allowedActions.has(action.type)) {
    throw new Error(`Environment action type is not allowed: ${action.type}`);
  }

  const maxDurationMs = Number.isFinite(options.maxDurationMs)
    ? Math.max(1, Math.floor(options.maxDurationMs!))
    : DEFAULT_MAX_ACTION_DURATION_MS;
  let durationMs = action.durationMs;

  if (durationMs !== undefined) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error(`Invalid durationMs for environment action: ${String(durationMs)}`);
    }
    durationMs = Math.min(maxDurationMs, Math.floor(durationMs));
  } else if (action.type === 'move' || action.type === 'look') {
    if (!Number.isFinite(options.defaultDurationMs) || options.defaultDurationMs! <= 0) {
      throw new Error(`Environment action "${action.type}" requires durationMs`);
    }
    durationMs = Math.min(maxDurationMs, Math.floor(options.defaultDurationMs!));
  }

  if (action.type === 'sendText' && !action.text?.trim()) {
    throw new Error('Environment sendText action requires text');
  }

  return {
    type: action.type,
    sessionId: action.sessionId,
    text: action.text?.trim(),
    vector: action.vector,
    direction: action.direction,
    amount: typeof action.amount === 'number' ? Math.max(0, Math.min(1, action.amount)) : undefined,
    durationMs,
    target: action.target,
    metadata: action.metadata,
  };
}

export function enqueueEnvironmentAction(
  action: Partial<EnvironmentAction>,
  options: EnvironmentActionQueueOptions = {},
): QueuedEnvironmentAction {
  const state = readEnvironmentBridgeState();
  const normalized = normalizeQueuedAction(action, options);
  const queued: QueuedEnvironmentAction = {
    id: typeof action.id === 'string' && action.id.length > 0
      ? action.id
      : `${generateId('env-action')}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: typeof action.createdAt === 'string' ? action.createdAt : nowIso(),
    ...normalized,
    status: 'queued',
  };

  state.queuedActions = [...state.queuedActions, queued].slice(-MAX_ACTIONS);
  writeEnvironmentBridgeState(state);
  return queued;
}

export function claimEnvironmentActions(sessionId: string, limit = 10): QueuedEnvironmentAction[] {
  const state = readEnvironmentBridgeState();
  const claimed: QueuedEnvironmentAction[] = [];

  state.queuedActions = state.queuedActions.map(action => {
    if (
      claimed.length < limit &&
      action.status === 'queued' &&
      (!action.sessionId || action.sessionId === sessionId)
    ) {
      const next = { ...action, sessionId, status: 'dispatched' as const, dispatchedAt: nowIso() };
      claimed.push(next);
      return next;
    }
    return action;
  });

  writeEnvironmentBridgeState(state);
  return claimed;
}

export function recordEnvironmentActionResult(feedback: EnvironmentFeedback): QueuedEnvironmentAction | undefined {
  const state = readEnvironmentBridgeState();
  let updated: QueuedEnvironmentAction | undefined;

  state.feedback = [...state.feedback, feedback].slice(-MAX_FEEDBACK);
  if (feedback.actionId) {
    state.queuedActions = state.queuedActions.map(action => {
      if (action.id !== feedback.actionId) {
        return action;
      }
      updated = {
        ...action,
        status: feedback.type === 'failed' || feedback.type === 'rejected' ? feedback.type : 'completed',
        completedAt: feedback.timestamp,
        result: feedback,
      };
      return updated;
    });
  }

  writeEnvironmentBridgeState(state);
  return updated;
}

import { get, writable } from 'svelte/store';
import { apiFetch } from '../client/api-config';
import { connectionPool, ConnectionPriority, type ConnectionHandle } from '../client/connection-pool';
import type { AutonomyMode } from '../client/active-operator-modes';

export type TriggerLifecycle = 'scheduled-work' | 'workflow' | 'service';
export type TriggerType = 'interval' | 'time-of-day' | 'event' | 'activity' | 'manual';

export interface TriggerView {
  id: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  lifecycle: TriggerLifecycle;
  type: TriggerType;
  handler: string;
  priority: 'low' | 'normal' | 'high';
  resource?: string;
  allowedModes: AutonomyMode[];
  startupPolicy: 'skip' | 'run-once' | 'recover-missed';
  interval?: number;
  schedule?: string;
  inactivityThreshold?: number;
  eventPattern?: string;
  eventCountThreshold?: number;
  eventCountField?: string;
  idleResetSeconds?: number;
  probability?: number;
  jitterMs?: number;
  maxRetries: number;
  nextRun?: string;
  dueInMs?: number;
  lastDueAt?: string;
  lastAdmittedAt?: string;
  lastOutcome?: string;
  lastSuppressionReason?: string;
  runCount: number;
  errorCount: number;
  suppressionCount: number;
  lastTaskId?: string;
  lastTaskState?: string;
  handlerRegistered: boolean;
  sourceResolvable: boolean;
  eligibleInCurrentMode: boolean;
}

export interface TriggerManagerSnapshot {
  lifecycle: 'starting' | 'running' | 'paused' | 'degraded' | 'stopped';
  running: boolean;
  admissionPaused: boolean;
  admissionEnabled: boolean;
  autonomyMode: AutonomyMode;
  serverTime: string;
  timezone: string;
  nextWakeAt?: string;
  lastEvaluationAt?: string;
  clockLagMs?: number;
  config: {
    scope: 'system' | 'profile';
    persistedRevision?: number;
    runtimeRevision?: number;
    loadedAt?: string;
    error?: string;
  };
  globalSettings: {
    pauseAll: boolean;
    timezone: string;
    quietHours?: { enabled: boolean; start: string; end: string };
    [key: string]: unknown;
  };
  triggers: TriggerView[];
  recentAdmissions: Array<{
    triggerId: string;
    taskId: string;
    admittedAt: string;
    state?: string;
    outcome?: string;
  }>;
  healthFindings: string[];
}

export type TriggerConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting';

export const triggerManagerSnapshot = writable<TriggerManagerSnapshot | null>(null);
export const triggerManagerConnection = writable<TriggerConnectionState>('idle');
export const triggerManagerError = writable('');

let streamHandle: ConnectionHandle | null = null;
let users = 0;

function applySnapshot(snapshot: TriggerManagerSnapshot | undefined): void {
  if (!snapshot) return;
  triggerManagerSnapshot.set(snapshot);
  triggerManagerError.set('');
}

export async function refreshTriggerManager(): Promise<TriggerManagerSnapshot> {
  const response = await apiFetch('/api/trigger-manager', { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false || !data.snapshot) {
    throw new Error(data.error || `Trigger Manager request failed: ${response.status}`);
  }
  applySnapshot(data.snapshot);
  return data.snapshot;
}

function connect(): void {
  if (streamHandle || typeof window === 'undefined') return;
  triggerManagerConnection.set('connecting');
  streamHandle = connectionPool.request({
    id: 'trigger-manager-shared-stream',
    name: 'Trigger Manager shared stream',
    url: '/api/trigger-manager/stream',
    priority: ConnectionPriority.MEDIUM,
    defer: true,
    onOpen: () => {
      triggerManagerConnection.set('live');
      triggerManagerError.set('');
    },
    onClose: () => triggerManagerConnection.set('reconnecting'),
    onError: () => triggerManagerConnection.set('reconnecting'),
    onMessage: event => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) throw new Error(data.error);
        applySnapshot(data.snapshot);
      } catch (error) {
        triggerManagerError.set((error as Error).message);
      }
    },
  });
}

export function useTriggerManager(): () => void {
  users += 1;
  if (users === 1) {
    void refreshTriggerManager().catch(error => triggerManagerError.set((error as Error).message));
    connect();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users = Math.max(0, users - 1);
    if (users === 0) {
      streamHandle?.close();
      streamHandle = null;
      triggerManagerConnection.set('idle');
    }
  };
}

async function control(action: string, extra: Record<string, unknown> = {}): Promise<any> {
  const response = await apiFetch('/api/trigger-manager/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `Trigger Manager control failed: ${response.status}`);
  applySnapshot(data.snapshot);
  return data;
}

export async function setTriggerAdmissionPaused(paused: boolean): Promise<void> {
  const before = get(triggerManagerSnapshot);
  if (before) {
    triggerManagerSnapshot.set({
      ...before,
      admissionPaused: paused,
      admissionEnabled: !paused && before.running && before.autonomyMode !== 'reactive',
      lifecycle: paused ? 'paused' : before.lifecycle === 'paused' ? 'running' : before.lifecycle,
      globalSettings: { ...before.globalSettings, pauseAll: paused },
    });
  }
  try {
    await control(paused ? 'pause-admission' : 'resume-admission');
  } catch (error) {
    if (before) triggerManagerSnapshot.set(before);
    throw error;
  }
}

export async function reloadTriggerConfig(): Promise<void> {
  await control('reload-config');
}

export async function runTriggerNow(triggerId: string, args: string[] = []): Promise<string> {
  const data = await control('run-now', { triggerId, args });
  return data.taskId;
}

export async function patchTriggerConfig(patch: Record<string, unknown>): Promise<TriggerManagerSnapshot> {
  const response = await apiFetch('/api/trigger-manager/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false || !data.snapshot) {
    throw new Error(data.error || `Trigger Manager configuration failed: ${response.status}`);
  }
  applySnapshot(data.snapshot);
  return data.snapshot;
}

export async function setActiveOperatorMode(mode: AutonomyMode): Promise<void> {
  const before = get(triggerManagerSnapshot);
  if (before) {
    triggerManagerSnapshot.set({
      ...before,
      autonomyMode: mode,
      admissionEnabled: before.running && !before.admissionPaused && mode !== 'reactive',
    });
  }
  try {
    const response = await apiFetch('/api/active-operator/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-mode', mode }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || `Active Operator mode change failed: ${response.status}`);
    await refreshTriggerManager();
  } catch (error) {
    if (before) triggerManagerSnapshot.set(before);
    throw error;
  }
}

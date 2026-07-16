/**
 * Configured proactive work producer.
 *
 * TriggerManager owns clocks, due evaluation, and admission records. It never
 * executes work or owns queue ordering.
 */

import { EventEmitter } from 'node:events';
import { audit } from '../audit.js';
import {
  readLastActiveUsername,
  readSystemActivityTimestamp,
  recordSystemActivity,
} from '../system-activity.js';
import { agentHandlerId, agentTaskType, defaultAgentLifecycle } from './agent-work-catalog.js';
import {
  priorityForTriggeredWork,
  type AgentTriggerConfig,
  type TriggerConfigRead,
  type TriggerManagerConfig,
  type TriggerType,
} from './trigger-config-service.js';
import type { AutonomyMode, QueueEvent, QueuedTask, TaskInput } from './types.js';
import { UnifiedQueueManager } from './unified-queue-manager.js';

export type { AgentTriggerConfig, TriggerManagerConfig, TriggerType } from './trigger-config-service.js';

export type TriggerManagerLifecycle = 'running' | 'paused' | 'degraded' | 'stopped';
export type TriggerSuppressionReason =
  | 'disabled'
  | 'mode:reactive'
  | 'mode:not-allowed'
  | 'global-pause'
  | 'quiet-hours'
  | 'condition'
  | 'probability'
  | 'duplicate'
  | 'invalid-handler'
  | 'unresolved-source'
  | 'queue-unavailable'
  | 'service-owned';

export interface TriggerState {
  config: AgentTriggerConfig;
  timerId?: NodeJS.Timeout;
  jitterTimerId?: NodeJS.Timeout;
  lastRun?: Date;
  nextRun?: Date;
  lastDueAt?: Date;
  lastAdmittedAt?: Date;
  lastTaskId?: string;
  lastOutcome?: string;
  lastSuppressionReason?: TriggerSuppressionReason;
  lastSuppressionKey?: string;
  runCount: number;
  errorCount: number;
  suppressionCount: number;
  lastAdmissionKey?: string;
  eventCounts: Map<string, number>;
  lastEventAt?: Date;
  lastEventUsername?: string;
}

export interface TriggerHandlerHealth {
  registered: boolean;
  sourceResolvable: boolean;
}

export interface TriggerView {
  id: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  lifecycle: AgentTriggerConfig['lifecycle'];
  type: TriggerType;
  handler: string;
  priority: AgentTriggerConfig['priority'];
  resource?: string;
  allowedModes: AutonomyMode[];
  startupPolicy: AgentTriggerConfig['startupPolicy'];
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
  lastSuppressionReason?: TriggerSuppressionReason;
  runCount: number;
  errorCount: number;
  suppressionCount: number;
  lastTaskId?: string;
  lastTaskState?: QueuedTask['state'];
  handlerRegistered: boolean;
  sourceResolvable: boolean;
  eligibleInCurrentMode: boolean;
}

export interface TriggerManagerSnapshot {
  lifecycle: TriggerManagerLifecycle;
  running: boolean;
  admissionPaused: boolean;
  admissionEnabled: boolean;
  autonomyMode: AutonomyMode;
  serverTime: string;
  timezone: string;
  nextWakeAt?: string;
  lastEvaluationAt?: string;
  clockLagMs: number;
  config: {
    scope: 'system';
    persistedRevision?: number;
    runtimeRevision?: number;
    loadedAt?: string;
    error?: string;
  };
  globalSettings: TriggerManagerConfig['globalSettings'];
  triggers: TriggerView[];
  recentAdmissions: Array<{
    triggerId: string;
    taskId: string;
    admittedAt: string;
    state?: QueuedTask['state'];
    outcome?: string;
  }>;
  healthFindings: string[];
}

type HandlerInspector = (config: AgentTriggerConfig) => TriggerHandlerHealth;

interface TriggerFireContext {
  username?: string;
  admissionKey?: string;
  triggerData?: Record<string, unknown>;
  idleReset?: boolean;
}

function zonedClock(date: Date, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return {
    hour: Number(parts.find(part => part.type === 'hour')?.value ?? 0),
    minute: Number(parts.find(part => part.type === 'minute')?.value ?? 0),
  };
}

function nextTimeOfDay(schedule: string, timezone: string, now = Date.now()): Date | undefined {
  const [targetHour, targetMinute] = schedule.split(':').map(Number);
  if (!Number.isInteger(targetHour) || !Number.isInteger(targetMinute)) return undefined;
  const firstMinute = Math.floor(now / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset < 72 * 60; offset += 1) {
    const candidate = new Date(firstMinute + offset * 60_000);
    const clock = zonedClock(candidate, timezone);
    if (clock.hour === targetHour && clock.minute === targetMinute) return candidate;
  }
  return undefined;
}

export class TriggerManager extends EventEmitter {
  private config: TriggerManagerConfig;
  private readonly triggers = new Map<string, TriggerState>();
  private running = false;
  private activityTimer?: NodeJS.Timeout;
  private lastActivity = new Date();
  private lastActiveUsername: string | null = null;
  private autonomyMode: AutonomyMode = 'reactive';
  private lastEvaluationAt?: Date;
  private clockLagMs = 0;
  private configScope: 'system' = 'system';
  private persistedRevision?: number;
  private runtimeRevision?: number;
  private configLoadedAt?: string;
  private configError?: string;
  private eventSequence = 0;
  private inspectHandler: HandlerInspector = () => ({ registered: true, sourceResolvable: true });
  private readonly queueListener: (event: QueueEvent) => void;

  constructor(
    private readonly queueManager: UnifiedQueueManager,
    config?: TriggerManagerConfig,
  ) {
    super();
    this.config = config ?? {
      version: '1.0.0',
      revision: 0,
      globalSettings: {
        pauseAll: false,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
      agents: {},
    };
    if (config) this.configure(config);
    this.queueListener = event => this.onQueueEvent(event);
    this.queueManager.addEventListener(this.queueListener);
  }

  setHandlerInspector(inspector: HandlerInspector): void {
    this.inspectHandler = inspector;
  }

  applyConfig(read: TriggerConfigRead): void {
    this.configScope = read.scope;
    this.persistedRevision = read.revision;
    this.runtimeRevision = read.revision;
    this.configLoadedAt = read.loadedAt;
    this.configError = undefined;
    this.configure(read.config);
  }

  markConfigError(error: unknown): void {
    this.configError = (error as Error).message;
    this.emitState('configError');
  }

  configure(config: TriggerManagerConfig): void {
    const previous = new Map(this.triggers);
    for (const state of previous.values()) this.clearStateTimers(state);
    this.config = config;
    this.triggers.clear();
    for (const [agentId, agentConfig] of Object.entries(config.agents)) {
      const prior = previous.get(agentId);
      this.triggers.set(agentId, {
        config: { ...agentConfig, id: agentConfig.id || agentId },
        lastRun: prior?.lastRun,
        lastDueAt: prior?.lastDueAt,
        lastAdmittedAt: prior?.lastAdmittedAt,
        lastTaskId: prior?.lastTaskId,
        lastOutcome: prior?.lastOutcome,
        lastSuppressionReason: prior?.lastSuppressionReason,
        lastSuppressionKey: prior?.lastSuppressionKey,
        runCount: prior?.runCount ?? 0,
        errorCount: prior?.errorCount ?? 0,
        suppressionCount: prior?.suppressionCount ?? 0,
        lastAdmissionKey: prior?.lastAdmissionKey,
        eventCounts: prior?.eventCounts ?? new Map(),
        lastEventAt: prior?.lastEventAt ?? (agentConfig.type === 'event' ? new Date() : undefined),
        lastEventUsername: prior?.lastEventUsername,
      });
    }
    if (this.running) this.scheduleAll();
    this.emitState('configChanged');
  }

  registerTrigger(config: Partial<AgentTriggerConfig> & Pick<AgentTriggerConfig, 'id' | 'enabled' | 'type' | 'priority'>): void {
    const normalized: AgentTriggerConfig = {
      ...config,
      id: config.id,
      enabled: config.enabled,
      type: config.type,
      lifecycle: config.lifecycle ?? defaultAgentLifecycle(config.id),
      handler: config.handler ?? agentHandlerId(config.id),
      priority: config.priority,
      allowedModes: config.allowedModes ?? (config.type === 'manual' || config.type === 'event'
        ? ['reactive', 'semi', 'full']
        : ['semi', 'full']),
      startupPolicy: config.startupPolicy ?? 'skip',
    };
    const existing = this.triggers.get(config.id);
    if (existing) this.clearStateTimers(existing);
    this.triggers.set(config.id, {
      config: normalized,
      runCount: existing?.runCount ?? 0,
      errorCount: existing?.errorCount ?? 0,
      suppressionCount: existing?.suppressionCount ?? 0,
      eventCounts: existing?.eventCounts ?? new Map(),
      lastEventAt: existing?.lastEventAt ?? (config.type === 'event' ? new Date() : undefined),
      lastEventUsername: existing?.lastEventUsername,
    });
    if (this.running && config.enabled) this.schedule(config.id);
    this.emitState('configChanged');
  }

  unregisterTrigger(agentId: string): void {
    const existing = this.triggers.get(agentId);
    if (existing) this.clearStateTimers(existing);
    this.triggers.delete(agentId);
    this.emitState('configChanged');
  }

  start(): boolean {
    if (this.running) return true;
    this.running = true;
    this.syncLastActivityFromDisk();
    this.scheduleAll();
    this.activityTimer = setInterval(() => this.evaluateActivityTriggers(), 30_000);
    this.activityTimer.unref?.();
    audit({ level: 'info', category: 'system', event: 'trigger_manager_started', actor: 'trigger_manager', details: { triggerCount: this.triggers.size } });
    this.emitState('lifecycle');
    return true;
  }

  stop(): boolean {
    if (!this.running) return true;
    this.running = false;
    for (const state of this.triggers.values()) {
      this.clearStateTimers(state);
      state.nextRun = undefined;
    }
    if (this.activityTimer) clearInterval(this.activityTimer);
    this.activityTimer = undefined;
    audit({ level: 'info', category: 'system', event: 'trigger_manager_stopped', actor: 'trigger_manager' });
    this.emitState('lifecycle');
    return true;
  }

  dispose(): void {
    this.stop();
    this.queueManager.removeEventListener(this.queueListener);
    this.removeAllListeners();
  }

  setAutonomyMode(mode: AutonomyMode): void {
    if (this.autonomyMode === mode) return;
    this.autonomyMode = mode;
    this.emitState('modeChanged');
  }

  pauseAll(): void {
    this.config.globalSettings.pauseAll = true;
    this.emitState('admissionChanged');
  }

  resumeAll(): void {
    this.config.globalSettings.pauseAll = false;
    this.emitState('admissionChanged');
  }

  private scheduleAll(): void {
    for (const [agentId, state] of this.triggers) {
      if (state.config.enabled && state.config.lifecycle !== 'service') this.schedule(agentId);
    }
  }

  private clearStateTimers(state: TriggerState): void {
    if (state.timerId) clearTimeout(state.timerId);
    if (state.jitterTimerId) clearTimeout(state.jitterTimerId);
    state.timerId = undefined;
    state.jitterTimerId = undefined;
  }

  private schedule(agentId: string): void {
    const state = this.triggers.get(agentId);
    if (!state || !this.running || !state.config.enabled || state.config.lifecycle === 'service') return;
    if (state.timerId) clearTimeout(state.timerId);
    state.timerId = undefined;

    if (state.config.type === 'activity' && state.config.inactivityThreshold) {
      state.nextRun = new Date(this.lastActivity.getTime() + state.config.inactivityThreshold * 1_000);
      return;
    }
    if (state.config.type === 'manual') {
      state.nextRun = undefined;
      return;
    }
    if (state.config.type === 'event') {
      state.nextRun = state.config.idleResetSeconds
        ? new Date((state.lastEventAt ?? new Date()).getTime() + state.config.idleResetSeconds * 1_000)
        : undefined;
      return;
    }

    let delay: number | undefined;
    if (state.config.startupPolicy !== 'skip' && !state.lastDueAt) {
      delay = 1_000;
    } else if (state.config.type === 'interval' && state.config.interval) {
      delay = state.config.interval * 1_000;
    } else if (state.config.type === 'time-of-day' && state.config.schedule) {
      const next = nextTimeOfDay(state.config.schedule, this.config.globalSettings.timezone);
      if (next) delay = next.getTime() - Date.now();
    }
    if (delay === undefined) return;

    state.nextRun = new Date(Date.now() + Math.max(1, delay));
    state.timerId = setTimeout(() => {
      this.clockLagMs = Math.max(0, Date.now() - (state.nextRun?.getTime() ?? Date.now()));
      state.timerId = undefined;
      this.fireTrigger(agentId, state.config.type);
      this.schedule(agentId);
    }, Math.max(1, delay));
    state.timerId.unref?.();
  }

  private idempotencyKey(agentId: string, state: TriggerState, now: number): string {
    if (state.config.type === 'activity') return `activity:${agentId}:${this.lastActivity.toISOString()}`;
    if (state.config.type === 'time-of-day') return `time-of-day:${agentId}:${new Date(now).toISOString().slice(0, 10)}`;
    if (state.config.type === 'event') {
      const debounceMs = state.config.debounce ?? 0;
      return debounceMs > 0
        ? `event:${agentId}:${Math.floor(now / debounceMs)}`
        : `event:${agentId}:${now}:${++this.eventSequence}`;
    }
    const intervalMs = Math.max(1_000, (state.config.interval || 60) * 1_000);
    return `interval:${agentId}:${Math.floor(now / intervalMs)}`;
  }

  private suppress(agentId: string, state: TriggerState, reason: TriggerSuppressionReason, dueKey: string): null {
    const suppressionKey = `${dueKey}:${reason}`;
    state.lastOutcome = 'suppressed';
    state.lastSuppressionReason = reason;
    if (state.lastSuppressionKey !== suppressionKey) {
      state.suppressionCount += 1;
      state.lastSuppressionKey = suppressionKey;
      audit({
        level: reason === 'invalid-handler' || reason === 'unresolved-source' ? 'error' : 'info',
        category: 'system',
        event: 'trigger_suppressed',
        actor: 'trigger_manager',
        details: { agentId, reason, dueKey },
      });
      this.emit('suppressed', { agentId, reason, dueKey });
      this.emitState('suppressed');
    }
    return null;
  }

  private enqueueAgent(
    agentId: string,
    state: TriggerState,
    triggerType: TriggerType,
    username: string,
    now: number,
    args: string[] = [],
    fireContext: TriggerFireContext = {},
  ): string | null {
    const admissionKey = triggerType === 'manual'
      ? undefined
      : fireContext.admissionKey ?? this.idempotencyKey(agentId, state, now);
    const dueKey = admissionKey || `manual:${agentId}:${now}`;
    if (admissionKey && state.lastAdmissionKey === admissionKey) return this.suppress(agentId, state, 'duplicate', dueKey);
    const taskInput: TaskInput = {
      type: agentTaskType(agentId),
      handler: state.config.handler || agentHandlerId(agentId),
      resource: state.config.resource,
      source: triggerType === 'manual' ? 'user' : triggerType === 'event' ? 'system' : 'timer',
      priority: triggerType === 'manual' ? state.config.priority : priorityForTriggeredWork(state.config.priority),
      input: {
        agentId,
        args,
        configuredAgentPath: state.config.agentPath,
        triggeredBy: triggerType,
        usesLLM: state.config.usesLLM ?? true,
        triggerData: fireContext.triggerData || {},
      },
      username: fireContext.username || username,
      maxAttempts: Math.max(1, (state.config.maxRetries ?? 0) + 1),
      idempotencyKey: admissionKey,
      metadata: { producer: 'trigger-manager', triggerId: agentId, triggerType },
    };
    try {
      const task = this.queueManager.enqueue(taskInput);
      state.lastAdmissionKey = admissionKey;
      state.lastRun = new Date(now);
      state.lastAdmittedAt = new Date(now);
      state.lastTaskId = task.id;
      state.lastOutcome = 'admitted';
      state.lastSuppressionReason = undefined;
      state.runCount += 1;
      this.emit('trigger', { agentId, taskId: task.id, taskType: task.type });
      audit({
        level: 'info',
        category: 'action',
        event: 'trigger_fired',
        actor: 'trigger_manager',
        details: { agentId, taskId: task.id, handler: task.handler, triggerType, runCount: state.runCount },
      });
      this.emitState('admitted');
      return task.id;
    } catch {
      state.errorCount += 1;
      state.lastOutcome = 'failed';
      state.lastSuppressionReason = 'queue-unavailable';
      audit({
        level: 'error',
        category: 'system',
        event: 'trigger_admission_failed',
        actor: 'trigger_manager',
        details: { agentId, reason: 'queue-unavailable' },
      });
      this.emitState('error');
      return null;
    }
  }

  private fireTrigger(
    agentId: string,
    triggerType: TriggerType,
    jitterApplied = false,
    args: string[] = [],
    fireContext: TriggerFireContext = {},
  ): string | null {
    const state = this.triggers.get(agentId);
    if (!state) return null;
    const now = Date.now();
    const dueKey = triggerType === 'manual'
      ? `manual:${agentId}:${now}`
      : fireContext.admissionKey ?? this.idempotencyKey(agentId, state, now);
    state.lastDueAt = new Date(now);
    this.lastEvaluationAt = new Date(now);
    if (!this.running && triggerType !== 'manual') return this.suppress(agentId, state, 'queue-unavailable', dueKey);
    if (!state.config.enabled) return this.suppress(agentId, state, 'disabled', dueKey);
    if (state.config.lifecycle === 'service') return this.suppress(agentId, state, 'service-owned', dueKey);
    if (!state.config.allowedModes.includes(this.autonomyMode)) {
      return this.suppress(agentId, state, this.autonomyMode === 'reactive' ? 'mode:reactive' : 'mode:not-allowed', dueKey);
    }
    if (this.config.globalSettings.pauseAll) return this.suppress(agentId, state, 'global-pause', dueKey);
    if (triggerType !== 'manual' && !fireContext.idleReset && this.isQuietHours()) return this.suppress(agentId, state, 'quiet-hours', dueKey);
    if (triggerType !== 'manual' && !fireContext.idleReset && !this.checkConditions(state.config)) return this.suppress(agentId, state, 'condition', dueKey);
    if (triggerType !== 'manual' && !fireContext.idleReset && Math.random() > (state.config.probability ?? 1)) {
      return this.suppress(agentId, state, 'probability', dueKey);
    }
    const handlerHealth = this.inspectHandler(state.config);
    if (!handlerHealth.registered) return this.suppress(agentId, state, 'invalid-handler', dueKey);
    if (!handlerHealth.sourceResolvable) return this.suppress(agentId, state, 'unresolved-source', dueKey);
    if (!jitterApplied && triggerType !== 'manual' && !fireContext.idleReset && (state.config.jitterMs || 0) > 0) {
      if (state.jitterTimerId) clearTimeout(state.jitterTimerId);
      state.lastOutcome = 'waiting-jitter';
      state.jitterTimerId = setTimeout(() => {
        state.jitterTimerId = undefined;
        this.fireTrigger(agentId, triggerType, true, args, fireContext);
      }, Math.floor(Math.random() * state.config.jitterMs!));
      state.jitterTimerId.unref?.();
      this.emitState('jitter');
      return null;
    }
    const username = fireContext.username || this.lastActiveUsername || readLastActiveUsername() || 'system';
    return this.enqueueAgent(agentId, state, triggerType, username, now, args, fireContext);
  }

  triggerManual(agentId: string, username?: string, args: string[] = []): string | null {
    const state = this.triggers.get(agentId);
    if (!state) return null;
    const previousUsername = this.lastActiveUsername;
    if (username) this.lastActiveUsername = username;
    try {
      return this.fireTrigger(agentId, 'manual', false, args);
    } finally {
      this.lastActiveUsername = previousUsername;
    }
  }

  triggerEvent(eventName: string, data?: Record<string, unknown>): string[] {
    const taskIds: string[] = [];
    for (const [agentId, state] of this.triggers) {
      if (!this.running || state.config.type !== 'event' || !state.config.enabled || !state.config.eventPattern) continue;
      const configuredPattern = state.config.eventPattern;
      const prefix = configuredPattern.endsWith('.*') ? configuredPattern.slice(0, -2) : configuredPattern;
      if (eventName === prefix || eventName.startsWith(`${prefix}.`)) {
        const username = typeof data?.username === 'string'
          ? data.username
          : typeof data?.userId === 'string' ? data.userId : undefined;
        const subject = username || 'system';
        state.lastEventAt = new Date();
        state.lastEventUsername = username;
        if (state.config.idleResetSeconds) {
          state.nextRun = new Date(state.lastEventAt.getTime() + state.config.idleResetSeconds * 1_000);
        }
        const threshold = state.config.eventCountThreshold ?? 1;
        const countField = state.config.eventCountField || 'count';
        let count = Number(data?.[countField]);
        if (!Number.isInteger(count) || count < 1) {
          count = (state.eventCounts.get(subject) || 0) + 1;
          state.eventCounts.set(subject, count);
        } else {
          state.eventCounts.set(subject, count);
        }
        if (count % threshold !== 0) continue;
        const admissionKey = threshold > 1
          ? `event-count:${agentId}:${subject}:${countField}:${count}`
          : undefined;
        const taskId = this.fireTrigger(agentId, 'event', false, [], {
          username,
          admissionKey,
          triggerData: { ...(data || {}), eventName, eventCount: count },
        });
        if (taskId) taskIds.push(taskId);
      }
    }
    return taskIds;
  }

  evaluateActivityTriggers(now = Date.now()): string[] {
    if (!this.running) return [];
    this.syncLastActivityFromDisk();
    this.lastEvaluationAt = new Date(now);
    const inactiveSeconds = (now - this.lastActivity.getTime()) / 1_000;
    const taskIds: string[] = [];
    for (const [agentId, state] of this.triggers) {
      if (state.config.type !== 'activity' || !state.config.enabled || !state.config.inactivityThreshold) continue;
      state.nextRun = new Date(this.lastActivity.getTime() + state.config.inactivityThreshold * 1_000);
      if (inactiveSeconds < state.config.inactivityThreshold) continue;
      const taskId = this.fireTrigger(agentId, 'activity');
      if (taskId) taskIds.push(taskId);
    }
    for (const [agentId, state] of this.triggers) {
      if (state.config.type !== 'event' || !state.config.enabled || !state.config.idleResetSeconds) continue;
      const lastEventAt = state.lastEventAt ?? this.lastActivity;
      const eventInactiveSeconds = (now - lastEventAt.getTime()) / 1_000;
      state.nextRun = new Date(lastEventAt.getTime() + state.config.idleResetSeconds * 1_000);
      if (eventInactiveSeconds < state.config.idleResetSeconds) continue;
      const username = state.lastEventUsername || this.lastActiveUsername || readLastActiveUsername() || undefined;
      const admissionKey = `idle-reset:${agentId}:${username || 'system'}:${lastEventAt.toISOString()}`;
      if (state.lastAdmissionKey === admissionKey) {
        state.nextRun = undefined;
        continue;
      }
      const taskId = this.fireTrigger(agentId, 'event', false, ['--baseline'], {
        username,
        admissionKey,
        idleReset: true,
        triggerData: { eventName: 'system.idle-reset', inactiveSeconds: eventInactiveSeconds, idleReset: true },
      });
      if (taskId) {
        taskIds.push(taskId);
        state.nextRun = undefined;
      }
    }
    this.emitState('evaluated');
    return taskIds;
  }

  recordActivity(username?: string): void {
    this.lastActivity = new Date();
    this.lastActiveUsername = username || null;
    recordSystemActivity(this.lastActivity.getTime(), username);
    for (const state of this.triggers.values()) {
      if (state.config.type === 'activity' && state.config.inactivityThreshold) {
        state.nextRun = new Date(this.lastActivity.getTime() + state.config.inactivityThreshold * 1_000);
      }
    }
    this.emit('activity', { timestamp: this.lastActivity, username });
    this.emitState('activity');
  }

  private syncLastActivityFromDisk(): void {
    const timestamp = readSystemActivityTimestamp();
    if (timestamp && timestamp > this.lastActivity.getTime()) this.lastActivity = new Date(timestamp);
    this.lastActiveUsername = readLastActiveUsername() || this.lastActiveUsername;
  }

  private isQuietHours(): boolean {
    const quiet = this.config.globalSettings.quietHours;
    if (!quiet?.enabled) return false;
    const currentClock = zonedClock(new Date(), this.config.globalSettings.timezone);
    const current = currentClock.hour * 60 + currentClock.minute;
    const [startHour, startMinute] = quiet.start.split(':').map(Number);
    const [endHour, endMinute] = quiet.end.split(':').map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    return start > end ? current >= start || current < end : current >= start && current < end;
  }

  private checkConditions(config: AgentTriggerConfig): boolean {
    if (config.conditions?.requiresSleepMode) return false;
    return true;
  }

  private onQueueEvent(event: QueueEvent): void {
    if (!event.taskId || !['task_completed', 'task_failed', 'task_cancelled', 'task_expired'].includes(event.type)) return;
    const state = [...this.triggers.values()].find(candidate => candidate.lastTaskId === event.taskId);
    if (!state) return;
    const task = this.queueManager.getTask(event.taskId);
    state.lastOutcome = task?.state || event.type.replace('task_', '');
    if (task?.state === 'failed') state.errorCount += 1;
    this.emitState('taskOutcome');
  }

  private emitState(reason: string): void {
    this.emit('stateChange', { reason, timestamp: new Date().toISOString() });
  }

  getTriggers(): Map<string, TriggerState> {
    return new Map(this.triggers);
  }

  getTriggerState(agentId: string): TriggerState | null {
    return this.triggers.get(agentId) || null;
  }

  getNextTriggers(): Array<{ agentId: string; nextRun: Date }> {
    return [...this.triggers.entries()]
      .filter((entry): entry is [string, TriggerState & { nextRun: Date }] => Boolean(entry[1].nextRun))
      .map(([agentId, state]) => ({ agentId, nextRun: state.nextRun }))
      .sort((left, right) => left.nextRun.getTime() - right.nextRun.getTime());
  }

  getLastActivity(): { timestamp: Date; username: string | null } {
    return { timestamp: this.lastActivity, username: this.lastActiveUsername };
  }

  isRunning(): boolean {
    return this.running;
  }

  getSnapshot(): TriggerManagerSnapshot {
    const now = Date.now();
    const triggers: TriggerView[] = [...this.triggers.entries()].map(([id, state]) => {
      const health = this.inspectHandler(state.config);
      const task = state.lastTaskId ? this.queueManager.getTask(state.lastTaskId) : undefined;
      return {
        id,
        displayName: state.config.displayName || id.split('-').map(part => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`).join(' '),
        description: state.config.description || state.config.comment,
        enabled: state.config.enabled,
        lifecycle: state.config.lifecycle,
        type: state.config.type,
        handler: state.config.handler,
        priority: state.config.priority,
        resource: state.config.resource,
        allowedModes: state.config.allowedModes,
        startupPolicy: state.config.startupPolicy,
        interval: state.config.interval,
        schedule: state.config.schedule,
        inactivityThreshold: state.config.inactivityThreshold,
        eventPattern: state.config.eventPattern,
        eventCountThreshold: state.config.eventCountThreshold,
        eventCountField: state.config.eventCountField,
        idleResetSeconds: state.config.idleResetSeconds,
        probability: state.config.probability,
        jitterMs: state.config.jitterMs,
        maxRetries: state.config.maxRetries ?? 0,
        nextRun: state.nextRun?.toISOString(),
        dueInMs: state.nextRun ? state.nextRun.getTime() - now : undefined,
        lastDueAt: state.lastDueAt?.toISOString(),
        lastAdmittedAt: state.lastAdmittedAt?.toISOString(),
        lastOutcome: state.lastOutcome,
        lastSuppressionReason: state.lastSuppressionReason,
        runCount: state.runCount,
        errorCount: state.errorCount,
        suppressionCount: state.suppressionCount,
        lastTaskId: state.lastTaskId,
        lastTaskState: task?.state,
        handlerRegistered: state.config.lifecycle === 'service' ? true : health.registered,
        sourceResolvable: state.config.lifecycle === 'service' ? true : health.sourceResolvable,
        eligibleInCurrentMode: state.config.allowedModes.includes(this.autonomyMode),
      };
    }).sort((left, right) => {
      if (left.nextRun && right.nextRun) return left.nextRun.localeCompare(right.nextRun);
      if (left.nextRun) return -1;
      if (right.nextRun) return 1;
      return left.displayName.localeCompare(right.displayName);
    });
    const healthFindings: string[] = [];
    if (this.configError) healthFindings.push(this.configError);
    if (this.persistedRevision !== undefined && this.runtimeRevision !== this.persistedRevision) {
      healthFindings.push('Persisted trigger configuration is not applied to the runtime.');
    }
    for (const trigger of triggers) {
      if (trigger.lifecycle !== 'service' && !trigger.handlerRegistered) healthFindings.push(`${trigger.displayName}: handler ${trigger.handler} is not registered.`);
      else if (trigger.lifecycle !== 'service' && !trigger.sourceResolvable) healthFindings.push(`${trigger.displayName}: executable source is not resolvable.`);
    }
    const nextWakeAt = triggers.find(trigger => trigger.nextRun)?.nextRun;
    const recentAdmissions = triggers
      .filter((trigger): trigger is TriggerView & { lastTaskId: string; lastAdmittedAt: string } => Boolean(trigger.lastTaskId && trigger.lastAdmittedAt))
      .sort((left, right) => right.lastAdmittedAt.localeCompare(left.lastAdmittedAt))
      .slice(0, 20)
      .map(trigger => ({
        triggerId: trigger.id,
        taskId: trigger.lastTaskId,
        admittedAt: trigger.lastAdmittedAt,
        state: trigger.lastTaskState,
        outcome: trigger.lastOutcome,
      }));
    return {
      lifecycle: this.configError ? 'degraded' : !this.running ? 'stopped' : this.config.globalSettings.pauseAll ? 'paused' : 'running',
      running: this.running,
      admissionPaused: this.config.globalSettings.pauseAll,
      admissionEnabled: this.running && !this.config.globalSettings.pauseAll && this.autonomyMode !== 'reactive',
      autonomyMode: this.autonomyMode,
      serverTime: new Date(now).toISOString(),
      timezone: this.config.globalSettings.timezone,
      nextWakeAt,
      lastEvaluationAt: this.lastEvaluationAt?.toISOString(),
      clockLagMs: this.clockLagMs,
      config: {
        scope: this.configScope,
        persistedRevision: this.persistedRevision,
        runtimeRevision: this.runtimeRevision,
        loadedAt: this.configLoadedAt,
        error: this.configError,
      },
      globalSettings: { ...this.config.globalSettings },
      triggers,
      recentAdmissions,
      healthFindings,
    };
  }
}

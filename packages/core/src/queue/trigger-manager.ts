/**
 * Configured proactive work producer.
 *
 * This component owns timers only. It cannot pause, order, claim, or execute
 * coordinator work.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { UnifiedQueueManager } from './unified-queue-manager.js';
import type { Priority, TaskInput, TaskType } from './types.js';
import { systemPaths } from '../path-builder.js';
import { storageClient } from '../storage-client.js';
import { audit } from '../audit.js';
import {
  readLastActiveUsername,
  readSystemActivityTimestamp,
  recordSystemActivity,
} from '../system-activity.js';

export type TriggerType = 'interval' | 'time-of-day' | 'event' | 'activity' | 'manual';

export interface AgentTriggerConfig {
  id: string;
  enabled: boolean;
  type: TriggerType;
  priority: 'low' | 'normal' | 'high';
  agentPath?: string;
  usesLLM?: boolean;
  interval?: number;
  schedule?: string;
  inactivityThreshold?: number;
  eventPattern?: string;
  debounce?: number;
  runOnBoot?: boolean;
  autoRestart?: boolean;
  maxRetries?: number;
  probability?: number;
  jitterMs?: number;
  pauseCategory?: 'interactive' | 'background';
  conditions?: { requiresSleepMode?: boolean; [key: string]: any };
}

export interface TriggerManagerConfig {
  version: string;
  globalSettings: {
    pauseAll: boolean;
    quietHours?: { enabled: boolean; start: string; end: string };
    pauseQueueOnActivity?: boolean;
    activityResumeDelay?: number;
    [key: string]: unknown;
  };
  agents: Record<string, AgentTriggerConfig>;
}

export interface TriggerState {
  config: AgentTriggerConfig;
  timerId?: NodeJS.Timeout;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  errorCount: number;
  lastAdmissionKey?: string;
}

const AGENT_TASK_MAP: Record<string, TaskType> = {
  organizer: 'memory_curate',
  curator: 'training_curate',
  reflector: 'reflect',
  curiosity: 'curiosity',
  'curiosity-researcher': 'inner_curiosity',
  'inner-curiosity': 'inner_curiosity',
  dreamer: 'dream',
  'sleep-workflow': 'sleep_workflow',
  psychoanalyzer: 'psychoanalyze',
  'desire-generator': 'desire_generate',
  'desire-executor': 'desire_execute',
  'auto-indexer': 'index_build',
};

export class TriggerManager extends EventEmitter {
  private config: TriggerManagerConfig | null = null;
  private readonly triggers = new Map<string, TriggerState>();
  private running = false;
  private activityTimer?: NodeJS.Timeout;
  private lastActivity = new Date();
  private lastActiveUsername: string | null = null;

  constructor(
    private readonly queueManager: UnifiedQueueManager,
    config?: TriggerManagerConfig,
  ) {
    super();
    if (config) this.configure(config);
  }

  configure(config: TriggerManagerConfig): void {
    this.config = config;
    this.triggers.clear();
    for (const [agentId, agentConfig] of Object.entries(config.agents)) {
      this.triggers.set(agentId, {
        config: { ...agentConfig, id: agentConfig.id || agentId },
        runCount: 0,
        errorCount: 0,
      });
    }
  }

  registerTrigger(config: AgentTriggerConfig): void {
    const existing = this.triggers.get(config.id);
    if (existing?.timerId) clearTimeout(existing.timerId);
    this.triggers.set(config.id, {
      config: { ...config },
      runCount: existing?.runCount ?? 0,
      errorCount: existing?.errorCount ?? 0,
    });
    if (this.running && config.enabled && config.type !== 'manual') this.schedule(config.id);
  }

  unregisterTrigger(agentId: string): void {
    const existing = this.triggers.get(agentId);
    if (existing?.timerId) clearTimeout(existing.timerId);
    this.triggers.delete(agentId);
  }

  private get configPath(): string {
    const resolved = storageClient.resolvePath({ category: 'config', subcategory: 'etc', relativePath: 'agents.json' });
    return resolved.success && resolved.path ? resolved.path : path.join(systemPaths.etc, 'agents.json');
  }

  loadConfig(): boolean {
    try {
      if (!fs.existsSync(this.configPath)) throw new Error(`Trigger configuration not found: ${this.configPath}`);
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as TriggerManagerConfig;
      if (!parsed.agents || !parsed.globalSettings) throw new Error('agents.json is missing agents or globalSettings');
      this.configure(parsed);
      audit({
        level: 'info',
        category: 'system',
        event: 'trigger_config_loaded',
        actor: 'trigger_manager',
        details: { agentCount: this.triggers.size, pauseAll: parsed.globalSettings.pauseAll },
      });
      return true;
    } catch (error) {
      console.error('[TriggerManager] Failed to load config:', error);
      this.config = { version: '1.0.0', globalSettings: { pauseAll: false }, agents: {} };
      this.triggers.clear();
      return false;
    }
  }

  reloadConfig(): boolean {
    const restart = this.running;
    if (restart) this.stop();
    const loaded = this.loadConfig();
    if (restart) this.start();
    return loaded;
  }

  start(): boolean {
    if (this.running) return true;
    if (!this.config) this.loadConfig();
    this.running = true;
    this.syncLastActivityFromDisk();
    for (const [agentId, state] of this.triggers) {
      if (state.config.enabled && state.config.type !== 'manual') this.schedule(agentId);
    }
    this.activityTimer = setInterval(() => this.evaluateActivityTriggers(), 30_000);
    this.activityTimer.unref?.();
    audit({ level: 'info', category: 'system', event: 'trigger_manager_started', actor: 'trigger_manager', details: { triggerCount: this.triggers.size } });
    return true;
  }

  stop(): boolean {
    this.running = false;
    for (const state of this.triggers.values()) {
      if (state.timerId) clearTimeout(state.timerId);
      state.timerId = undefined;
      state.nextRun = undefined;
    }
    if (this.activityTimer) clearInterval(this.activityTimer);
    this.activityTimer = undefined;
    audit({ level: 'info', category: 'system', event: 'trigger_manager_stopped', actor: 'trigger_manager' });
    return true;
  }

  pauseAll(): void {
    if (this.config) this.config.globalSettings.pauseAll = true;
  }

  resumeAll(): void {
    if (this.config) this.config.globalSettings.pauseAll = false;
  }

  private schedule(agentId: string): void {
    const state = this.triggers.get(agentId);
    if (!state || !this.running || !state.config.enabled) return;
    if (state.timerId) clearTimeout(state.timerId);

    let delay: number | undefined;
    if (state.config.type === 'interval' && state.config.interval) {
      delay = state.config.runOnBoot && !state.lastRun ? 1_000 : state.config.interval * 1_000;
    } else if (state.config.type === 'time-of-day' && state.config.schedule) {
      const [hours, minutes] = state.config.schedule.split(':').map(Number);
      if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return;
      const next = new Date();
      next.setHours(hours, minutes, 0, 0);
      if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
      delay = next.getTime() - Date.now();
    } else {
      return;
    }

    state.nextRun = new Date(Date.now() + delay);
    state.timerId = setTimeout(() => {
      this.fireTrigger(agentId);
      this.schedule(agentId);
    }, delay);
    state.timerId.unref?.();
  }

  private idempotencyKey(agentId: string, state: TriggerState, now: number): string {
    if (state.config.type === 'activity') return `activity:${agentId}:${this.lastActivity.toISOString()}`;
    if (state.config.type === 'time-of-day') return `time-of-day:${agentId}:${new Date(now).toISOString().slice(0, 10)}`;
    const intervalMs = Math.max(1_000, (state.config.interval || 60) * 1_000);
    return `interval:${agentId}:${Math.floor(now / intervalMs)}`;
  }

  private proactivePriority(configured: AgentTriggerConfig['priority']): Priority {
    return configured === 'low' ? 'background' : 'low';
  }

  private enqueueAgent(
    agentId: string,
    state: TriggerState,
    triggerType: TriggerType,
    username: string,
    now = Date.now(),
  ): string | null {
    const admissionKey = triggerType === 'manual' ? undefined : this.idempotencyKey(agentId, state, now);
    if (admissionKey && state.lastAdmissionKey === admissionKey) return null;
    const taskInput: TaskInput = {
      type: AGENT_TASK_MAP[agentId] || 'generic',
      handler: agentId === 'sleep-workflow' ? 'workflow.sleep' : `agent.${agentId}`,
      source: triggerType === 'manual' ? 'user' : 'timer',
      priority: triggerType === 'manual' ? state.config.priority : this.proactivePriority(state.config.priority),
      input: {
        agentId,
        configuredAgentPath: state.config.agentPath,
        triggeredBy: triggerType,
        usesLLM: state.config.usesLLM ?? true,
      },
      username,
      maxAttempts: Math.max(1, (state.config.maxRetries ?? 0) + 1),
      idempotencyKey: admissionKey,
      metadata: { producer: 'trigger-manager', triggerType },
    };
    const task = this.queueManager.enqueue(taskInput);
    state.lastAdmissionKey = admissionKey;
    state.lastRun = new Date(now);
    state.runCount += 1;
    this.emit('trigger', { agentId, taskId: task.id, taskType: task.type });
    audit({
      level: 'info',
      category: 'action',
      event: 'trigger_fired',
      actor: 'trigger_manager',
      details: { agentId, taskId: task.id, handler: task.handler, triggerType, runCount: state.runCount },
    });
    return task.id;
  }

  private fireTrigger(agentId: string): string | null {
    const state = this.triggers.get(agentId);
    if (!state || !this.running || !state.config.enabled || this.config?.globalSettings.pauseAll) return null;
    if (this.isQuietHours() || !this.checkConditions(state.config)) return null;
    if (Math.random() > (state.config.probability ?? 1)) return null;
    const username = this.lastActiveUsername || readLastActiveUsername() || 'system';
    const now = Date.now();
    const enqueue = () => this.enqueueAgent(agentId, state, state.config.type, username, now);
    if ((state.config.jitterMs || 0) > 0) {
      const timer = setTimeout(enqueue, Math.floor(Math.random() * state.config.jitterMs!));
      timer.unref?.();
      return null;
    }
    return enqueue();
  }

  triggerManual(agentId: string, username?: string): string | null {
    const state = this.triggers.get(agentId);
    if (!state) return null;
    return this.enqueueAgent(agentId, state, 'manual', username || this.lastActiveUsername || 'system');
  }

  triggerEvent(eventName: string, _data?: any): string[] {
    const taskIds: string[] = [];
    for (const [agentId, state] of this.triggers) {
      if (!this.running || state.config.type !== 'event' || !state.config.enabled || !state.config.eventPattern) continue;
      if (eventName === state.config.eventPattern || eventName.includes(state.config.eventPattern)) {
        const taskId = this.enqueueAgent(
          agentId,
          state,
          'event',
          this.lastActiveUsername || readLastActiveUsername() || 'system',
        );
        if (taskId) taskIds.push(taskId);
      }
    }
    return taskIds;
  }

  evaluateActivityTriggers(now = Date.now()): string[] {
    if (!this.running) return [];
    this.syncLastActivityFromDisk();
    const inactiveSeconds = (now - this.lastActivity.getTime()) / 1_000;
    const taskIds: string[] = [];
    for (const [agentId, state] of this.triggers) {
      if (state.config.type !== 'activity' || !state.config.enabled || !state.config.inactivityThreshold) continue;
      if (inactiveSeconds < state.config.inactivityThreshold) continue;
      const taskId = this.fireTrigger(agentId);
      if (taskId) taskIds.push(taskId);
    }
    return taskIds;
  }

  recordActivity(username?: string): void {
    this.lastActivity = new Date();
    this.lastActiveUsername = username || null;
    recordSystemActivity(this.lastActivity.getTime(), username);
    this.emit('activity', { timestamp: this.lastActivity, username });
  }

  private syncLastActivityFromDisk(): void {
    const timestamp = readSystemActivityTimestamp();
    if (timestamp && timestamp > this.lastActivity.getTime()) this.lastActivity = new Date(timestamp);
    this.lastActiveUsername = readLastActiveUsername() || this.lastActiveUsername;
  }

  private isQuietHours(): boolean {
    const quiet = this.config?.globalSettings.quietHours;
    if (!quiet?.enabled) return false;
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const [startHour, startMinute] = quiet.start.split(':').map(Number);
    const [endHour, endMinute] = quiet.end.split(':').map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    return start > end ? current >= start || current < end : current >= start && current < end;
  }

  private checkConditions(config: AgentTriggerConfig): boolean {
    if (config.conditions?.requiresSleepMode) {
      // Sleep mode is admitted through an explicit workflow in its migration phase.
      return false;
    }
    return true;
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

  isQueuePaused(): boolean {
    return false;
  }

  getLastActivity(): { timestamp: Date; username: string | null } {
    return { timestamp: this.lastActivity, username: this.lastActiveUsername };
  }

  isRunning(): boolean {
    return this.running;
  }
}

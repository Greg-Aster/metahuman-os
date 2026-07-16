import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../audit.js';
import { systemPaths } from '../path-builder.js';
import {
  agentHandlerId,
  defaultAgentLifecycle,
  type AgentLifecycleClass,
  type TriggerStartupPolicy,
} from './agent-work-catalog.js';
import type { AutonomyMode, Priority, WorkResource } from './types.js';

export type TriggerType = 'interval' | 'time-of-day' | 'event' | 'activity' | 'manual';

export interface AgentTriggerConfig {
  id: string;
  displayName?: string;
  description?: string;
  enabled: boolean;
  type: TriggerType;
  lifecycle: AgentLifecycleClass;
  handler: string;
  priority: 'low' | 'normal' | 'high';
  resource?: WorkResource;
  allowedModes: AutonomyMode[];
  startupPolicy: TriggerStartupPolicy;
  agentPath?: string;
  usesLLM?: boolean;
  interval?: number;
  schedule?: string;
  inactivityThreshold?: number;
  eventPattern?: string;
  eventCountThreshold?: number;
  eventCountField?: string;
  idleResetSeconds?: number;
  debounce?: number;
  maxRetries?: number;
  probability?: number;
  jitterMs?: number;
  pauseCategory?: 'interactive' | 'background';
  conditions?: { requiresSleepMode?: boolean; [key: string]: any };
  comment?: string;
  [key: string]: unknown;
}

export interface TriggerManagerConfig {
  version: string;
  revision: number;
  globalSettings: {
    pauseAll: boolean;
    timezone: string;
    quietHours?: { enabled: boolean; start: string; end: string };
    [key: string]: unknown;
  };
  agents: Record<string, AgentTriggerConfig>;
  [key: string]: unknown;
}

export interface TriggerConfigRead {
  config: TriggerManagerConfig;
  scope: 'system';
  revision: number;
  loadedAt: string;
}

export interface TriggerConfigPatch {
  globalSettings?: Record<string, unknown>;
  agents?: Record<string, Record<string, unknown>>;
}

type ConfigListener = (value: TriggerConfigRead) => void;

const AGENT_PATCH_FIELDS = new Set([
  'id',
  'displayName',
  'description',
  'enabled',
  'type',
  'lifecycle',
  'handler',
  'priority',
  'resource',
  'allowedModes',
  'startupPolicy',
  'agentPath',
  'usesLLM',
  'interval',
  'schedule',
  'inactivityThreshold',
  'eventPattern',
  'eventCountThreshold',
  'eventCountField',
  'idleResetSeconds',
  'debounce',
  'maxRetries',
  'probability',
  'jitterMs',
  'pauseCategory',
  'conditions',
  'comment',
  'contentMode',
  'contentModeOptions',
]);

const CONFIG_FIELDS = new Set([
  '$schema',
  'version',
  'revision',
  'description',
  '_TEMPLATE_WARNING',
  '_TEMPLATE_WARNING2',
  '_TEMPLATE_WARNING3',
  '_TEMPLATE_WARNING4',
  'globalSettings',
  'agents',
]);

const GLOBAL_PATCH_FIELDS = new Set([
  'pauseAll',
  'timezone',
  'quietHours',
  // Existing domain settings are preserved while their UI ownership is split.
  'memoryContentMode',
  'memoryContentModeOptions',
]);

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function assertTimezone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('globalSettings.timezone must be a timezone name');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone: ${value}`);
  }
  return value;
}

function assertClock(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${field} must use 24-hour HH:MM format`);
  }
  return value;
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum = Number.POSITIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function assertAgentId(agentId: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agentId)) {
    throw new Error('Agent id must use lowercase kebab-case');
  }
  return agentId;
}

function normalizeModes(value: unknown, type: TriggerType): AutonomyMode[] {
  const fallback: AutonomyMode[] = type === 'manual' || type === 'event'
    ? ['reactive', 'semi', 'full']
    : ['semi', 'full'];
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length === 0) throw new Error('allowedModes must be a non-empty array');
  const modes = [...new Set(value)] as unknown[];
  if (!modes.every(mode => mode === 'reactive' || mode === 'semi' || mode === 'full')) {
    throw new Error('allowedModes entries must be reactive, semi, or full');
  }
  return modes as AutonomyMode[];
}

function normalizeAgent(agentId: string, raw: Record<string, any>): AgentTriggerConfig {
  for (const field of Object.keys(raw)) {
    if (!AGENT_PATCH_FIELDS.has(field)) throw new Error(`Unknown trigger field: agents.${agentId}.${field}`);
  }
  if (raw.id !== undefined && raw.id !== agentId) {
    throw new Error(`agents.${agentId}.id must match its catalog key`);
  }
  const type = raw.type ?? 'manual';
  if (!['interval', 'time-of-day', 'event', 'activity', 'manual'].includes(type)) {
    throw new Error(`agents.${agentId}.type is invalid`);
  }
  const lifecycle = raw.lifecycle ?? defaultAgentLifecycle(agentId);
  if (!['scheduled-work', 'workflow', 'service'].includes(lifecycle)) {
    throw new Error(`agents.${agentId}.lifecycle is invalid`);
  }
  if (lifecycle === 'service') {
    throw new Error(`agents.${agentId} is a persistent service and belongs in services.json`);
  }
  const priority = raw.priority ?? 'normal';
  if (!['low', 'normal', 'high'].includes(priority)) throw new Error(`agents.${agentId}.priority is invalid`);
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw new Error(`agents.${agentId}.enabled must be boolean`);
  if (raw.interval !== undefined) finiteNumber(raw.interval, `agents.${agentId}.interval`, 1, 31_536_000);
  if (raw.inactivityThreshold !== undefined) finiteNumber(raw.inactivityThreshold, `agents.${agentId}.inactivityThreshold`, 1, 31_536_000);
  if (raw.debounce !== undefined) finiteNumber(raw.debounce, `agents.${agentId}.debounce`, 0, 86_400_000);
  if (raw.jitterMs !== undefined) finiteNumber(raw.jitterMs, `agents.${agentId}.jitterMs`, 0, 86_400_000);
  if (raw.maxRetries !== undefined) finiteNumber(raw.maxRetries, `agents.${agentId}.maxRetries`, 0, 20);
  if (raw.probability !== undefined) finiteNumber(raw.probability, `agents.${agentId}.probability`, 0, 1);
  if (raw.eventCountThreshold !== undefined) {
    finiteNumber(raw.eventCountThreshold, `agents.${agentId}.eventCountThreshold`, 1, 10_000);
    if (!Number.isInteger(raw.eventCountThreshold)) throw new Error(`agents.${agentId}.eventCountThreshold must be an integer`);
  }
  if (raw.eventCountField !== undefined && (typeof raw.eventCountField !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(raw.eventCountField))) {
    throw new Error(`agents.${agentId}.eventCountField must be a simple field name`);
  }
  if (raw.idleResetSeconds !== undefined) finiteNumber(raw.idleResetSeconds, `agents.${agentId}.idleResetSeconds`, 1, 31_536_000);
  if (type === 'interval' && !raw.interval) throw new Error(`agents.${agentId}.interval is required`);
  if (type === 'activity' && !raw.inactivityThreshold) throw new Error(`agents.${agentId}.inactivityThreshold is required`);
  if (type === 'time-of-day') assertClock(raw.schedule, `agents.${agentId}.schedule`);
  if (type === 'event' && (typeof raw.eventPattern !== 'string' || !raw.eventPattern.trim())) {
    throw new Error(`agents.${agentId}.eventPattern is required`);
  }
  if (type === 'event' && raw.eventPattern.includes('*') && !/^[^*]+\.\*$/.test(raw.eventPattern)) {
    throw new Error(`agents.${agentId}.eventPattern only supports a trailing .* wildcard`);
  }
  if (type !== 'interval' && raw.interval !== undefined) throw new Error(`agents.${agentId}.interval is only valid for interval triggers`);
  if (type !== 'activity' && raw.inactivityThreshold !== undefined) throw new Error(`agents.${agentId}.inactivityThreshold is only valid for activity triggers`);
  if (type !== 'time-of-day' && raw.schedule !== undefined) throw new Error(`agents.${agentId}.schedule is only valid for time-of-day triggers`);
  if (type !== 'event' && raw.eventPattern !== undefined) throw new Error(`agents.${agentId}.eventPattern is only valid for event triggers`);
  if (type !== 'event' && raw.eventCountThreshold !== undefined) throw new Error(`agents.${agentId}.eventCountThreshold is only valid for event triggers`);
  if (type !== 'event' && raw.eventCountField !== undefined) throw new Error(`agents.${agentId}.eventCountField is only valid for event triggers`);
  if (type !== 'event' && raw.idleResetSeconds !== undefined) throw new Error(`agents.${agentId}.idleResetSeconds is only valid for event triggers`);
  const startupPolicy = raw.startupPolicy ?? 'skip';
  if (!['skip', 'run-once', 'recover-missed'].includes(startupPolicy)) {
    throw new Error(`agents.${agentId}.startupPolicy is invalid`);
  }
  return {
    ...raw,
    id: raw.id || agentId,
    enabled: raw.enabled ?? false,
    type,
    lifecycle,
    handler: typeof raw.handler === 'string' && raw.handler.trim() ? raw.handler : agentHandlerId(agentId),
    priority,
    allowedModes: normalizeModes(raw.allowedModes, type),
    startupPolicy,
  } as AgentTriggerConfig;
}

function normalizeConfig(raw: Record<string, any>): TriggerManagerConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('agents.json must contain an object');
  for (const field of Object.keys(raw)) {
    if (!CONFIG_FIELDS.has(field)) throw new Error(`Unknown trigger configuration field: ${field}`);
  }
  if (!raw.agents || typeof raw.agents !== 'object' || Array.isArray(raw.agents)) throw new Error('agents.json agents must contain an object');
  const globalRaw = raw.globalSettings && typeof raw.globalSettings === 'object' ? raw.globalSettings : {};
  for (const field of Object.keys(globalRaw)) {
    if (!GLOBAL_PATCH_FIELDS.has(field)) throw new Error(`Unknown global trigger setting: ${field}`);
  }
  if (globalRaw.pauseAll !== undefined && typeof globalRaw.pauseAll !== 'boolean') {
    throw new Error('globalSettings.pauseAll must be boolean');
  }
  const timezone = assertTimezone(globalRaw.timezone ?? defaultTimezone());
  if (globalRaw.quietHours !== undefined) {
    if (!globalRaw.quietHours || typeof globalRaw.quietHours !== 'object') throw new Error('globalSettings.quietHours must be an object');
    for (const field of Object.keys(globalRaw.quietHours)) {
      if (!['enabled', 'start', 'end'].includes(field)) throw new Error(`Unknown quiet-hours setting: ${field}`);
    }
    if (typeof globalRaw.quietHours.enabled !== 'boolean') throw new Error('globalSettings.quietHours.enabled must be boolean');
    assertClock(globalRaw.quietHours.start, 'globalSettings.quietHours.start');
    assertClock(globalRaw.quietHours.end, 'globalSettings.quietHours.end');
  }
  const agents = Object.fromEntries(
    Object.entries(raw.agents).map(([agentId, agent]) => {
      if (!agent || typeof agent !== 'object' || Array.isArray(agent)) throw new Error(`agents.${agentId} must be an object`);
      return [agentId, normalizeAgent(agentId, agent as Record<string, any>)];
    }),
  );
  return {
    ...raw,
    version: typeof raw.version === 'string' ? raw.version : '1.0.0',
    revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    globalSettings: {
      ...globalRaw,
      pauseAll: globalRaw.pauseAll ?? false,
      timezone,
    },
    agents,
  };
}

function validatePatch(patch: TriggerConfigPatch): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Trigger configuration patch must be an object');
  for (const field of Object.keys(patch)) {
    if (field !== 'globalSettings' && field !== 'agents') {
      throw new Error(`Unknown trigger configuration field: ${field}`);
    }
  }
  for (const field of Object.keys(patch.globalSettings || {})) {
    if (!GLOBAL_PATCH_FIELDS.has(field)) throw new Error(`Unknown global trigger setting: ${field}`);
  }
  for (const [agentId, values] of Object.entries(patch.agents || {})) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`agents.${agentId} patch must be an object`);
    for (const field of Object.keys(values)) {
      if (!AGENT_PATCH_FIELDS.has(field)) throw new Error(`Unknown trigger field: agents.${agentId}.${field}`);
    }
  }
}

export class TriggerConfigService {
  private readonly listeners = new Set<ConfigListener>();
  private lastRead?: TriggerConfigRead;
  private lastError?: string;

  constructor(private readonly configPath = path.join(systemPaths.etc, 'agents.json')) {}

  subscribe(listener: ConfigListener): () => void {
    this.listeners.add(listener);
    if (this.lastRead) listener(this.lastRead);
    return () => this.listeners.delete(listener);
  }

  load(notify = true): TriggerConfigRead {
    try {
      const config = normalizeConfig(JSON.parse(fs.readFileSync(this.configPath, 'utf8')));
      const value = { config, scope: 'system' as const, revision: config.revision, loadedAt: new Date().toISOString() };
      this.lastRead = value;
      this.lastError = undefined;
      if (notify) for (const listener of this.listeners) listener(value);
      return value;
    } catch (error) {
      this.lastError = (error as Error).message;
      throw error;
    }
  }

  reload(): TriggerConfigRead {
    return this.load(true);
  }

  private commit(
    current: TriggerConfigRead,
    rawNext: Record<string, unknown>,
    actor: string,
    details: Record<string, unknown>,
  ): TriggerConfigRead {
    const next = normalizeConfig({
      ...rawNext,
      revision: current.revision + 1,
    });
    const temporaryPath = `${this.configPath}.tmp-${process.pid}-${Date.now()}`;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, this.configPath);
    const value = { config: next, scope: 'system' as const, revision: next.revision, loadedAt: new Date().toISOString() };
    this.lastRead = value;
    this.lastError = undefined;
    for (const listener of this.listeners) listener(value);
    audit({
      level: 'info',
      category: 'system',
      event: 'trigger_config_updated',
      actor,
      details: { revision: next.revision, ...details },
    });
    return value;
  }

  update(patch: TriggerConfigPatch, actor: string): TriggerConfigRead {
    validatePatch(patch);
    const current = this.load(false);
    const mergedAgents: Record<string, Record<string, unknown>> = { ...current.config.agents };
    for (const [agentId, values] of Object.entries(patch.agents || {})) {
      if (!mergedAgents[agentId]) throw new Error(`Unknown trigger: ${agentId}`);
      const merged = { ...mergedAgents[agentId] };
      for (const [field, value] of Object.entries(values)) {
        // JSON PATCH callers use null to clear type-specific fields. Keeping an
        // interval while changing to an event trigger, for example, would make
        // the resulting configuration internally contradictory.
        if (value === null) delete merged[field];
        else merged[field] = value;
      }
      mergedAgents[agentId] = merged;
    }
    return this.commit(current, {
      ...current.config,
      globalSettings: { ...current.config.globalSettings, ...(patch.globalSettings || {}) },
      agents: mergedAgents,
    }, actor, {
      operation: 'patch',
      globalFields: Object.keys(patch.globalSettings || {}),
      agents: Object.keys(patch.agents || {}),
    });
  }

  registerAgent(agentId: string, config: Record<string, unknown>, actor: string): TriggerConfigRead {
    assertAgentId(agentId);
    const current = this.load(false);
    if (current.config.agents[agentId]) throw new Error(`Trigger already registered: ${agentId}`);
    return this.commit(current, {
      ...current.config,
      agents: {
        ...current.config.agents,
        [agentId]: { ...config, id: agentId },
      },
    }, actor, { operation: 'register', agents: [agentId] });
  }

  unregisterAgent(agentId: string, actor: string): TriggerConfigRead {
    assertAgentId(agentId);
    const current = this.load(false);
    if (!current.config.agents[agentId]) throw new Error(`Trigger is not registered: ${agentId}`);
    const agents = { ...current.config.agents };
    delete agents[agentId];
    return this.commit(current, {
      ...current.config,
      agents,
    }, actor, { operation: 'unregister', agents: [agentId] });
  }

  getStatus(): { scope: 'system'; revision?: number; loadedAt?: string; error?: string } {
    return {
      scope: 'system',
      revision: this.lastRead?.revision,
      loadedAt: this.lastRead?.loadedAt,
      error: this.lastError,
    };
  }
}

let instance: TriggerConfigService | null = null;

export function getTriggerConfigService(): TriggerConfigService {
  if (!instance) instance = new TriggerConfigService();
  return instance;
}

export function resetTriggerConfigService(): void {
  instance = null;
}

export function priorityForTriggeredWork(priority: AgentTriggerConfig['priority']): Priority {
  return priority === 'low' ? 'background' : 'low';
}

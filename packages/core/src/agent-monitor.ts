/**
 * Agent Monitor - Track and monitor running agents
 * Provides real-time status and log streaming
 */

import fs, { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from './path-builder.js';
import { getAgentCatalogSnapshot, type AgentCatalogSnapshot } from './agent-catalog.js';
import {
  bootEntryForDescriptor,
  buildAgentDescriptor,
  defaultAgentCatalogEntry,
  DESCRIPTORS,
  ENVIRONMENT_BRIDGE_FIELDS,
  readAgentMonitorConfig,
  SERVICE_LIFECYCLE_FIELDS,
  updateEnvironmentBridgeVariable,
  writeServiceConfig,
} from './agent-monitor-descriptors.js';
import {
  getAgentFailures,
  isProcessRunning,
  readRegistry,
  writeRegistry,
} from './agent-monitor-registry.js';
import {
  getEnvironmentActionSubscriberCount,
  getEnvironmentBridgeDiagnosticsSnapshot,
  summarizeEnvironmentBridgeState,
} from './environment-interface/index.js';
import type {
  AgentDataPanel,
  AgentDescriptor,
  AgentError,
  AgentFailureEntry,
  AgentLog,
  AgentMonitorCard,
  AgentMonitorSnapshot,
  AgentRunMetrics,
  AgentStatus,
  AgentVariableDescriptor,
  AgentCatalogEntry,
  AgentMonitorConfig,
} from './agent-monitor-types.js';

export {
  clearAgentFailure,
  getAgentFailures,
  getRunningAgents,
  isAgentRunning,
  recordAgentFailure,
  registerAgent,
  stopAgent,
  stopAllAgents,
  unregisterAgent,
} from './agent-monitor-registry.js';

export type {
  AgentBootEntry,
  AgentDataPanel,
  AgentDescriptor,
  AgentError,
  AgentFailureEntry,
  AgentKind,
  AgentLog,
  AgentMonitorCard,
  AgentMonitorSnapshot,
  AgentRunMetrics,
  AgentStatus,
  AgentVariableApplyMode,
  AgentVariableDescriptor,
  AgentVariableType,
} from './agent-monitor-types.js';

const LOG_PREFIX = '[agent-monitor]';

function monitorCardForAgent(name: string, descriptor: AgentDescriptor, status?: AgentStatus): AgentMonitorCard {
  const metrics = getAgentMetrics(name);
  return {
    name,
    displayName: descriptor.name,
    description: descriptor.description,
    kind: descriptor.kind,
    status: status?.status ?? 'stopped',
    pid: status?.pid,
    uptime: status?.uptime,
    startedAt: status?.startedAt,
    lastActivity: status?.lastActivity,
    metrics,
    errors: status?.errors ?? [],
  };
}

function monitorCardForFailure(failure: AgentFailureEntry, descriptor: AgentDescriptor): AgentMonitorCard {
  const metrics = getAgentMetrics(failure.agent);
  return {
    name: failure.agent,
    displayName: descriptor.name,
    description: descriptor.description,
    kind: descriptor.kind,
    status: 'error',
    pid: failure.pid,
    lastActivity: failure.timestamp,
    metrics: {
      ...metrics,
      failedRuns: Math.max(metrics.failedRuns, 1),
      lastRun: metrics.lastRun ?? failure.timestamp,
      lastError: failure.error,
    },
    errors: [failure.error, failure.stderr].filter(Boolean) as string[],
  };
}

function latestTaskFromLogs(logs: AgentLog[]): string | undefined {
  return logs.slice().reverse().find(log => log.level !== 'error')?.message;
}

function errorFromLog(log: AgentLog): AgentError {
  return {
    timestamp: log.timestamp,
    agent: log.agent,
    message: log.message,
    source: 'audit',
  };
}

function errorFromFailure(failure: AgentFailureEntry): AgentError {
  return {
    timestamp: failure.timestamp,
    agent: failure.agent,
    message: failure.error,
    source: failure.source,
    pid: failure.pid,
    exitCode: failure.exitCode,
    stderr: failure.stderr,
    stdout: failure.stdout,
  };
}

function variableValue(descriptor: AgentDescriptor, key: string): string | number | boolean | string[] | null | undefined {
  return descriptor.variables.find(variable => variable.key === key)?.value;
}

function environmentBridgeReadiness(
  lifecycle: AgentMonitorCard['status'],
  descriptor: AgentDescriptor,
  errors: string[] = [],
): Pick<AgentDataPanel, 'readiness' | 'dependencyHealth' | 'latestTask'> {
  const summary = summarizeEnvironmentBridgeState();
  const activeSessions = summary.sessions.filter(session => session.status === 'connected');
  const streamCount = getEnvironmentActionSubscriberCount();
  const tokenConfigured = Boolean(process.env.MH_ENVIRONMENT_BRIDGE_TOKEN?.trim());
  const adapterTokenConfigured = Boolean(process.env.MH_ENVIRONMENT_ADAPTER_TOKEN?.trim());

  if (lifecycle === 'error') {
    return {
      readiness: 'failed',
      dependencyHealth: 'failed',
      latestTask: errors.find(Boolean) || 'Robot Bridge failed.',
    };
  }

  if (lifecycle !== 'running') {
    return {
      readiness: 'not-ready',
      dependencyHealth: 'unavailable',
      latestTask: 'Environment Bridge agent is stopped.',
    };
  }

  if (!tokenConfigured || !adapterTokenConfigured) {
    return {
      readiness: 'not-ready',
      dependencyHealth: 'missing',
      latestTask: 'Configure both environment bridge tokens and restart MetaHuman OS.',
    };
  }

  if (!summary.enabled) {
    return {
      readiness: 'not-ready',
      dependencyHealth: 'configured',
      latestTask: 'Robot Bridge is disabled.',
    };
  }

  if (activeSessions.length === 0) {
    return {
      readiness: 'not-ready',
      dependencyHealth: 'connecting',
      latestTask: 'Waiting for an environment adapter observation and action stream.',
    };
  }

  if (streamCount === 0) {
    return {
      readiness: 'not-ready',
      dependencyHealth: 'connecting',
      latestTask: `Received ${activeSessions.length} robot session(s); waiting for an action stream.`,
    };
  }

  return {
    readiness: 'ready',
    dependencyHealth: 'ok',
    latestTask: `${activeSessions.length} robot session(s) connected with ${streamCount} action stream(s).`,
  };
}

function dataPanelForAgent(card: AgentMonitorCard, descriptor: AgentDescriptor): AgentDataPanel {
  const logs = card.name === 'environment-bridge' ? [] : getAgentLogs(card.name, 80);
  const errors = logs.filter(log => log.level === 'error').slice(-10).map(errorFromLog);
  const bridgeStatus = card.name === 'environment-bridge'
    ? environmentBridgeReadiness(card.status, descriptor, [...card.errors, ...errors.map(error => error.message)])
    : undefined;
  return {
    agentId: card.name,
    displayName: descriptor.name,
    description: descriptor.description,
    kind: descriptor.kind,
    lifecycle: card.status,
    pid: card.pid,
    uptime: card.uptime,
    readiness: bridgeStatus?.readiness ?? (card.status === 'running' ? 'ready' : card.status === 'error' ? 'failed' : 'unknown'),
    dependencyHealth: bridgeStatus?.dependencyHealth ?? (card.errors.length > 0 ? 'failed' : 'unknown'),
    latestTask: bridgeStatus?.latestTask ?? latestTaskFromLogs(logs),
    variables: descriptor.variables,
    logs,
    errors,
    diagnostics: card.name === 'environment-bridge'
      ? getEnvironmentBridgeDiagnosticsSnapshot()
      : undefined,
  };
}

function dataPanelForFailure(card: AgentMonitorCard, descriptor: AgentDescriptor, failure: AgentFailureEntry): AgentDataPanel {
  const logs = getAgentLogs(card.name, 80);
  const failureLog: AgentLog = {
    timestamp: failure.timestamp,
    level: 'error',
    message: failure.stderr || failure.error,
    agent: failure.agent,
  };
  const bridgeStatus = card.name === 'environment-bridge'
    ? environmentBridgeReadiness('error', descriptor, [failure.error, failure.stderr ?? ''])
    : undefined;
  return {
    agentId: card.name,
    displayName: descriptor.name,
    description: descriptor.description,
    kind: descriptor.kind,
    lifecycle: 'error',
    pid: card.pid,
    readiness: bridgeStatus?.readiness ?? 'failed',
    dependencyHealth: bridgeStatus?.dependencyHealth ?? 'failed',
    latestTask: bridgeStatus?.latestTask ?? failure.error,
    variables: descriptor.variables,
    logs: [...logs, failureLog].slice(-80),
    errors: [errorFromFailure(failure)],
    diagnostics: card.name === 'environment-bridge'
      ? getEnvironmentBridgeDiagnosticsSnapshot()
      : undefined,
  };
}

function hasRunnableAgentSource(id: string): boolean {
  const servicePath = path.join(systemPaths.brain, 'services', `${id}.ts`);
  const modularCli = path.join(systemPaths.agents, id, 'cli.ts');
  const modularIndex = path.join(systemPaths.agents, id, 'index.ts');
  const legacyPath = path.join(systemPaths.agents, `${id}.ts`);
  return [servicePath, modularCli, modularIndex, legacyPath].some(candidate => fs.existsSync(candidate));
}

function isTrackableAgent(id: string): boolean {
  return Boolean(DESCRIPTORS[id]) || hasRunnableAgentSource(id);
}

function normalizedAgentIds(config: AgentMonitorConfig, catalog: AgentCatalogSnapshot): string[] {
  const registry = readRegistry();
  const failures = getAgentFailures();
  const catalogIds = new Set(catalog.agents.map(agent => agent.id));
  return [...new Set([
    ...Object.keys(DESCRIPTORS),
    ...catalogIds,
    ...Object.keys(config.agents ?? {}),
    ...Object.keys(config.services ?? {}),
    ...Object.keys(registry),
    ...failures.map(failure => failure.agent),
  ])]
    .filter(id => catalogIds.has(id) || isTrackableAgent(id))
    .sort((a, b) => a.localeCompare(b));
}

function configuredAgent(config: AgentMonitorConfig, id: string): AgentCatalogEntry | undefined {
  return config.services?.[id] ?? config.agents?.[id];
}

/**
 * Get list of available agents
 * Supports both legacy single-file agents (*.ts) and modular agents (directories with index.ts)
 */
export function listAvailableAgents(): string[] {

  const agentsDir = systemPaths.agents;

  if (!fs.existsSync(agentsDir)) {
    return [];
  }

  const agents: string[] = [];
  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      // Legacy single-file agent (e.g., reflector.ts)
      agents.push(entry.name.replace('.ts', ''));
    } else if (entry.isDirectory()) {
      // Check for modular agent (directory with index.ts)
      const indexPath = path.join(agentsDir, entry.name, 'index.ts');
      if (fs.existsSync(indexPath)) {
        agents.push(entry.name);
      }
    }
  }

  // Remove duplicates (if both legacy file and directory exist)
  return [...new Set(agents)];
}

/**
 * Read recent agent logs from audit trail
 */
export function getAgentLogs(agentName?: string, limit = 50): AgentLog[] {
  const today = new Date().toISOString().slice(0, 10);
  const auditFile = path.join(systemPaths.logs, 'audit', `${today}.ndjson`);

  if (!fs.existsSync(auditFile)) {
    return [];
  }

  const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
  const logs: AgentLog[] = [];
  const knownAgents = new Set([
    ...Object.keys(DESCRIPTORS),
    ...Object.keys(readRegistry()).filter(isTrackableAgent),
    ...getAgentFailures().map(failure => failure.agent).filter(isTrackableAgent),
  ]);

  for (const line of lines) {
    if (!line) continue;

    try {
      const entry = JSON.parse(line);

      // Normalize event fields
      const normalizedAgent: string | undefined = entry?.details?.agent || entry?.actor;
      const normalizedMessage: string = entry?.event || entry?.message || '';
      const normalizedLevel: 'info' | 'warn' | 'error' =
        entry?.level === 'error' ? 'error' : entry?.level === 'warn' ? 'warn' : 'info';

      // Determine if this log belongs to an agent we're tracking
      const isAgentLike = !!normalizedAgent && (
        knownAgents.has(normalizedAgent) || // direct agent name match
        normalizedAgent === 'agent' || // generic agent actor with details.agent
        /-service$/.test(normalizedAgent) // background services
      );

      if (!isAgentLike) continue;

      // If filtering by a specific agent, allow match on details.agent or actor
      if (agentName && normalizedAgent !== agentName) continue;

      logs.push({
        timestamp: entry.timestamp,
        level: normalizedLevel,
        message: normalizedMessage,
        agent: normalizedAgent || 'unknown',
      });
    } catch (error) {
      // Skip invalid JSON entry in audit log
      console.warn(`${LOG_PREFIX} Skipping invalid JSON in audit log:`, (error as Error).message);
    }
  }

  return logs.slice(-limit);
}

/**
 * Get agent statistics from audit logs
 */
export function getAgentStats(agentName: string): {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastRun?: string;
  averageProcessed?: number;
} {
  const logs = getAgentLogs(agentName, 1000);

  const isStart = (m: string) => {
    const s = m.toLowerCase();
    return (
      s === 'agent_started' ||
      s === 'agent_cycle_started' ||
      s.includes('starting') ||
      s.includes('started') ||
      s.includes('waking up') ||
      s.includes('drifting into a dream')
    );
  };

  const isComplete = (m: string, level: AgentLog['level']) => {
    const s = m.toLowerCase();
    return (
      s === 'agent_completed' ||
      s === 'agent_cycle_completed' ||
      (s === 'agent_stopped' && level !== 'error') ||
      s.includes('generated new insight') ||
      s.includes('triggering') ||
      s.includes('triggered') ||
      s.includes('finished') ||
      s.includes('completed')
    );
  };

  const isFail = (m: string, level: AgentLog['level']) => {
    const s = m.toLowerCase();
    return (
      level === 'error' ||
      s === 'agent_failed' ||
      s === 'agent_cycle_failed' ||
      /failed|error|exited with code/.test(s)
    );
  };

  const started = logs.filter(l => isStart(l.message)).length;
  const completed = logs.filter(l => isComplete(l.message, l.level)).length;
  const failed = logs.filter(l => isFail(l.message, l.level)).length;
  const successfulRuns = DESCRIPTORS[agentName]?.kind === 'one-shot'
    ? Math.min(started, completed)
    : completed;

  const lastRunLog = logs.filter(l => isStart(l.message)).slice(-1)[0];

  return {
    totalRuns: started,
    successfulRuns,
    failedRuns: failed,
    lastRun: lastRunLog?.timestamp,
  };
}

/**
 * Get current agent statuses
 */
export function getAgentStatuses(): AgentStatus[] {

  const registry = readRegistry();
  const availableAgents = [...new Set([
    ...Object.keys(DESCRIPTORS),
    ...Object.keys(registry).filter(isTrackableAgent),
  ])];
  const statuses: AgentStatus[] = [];

  // Clean up stale entries
  const cleanRegistry: Record<string, { pid: number; startTime: string }> = {};
  for (const [name, info] of Object.entries(registry)) {
    if (isTrackableAgent(name) && isProcessRunning(info.pid)) {
      cleanRegistry[name] = info;
    }
  }
  if (Object.keys(cleanRegistry).length !== Object.keys(registry).length) {
    writeRegistry(cleanRegistry);
  }

  // Helper: fallback to lock files for services started outside registry
  const readServiceLock = (name: string): { pid: number; startTime: string } | null => {
    // Convert '<name>-service' -> 'service-<name>' lock naming
    if (!name.endsWith('-service')) return null;
    const base = name.replace(/-service$/, '');
    const lockName = `service-${base}`;
    const lockPath = path.join(systemPaths.run, 'locks', `${lockName}.lock`);
    if (!existsSync(lockPath)) return null;
    try {
      const txt = readFileSync(lockPath, 'utf8');
      const data = JSON.parse(txt || '{}');
      if (data?.pid && isProcessRunning(data.pid)) {
        return { pid: data.pid, startTime: data.startedAt || new Date().toISOString() };
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to read service lock file:`, (error as Error).message);
    }
    return null;
  };

  // Build status for each available agent
  for (const name of availableAgents) {
    let registryInfo = cleanRegistry[name];
    // Fallback: if not in registry and is service, consult lock file
    if (!registryInfo) {
      const lockInfo = readServiceLock(name);
      if (lockInfo) {
        registryInfo = { pid: lockInfo.pid, startTime: lockInfo.startTime };
      }
    }
    let status: AgentStatus['status'] = 'stopped';
    const logs = getAgentLogs(name, 100);
    let lastActivity = logs.slice(-1)[0]?.timestamp;
    let uptime: number | undefined;

    if (registryInfo && isProcessRunning(registryInfo.pid)) {
      status = 'running';
      const startTime = new Date(registryInfo.startTime).getTime();
      uptime = Math.floor((Date.now() - startTime) / 1000);

      lastActivity = logs.slice(-1)[0]?.timestamp ?? registryInfo.startTime;
    }

    statuses.push({
      name,
      pid: registryInfo?.pid,
      status,
      startedAt: registryInfo?.startTime,
      lastActivity,
      uptime,
      errors: [],
    });
  }

  return statuses;
}

/**
 * Get enhanced agent metrics with time windows
 */
export function getAgentMetrics(agentName: string): AgentRunMetrics {
  const now = Date.now();
  const logs = getAgentLogs(agentName, 5000);

  // Filter logs by time windows
  const last5m = logs.filter(l => now - new Date(l.timestamp).getTime() < 5 * 60 * 1000);
  const last1h = logs.filter(l => now - new Date(l.timestamp).getTime() < 60 * 60 * 1000);

  const isStart = (m: string) => {
    const s = m.toLowerCase();
    return (
      s === 'agent_started' ||
      s === 'agent_cycle_started' ||
      s.includes('starting') ||
      s.includes('started') ||
      s.includes('waking up') ||
      s.includes('drifting into a dream')
    );
  };

  const isComplete = (m: string, level: AgentLog['level']) => {
    const s = m.toLowerCase();
    return (
      s === 'agent_completed' ||
      s === 'agent_cycle_completed' ||
      (s === 'agent_stopped' && level !== 'error') ||
      s.includes('generated new insight') ||
      s.includes('triggering') ||
      s.includes('triggered') ||
      s.includes('finished') ||
      s.includes('completed')
    );
  };

  const isFail = (m: string, level: AgentLog['level']) => {
    const s = m.toLowerCase();
    return (
      level === 'error' ||
      s === 'agent_failed' ||
      s === 'agent_cycle_failed' ||
      /failed|error|exited with code/.test(s)
    );
  };

  // Calculate metrics
  const totalStarts = logs.filter(l => isStart(l.message)).length;
  const totalCompleted = logs.filter(l => isComplete(l.message, l.level)).length;
  const totalFailed = logs.filter(l => isFail(l.message, l.level)).length;
  const successfulRuns = DESCRIPTORS[agentName]?.kind === 'one-shot'
    ? Math.min(totalStarts, totalCompleted)
    : totalCompleted;

  const last5mStarts = last5m.filter(l => isStart(l.message)).length;
  const last5mCompleted = last5m.filter(l => isComplete(l.message, l.level)).length;
  const last5mFailed = last5m.filter(l => isFail(l.message, l.level)).length;

  const last1hStarts = last1h.filter(l => isStart(l.message)).length;
  const last1hCompleted = last1h.filter(l => isComplete(l.message, l.level)).length;
  const last1hFailed = last1h.filter(l => isFail(l.message, l.level)).length;

  const lastRunLog = logs.filter(l => isStart(l.message)).slice(-1)[0];
  const lastErrorLog = logs.filter(l => l.level === 'error').slice(-1)[0];

  const result: AgentRunMetrics = {
    agent: agentName,
    totalRuns: totalStarts,
    successfulRuns,
    failedRuns: totalFailed,
    lastRun: lastRunLog?.timestamp,
    lastError: lastErrorLog?.message,
    recentActivity: {
      last5m: last5mStarts,
      last1h: last1hStarts,
      today: totalStarts,
    },
    successRate: {
      last5m: last5mStarts > 0 ? Math.min(100, Math.round((last5mCompleted / last5mStarts) * 100)) : 0,
      last1h: last1hStarts > 0 ? Math.min(100, Math.round((last1hCompleted / last1hStarts) * 100)) : 0,
      overall: totalStarts > 0 ? Math.min(100, Math.round((totalCompleted / totalStarts) * 100)) : 0,
    },
  };

  return result;
}

export function getAgentMonitorSnapshot(): AgentMonitorSnapshot {
  const monitorConfig = readAgentMonitorConfig();
  const catalog = getAgentCatalogSnapshot();
  const catalogById = new Map(catalog.agents.map(agent => [agent.id, agent]));
  const statuses = getAgentStatuses();
  const statusByName = new Map(statuses.map(status => [status.name, status]));
  const failures = getAgentFailures();
  const failureByName = new Map(failures.map(failure => [failure.agent, failure]));
  const cards: AgentMonitorCard[] = [];
  const descriptors = new Map<string, AgentDescriptor>();

  for (const id of normalizedAgentIds(monitorConfig, catalog)) {
    const descriptor = buildAgentDescriptor(id, configuredAgent(monitorConfig, id), catalogById.get(id));
    descriptors.set(id, descriptor);
    cards.push(monitorCardForAgent(id, descriptor, statusByName.get(id)));
  }

  const runningAgents = cards
    .filter(card => card.status === 'running')
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  const recentCompletions = cards
    .filter(card => card.kind === 'one-shot'
      && card.status === 'stopped'
      && card.metrics.successfulRuns > 0
      && !failureByName.has(card.name))
    .sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))
    .slice(0, 10);
  const recentFailures = failures
    .map(failure => {
      const descriptor = descriptors.get(failure.agent) ?? buildAgentDescriptor(failure.agent, configuredAgent(monitorConfig, failure.agent), catalogById.get(failure.agent));
      descriptors.set(failure.agent, descriptor);
      return monitorCardForFailure(failure, descriptor);
    })
    .filter(card => !runningAgents.some(agent => agent.name === card.name));
  const runningNames = new Set(runningAgents.map(card => card.name));
  const startableAgents = cards
    .filter(card => !runningNames.has(card.name))
    .map(card => descriptors.get(card.name)!)
    .filter(descriptor => descriptor.startable)
    .sort((a, b) => a.name.localeCompare(b.name));
  const bootAgents = [...descriptors.values()]
    .filter(descriptor => descriptor.bootEligible)
    .map(bootEntryForDescriptor)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const agentData: Record<string, AgentDataPanel> = {};
  for (const card of cards) {
    const descriptor = descriptors.get(card.name);
    if (descriptor) {
      const failure = failureByName.get(card.name);
      agentData[card.name] = failure && card.status !== 'running'
        ? dataPanelForFailure(monitorCardForFailure(failure, descriptor), descriptor, failure)
        : dataPanelForAgent(card, descriptor);
    }
  }

  for (const failure of failures) {
    if (agentData[failure.agent]) continue;
    const descriptor = descriptors.get(failure.agent) ?? buildAgentDescriptor(failure.agent, configuredAgent(monitorConfig, failure.agent), catalogById.get(failure.agent));
    const card = monitorCardForFailure(failure, descriptor);
    agentData[failure.agent] = dataPanelForFailure(card, descriptor, failure);
  }

  return {
    timestamp: new Date().toISOString(),
    runningAgents,
    recentCompletions,
    recentFailures,
    startableAgents,
    bootAgents,
    agentData,
  };
}

function coerceAgentVariable(value: unknown, descriptor: AgentVariableDescriptor): string | number | boolean | string[] | null {
  if (descriptor.type === 'toggle') {
    return Boolean(value);
  }
  if (descriptor.type === 'number' || descriptor.type === 'port') {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${descriptor.label} must be a number`);
    }
    return Math.floor(parsed);
  }
  if (descriptor.type === 'multiselect') {
    return Array.isArray(value) ? value.map(item => String(item)) : [];
  }
  if (descriptor.type === 'url') {
    const text = String(value ?? '').trim();
    if (text) {
      new URL(text);
    }
    return text;
  }
  if (descriptor.type === 'readonly' || descriptor.type === 'secretRef') {
    throw new Error(`${descriptor.label} cannot be edited here`);
  }
  return String(value ?? '').trim();
}

function findVariableDescriptor(agentName: string, key: string): AgentVariableDescriptor | undefined {
  const monitorConfig = readAgentMonitorConfig();
  const catalogItem = getAgentCatalogSnapshot().agents.find(agent => agent.id === agentName);
  const descriptor = buildAgentDescriptor(agentName, configuredAgent(monitorConfig, agentName), catalogItem);
  return descriptor.variables.find(variable => variable.key === key);
}

export function setAgentVariable(agentName: string, key: string, rawValue: unknown): AgentDataPanel {
  const variable = findVariableDescriptor(agentName, key);
  if (!variable || !variable.writable) {
    throw new Error(`Agent variable is not editable: ${agentName}.${key}`);
  }

  const value = coerceAgentVariable(rawValue, variable);

  if (agentName === 'environment-bridge' && ENVIRONMENT_BRIDGE_FIELDS.has(key)) {
    updateEnvironmentBridgeVariable(key, value);
  } else {
    if (!SERVICE_LIFECYCLE_FIELDS.has(key)) {
      throw new Error(`Agent variable is not editable: ${agentName}.${key}`);
    }
    const config = readAgentMonitorConfig();
    const catalogItem = getAgentCatalogSnapshot().agents.find(agent => agent.id === agentName);
    const descriptor = buildAgentDescriptor(agentName, configuredAgent(config, agentName), catalogItem);
    if (descriptor.kind !== 'service' && descriptor.kind !== 'connection') {
      throw new Error(`Finite work is configured through Trigger Manager: ${agentName}`);
    }
    const agent = configuredAgent(config, agentName) ?? defaultAgentCatalogEntry(agentName, descriptor.kind);
    if (!agent) {
      throw new Error(`Service is not present in lifecycle config: ${agentName}`);
    }
    const serviceUpdates: Record<string, unknown> = { [key]: value };
    if (key === 'startOnSystemBoot' && value === true) {
      serviceUpdates.enabled = true;
    }
    config.services = {
      ...config.services,
      [agentName]: { ...agent, ...serviceUpdates },
    };
    writeServiceConfig(config);
  }

  const snapshot = getAgentMonitorSnapshot();
  const panel = snapshot.agentData[agentName];
  if (!panel) {
    throw new Error(`Agent data unavailable after update: ${agentName}`);
  }
  return panel;
}

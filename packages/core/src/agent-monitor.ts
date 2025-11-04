/**
 * Agent Monitor - Track and monitor running agents
 * Provides real-time status and log streaming
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { existsSync, readFileSync } from 'node:fs';

export interface AgentStatus {
  name: string;
  pid?: number;
  status: 'running' | 'stopped' | 'error';
  startedAt?: string;
  lastActivity?: string;
  uptime?: number; // seconds
  errors?: string[];
}

export interface AgentRunMetrics {
  agent: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastRun?: string;
  lastError?: string;
  recentActivity: {
    last5m: number;
    last1h: number;
    today: number;
  };
  successRate: {
    last5m: number;
    last1h: number;
    overall: number;
  };
}

interface AgentRegistry {
  [agentName: string]: {
    pid: number;
    startTime: string;
  };
}

export interface AgentLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  agent: string;
}

/**
 * Get list of available agents
 */
export function listAvailableAgents(): string[] {
  const agentsDir = path.join(paths.brain, 'agents');

  if (!fs.existsSync(agentsDir)) {
    return [];
  }

  return fs.readdirSync(agentsDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => f.replace('.ts', ''));
}

/**
 * Read recent agent logs from audit trail
 */
export function getAgentLogs(agentName?: string, limit = 50): AgentLog[] {
  const today = new Date().toISOString().slice(0, 10);
  const auditFile = path.join(paths.logs, 'audit', `${today}.ndjson`);

  if (!fs.existsSync(auditFile)) {
    return [];
  }

  const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
  const logs: AgentLog[] = [];
  const knownAgents = new Set(listAvailableAgents());

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
    } catch {
      // Skip invalid JSON
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

  const isComplete = (m: string) => {
    const s = m.toLowerCase();
    return (
      s === 'agent_completed' ||
      s === 'agent_cycle_completed' ||
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
  const completed = logs.filter(l => isComplete(l.message)).length;
  const failed = logs.filter(l => isFail(l.message, l.level)).length;

  const lastRunLog = logs.filter(l => isStart(l.message)).slice(-1)[0];

  return {
    totalRuns: started,
    successfulRuns: completed,
    failedRuns: failed,
    lastRun: lastRunLog?.timestamp,
  };
}

/**
 * Get processing status from recent runs
 */
export function getProcessingStatus(): {
  totalMemories: number;
  processedMemories: number;
  unprocessedMemories: number;
} {
  const episodicDir = paths.episodic;
  let total = 0;
  let processed = 0;

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const memory = JSON.parse(content);
          total++;

          if (memory.metadata?.processed) {
            processed++;
          }
        } catch {
          // Skip invalid files
        }
      }
    }
  };

  walk(episodicDir);

  return {
    totalMemories: total,
    processedMemories: processed,
    unprocessedMemories: total - processed,
  };
}

/**
 * Agent registry path
 */
const getRegistryPath = () => path.join(paths.logs, 'agents', 'running.json');

/**
 * Read agent registry
 */
function readRegistry(): AgentRegistry {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write agent registry
 */
function writeRegistry(registry: AgentRegistry): void {
  const registryPath = getRegistryPath();
  const dir = path.dirname(registryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * Register a running agent
 */
export function registerAgent(name: string, pid: number): void {
  const registry = readRegistry();
  registry[name] = {
    pid,
    startTime: new Date().toISOString(),
  };
  writeRegistry(registry);
}

/**
 * Unregister an agent
 */
export function unregisterAgent(name: string): void {
  const registry = readRegistry();
  delete registry[name];
  writeRegistry(registry);
}

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 checks if process exists
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current agent statuses
 */
export function getAgentStatuses(): AgentStatus[] {
  const registry = readRegistry();
  const availableAgents = listAvailableAgents();
  const statuses: AgentStatus[] = [];

  // Clean up stale entries
  const cleanRegistry: AgentRegistry = {};
  for (const [name, info] of Object.entries(registry)) {
    if (isProcessRunning(info.pid)) {
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
    const lockPath = path.join(paths.run, 'locks', `${lockName}.lock`);
    if (!existsSync(lockPath)) return null;
    try {
      const txt = readFileSync(lockPath, 'utf8');
      const data = JSON.parse(txt || '{}');
      if (data?.pid && isProcessRunning(data.pid)) {
        return { pid: data.pid, startTime: data.startedAt || new Date().toISOString() };
      }
    } catch {}
    return null;
  };

  // Build status for each available agent
  for (const name of availableAgents) {
    let registryInfo = cleanRegistry[name];
    // Fallback: if not in registry and is service, consult lock file
    if (!registryInfo) {
      const lockInfo = readServiceLock(name);
      if (lockInfo) {
        registryInfo = { pid: lockInfo.pid, startTime: lockInfo.startTime } as any;
      }
    }
    const logs = getAgentLogs(name, 100);

    let status: AgentStatus['status'] = 'stopped';
    let lastActivity: string | undefined;
    let uptime: number | undefined;

    // Helpers to classify events
    const isComplete = (m: string) => {
      const s = m?.toLowerCase?.() || '';
      return (
        s === 'agent_completed' ||
        s === 'agent_cycle_completed' ||
        s.includes('generated new insight') ||
        s.includes('triggered') ||
        s.includes('finished') ||
        s.includes('completed')
      );
    };

    if (registryInfo && isProcessRunning(registryInfo.pid)) {
      status = 'running';
      const startTime = new Date(registryInfo.startTime).getTime();
      uptime = Math.floor((Date.now() - startTime) / 1000);

      // Find last activity from logs
      const recentLogs = logs.slice(-10);
      if (recentLogs.length > 0) {
        lastActivity = recentLogs[recentLogs.length - 1].timestamp;
      }
    } else if (logs.length > 0) {
      // Reset error state as soon as a successful completion occurs
      const significant = logs.filter(l => l.level === 'error' || isComplete(l.message));
      const lastSig = significant[significant.length - 1];
      if (lastSig && lastSig.level === 'error') {
        status = 'error';
      } else {
        status = 'stopped';
      }
    }

    statuses.push({
      name,
      pid: registryInfo?.pid,
      status,
      startedAt: registryInfo?.startTime,
      lastActivity,
      uptime,
      errors: logs.filter(l => l.level === 'error').slice(-3).map(l => l.message),
    });
  }

  return statuses;
}

/**
 * Check if an agent is currently running
 */
export function isAgentRunning(name: string): boolean {
  const registry = readRegistry();
  const info = registry[name];
  if (!info) return false;
  return isProcessRunning(info.pid);
}

/**
 * Get all currently running agents
 */
export function getRunningAgents(): Array<{ name: string; pid: number; startTime: string }> {
  const registry = readRegistry();
  const running: Array<{ name: string; pid: number; startTime: string }> = [];

  for (const [name, info] of Object.entries(registry)) {
    if (isProcessRunning(info.pid)) {
      running.push({
        name,
        pid: info.pid,
        startTime: info.startTime,
      });
    }
  }

  return running;
}

/**
 * Stop a running agent
 */
export function stopAgent(name: string, force = false): { success: boolean; message: string; pid?: number } {
  const registry = readRegistry();
  const info = registry[name];

  if (!info) {
    return { success: false, message: `Agent '${name}' is not in the registry` };
  }

  if (!isProcessRunning(info.pid)) {
    // Clean up stale entry
    unregisterAgent(name);
    return { success: false, message: `Agent '${name}' is not running (cleaned up stale entry)` };
  }

  try {
    process.kill(info.pid, force ? 'SIGKILL' : 'SIGTERM');
    unregisterAgent(name);
    return {
      success: true,
      message: `Sent ${force ? 'SIGKILL' : 'SIGTERM'} to ${name}`,
      pid: info.pid,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to stop ${name}: ${(error as Error).message}`,
      pid: info.pid,
    };
  }
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

  const isComplete = (m: string) => {
    const s = m.toLowerCase();
    return (
      s === 'agent_completed' ||
      s === 'agent_cycle_completed' ||
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
  const totalCompleted = logs.filter(l => isComplete(l.message)).length;
  const totalFailed = logs.filter(l => isFail(l.message, l.level)).length;

  const last5mStarts = last5m.filter(l => isStart(l.message)).length;
  const last5mCompleted = last5m.filter(l => isComplete(l.message)).length;
  const last5mFailed = last5m.filter(l => isFail(l.message, l.level)).length;

  const last1hStarts = last1h.filter(l => isStart(l.message)).length;
  const last1hCompleted = last1h.filter(l => isComplete(l.message)).length;
  const last1hFailed = last1h.filter(l => isFail(l.message, l.level)).length;

  const lastRunLog = logs.filter(l => isStart(l.message)).slice(-1)[0];
  const lastErrorLog = logs.filter(l => l.level === 'error').slice(-1)[0];

  const result: AgentRunMetrics = {
    agent: agentName,
    totalRuns: totalStarts,
    successfulRuns: totalCompleted,
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

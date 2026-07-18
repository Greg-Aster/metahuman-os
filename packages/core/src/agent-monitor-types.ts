import type { EnvironmentBridgeDiagnosticsSnapshot } from './environment-interface/diagnostics.js';

export interface AgentStatus {
  name: string;
  pid?: number;
  status: 'running' | 'stopped' | 'error';
  startedAt?: string;
  lastActivity?: string;
  uptime?: number;
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

export interface AgentFailureEntry {
  agent: string;
  timestamp: string;
  pid?: number;
  exitCode?: number | null;
  error: string;
  stderr?: string;
  stdout?: string;
  source?: string;
}

export interface AgentError {
  timestamp: string;
  agent: string;
  message: string;
  source?: string;
  pid?: number;
  exitCode?: number | null;
  stderr?: string;
  stdout?: string;
}

export interface AgentLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  agent: string;
}

export type AgentKind = 'service' | 'scheduled' | 'manual' | 'connection' | 'one-shot';
export type AgentVariableType = 'text' | 'number' | 'port' | 'url' | 'select' | 'multiselect' | 'toggle' | 'secretRef' | 'readonly';
export type AgentVariableApplyMode = 'live' | 'restart' | 'nextBoot' | 'readonly';

export interface AgentVariableDescriptor {
  key: string;
  label: string;
  type: AgentVariableType;
  value: string | number | boolean | string[] | null;
  applyMode: AgentVariableApplyMode;
  writable: boolean;
  description?: string;
  options?: string[];
}

export interface AgentDescriptor {
  id: string;
  name: string;
  description: string;
  kind: AgentKind;
  startable: boolean;
  bootEligible: boolean;
  dependencyNotes?: string[];
  variables: AgentVariableDescriptor[];
}

export interface AgentMonitorCard {
  name: string;
  displayName: string;
  description: string;
  kind: AgentKind;
  status: 'running' | 'stopped' | 'error';
  pid?: number;
  uptime?: number;
  startedAt?: string;
  lastActivity?: string;
  metrics: AgentRunMetrics;
  errors: string[];
}

export interface AgentDataPanel {
  agentId: string;
  displayName: string;
  description: string;
  kind: AgentKind;
  lifecycle: AgentMonitorCard['status'];
  pid?: number;
  uptime?: number;
  readiness: 'ready' | 'not-ready' | 'failed' | 'unknown';
  dependencyHealth: 'ok' | 'configured' | 'connecting' | 'missing' | 'unavailable' | 'failed' | 'unknown';
  latestTask?: string;
  variables: AgentVariableDescriptor[];
  logs: AgentLog[];
  errors: AgentError[];
  diagnostics?: EnvironmentBridgeDiagnosticsSnapshot;
}

export interface AgentMonitorSnapshot {
  timestamp: string;
  runningAgents: AgentMonitorCard[];
  recentCompletions: AgentMonitorCard[];
  recentFailures: AgentMonitorCard[];
  startableAgents: AgentDescriptor[];
  bootAgents: AgentBootEntry[];
  agentData: Record<string, AgentDataPanel>;
}

export interface AgentBootEntry {
  agentId: string;
  displayName: string;
  description: string;
  kind: AgentKind;
  enabled: boolean;
  startOnSystemBoot: boolean;
  autoRestart: boolean;
  maxRetries: number;
  dependencyNotes: string[];
}

export type AgentCatalogEntry = Record<string, unknown> & {
  id?: string;
  enabled?: boolean;
  type?: string;
  priority?: string;
  usesLLM?: boolean;
  interval?: number;
  inactivityThreshold?: number;
  startOnSystemBoot?: boolean;
  autoRestart?: boolean;
  maxRetries?: number;
  comment?: string;
};

export interface AgentMonitorConfig {
  agents?: Record<string, AgentCatalogEntry>;
  services?: Record<string, AgentCatalogEntry>;
}

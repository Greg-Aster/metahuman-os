import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './path-builder.js';
import {
  getEnvironmentActionSubscriberCount,
  readEnvironmentBridgeState,
  setEnvironmentBridgeEnabled,
  summarizeEnvironmentBridgeState,
} from './environment-interface/index.js';
import type {
  AgentBootEntry,
  AgentDescriptor,
  AgentKind,
  AgentVariableDescriptor,
  SchedulerAgentConfig,
  SchedulerConfigFile,
} from './agent-monitor-types.js';

export const DESCRIPTORS: Record<string, Omit<AgentDescriptor, 'variables'>> = {
  organizer: {
    id: 'organizer',
    name: 'Organizer',
    description: 'Enriches memories with tags, entities, and metadata.',
    kind: 'scheduled',
    startable: true,
    bootEligible: true,
  },
  reflector: {
    id: 'reflector',
    name: 'Mind Wandering',
    description: 'Generates reflections after conversation inactivity.',
    kind: 'scheduled',
    startable: true,
    bootEligible: true,
  },
  'scheduler-service': {
    id: 'scheduler-service',
    name: 'Scheduler Service',
    description: 'Runs the scheduled agent timer bus.',
    kind: 'service',
    startable: false,
    bootEligible: true,
  },
  'audio-organizer': {
    id: 'audio-organizer',
    name: 'Audio Organizer',
    description: 'Processes the audio inbox into transcripts and memories.',
    kind: 'one-shot',
    startable: true,
    bootEligible: true,
    dependencyNotes: ['Runs once at startup when enabled; heavy audio processing should stay disabled unless needed.'],
  },
  'environment-bridge': {
    id: 'environment-bridge',
    name: 'Environment Bridge',
    description: 'Transfers semantic actions and observations through a configured environment adapter.',
    kind: 'connection',
    startable: true,
    bootEligible: true,
    dependencyNotes: ['Requires internal and adapter tokens plus a WebSocket adapter URL.'],
  },
};

export const SCHEDULER_AGENT_FIELDS = new Set([
  'enabled',
  'runOnBoot',
  'autoRestart',
  'maxRetries',
  'interval',
  'inactivityThreshold',
  'adapterUrl',
  'graph',
]);

export const ENVIRONMENT_BRIDGE_FIELDS = new Set([
  'deliveryEnabled',
]);

export function schedulerConfigPath(): string {
  return path.join(systemPaths.root, 'etc', 'agents.json');
}

export function readSchedulerConfig(): SchedulerConfigFile {
  try {
    return JSON.parse(fs.readFileSync(schedulerConfigPath(), 'utf8')) as SchedulerConfigFile;
  } catch {
    return { agents: {} };
  }
}

export function writeSchedulerConfig(config: SchedulerConfigFile): void {
  fs.writeFileSync(schedulerConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

function labelFromId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function inferKind(id: string, config?: SchedulerAgentConfig): AgentKind {
  if (id.endsWith('-service')) return 'service';
  if (config?.type === 'manual') return 'manual';
  if (config?.type === 'interval' || config?.type === 'activity' || config?.type === 'time-of-day') return 'scheduled';
  return 'one-shot';
}

function defaultAgentPath(id: string): string {
  const servicePath = path.join(systemPaths.brain, 'services', `${id}.ts`);
  if (fs.existsSync(servicePath)) return `services/${id}.ts`;
  const modularCli = path.join(systemPaths.agents, id, 'cli.ts');
  if (fs.existsSync(modularCli)) return `${id}/cli.ts`;
  const modularIndex = path.join(systemPaths.agents, id, 'index.ts');
  if (fs.existsSync(modularIndex)) return `${id}/index.ts`;
  return `${id}.ts`;
}

function hasRunnableAgentSource(id: string): boolean {
  return [
    path.join(systemPaths.brain, 'services', `${id}.ts`),
    path.join(systemPaths.agents, id, 'cli.ts'),
    path.join(systemPaths.agents, id, 'index.ts'),
    path.join(systemPaths.agents, `${id}.ts`),
  ].some(candidate => fs.existsSync(candidate));
}

export function defaultSchedulerAgentConfig(id: string, kind: AgentKind): SchedulerAgentConfig {
  const runsByDefault = id === 'scheduler-service' || id === 'audio-organizer';
  return {
    id,
    enabled: true,
    type: kind === 'scheduled' ? 'interval' : 'manual',
    priority: 'normal',
    agentPath: defaultAgentPath(id),
    usesLLM: false,
    runOnBoot: runsByDefault,
    autoRestart: kind === 'service' || kind === 'connection',
    maxRetries: kind === 'service' || kind === 'connection' ? 3 : 1,
  };
}

function schedulerVariables(config: SchedulerAgentConfig | undefined, id: string, kind: AgentKind, bootEligible: boolean): AgentVariableDescriptor[] {
  if (!config && !bootEligible) return [];
  const effective = config ?? defaultSchedulerAgentConfig(id, kind);

  const variables: AgentVariableDescriptor[] = [
    {
      key: 'enabled',
      label: 'Enabled',
      type: 'toggle',
      value: effective.enabled ?? false,
      applyMode: 'restart',
      writable: true,
      description: 'Whether scheduler-managed runs are enabled for this agent.',
    },
    {
      key: 'runOnBoot',
      label: 'Run On Boot',
      type: 'toggle',
      value: effective.runOnBoot ?? false,
      applyMode: 'nextBoot',
      writable: true,
      description: 'Start this agent when MetaHuman OS boots.',
    },
    {
      key: 'autoRestart',
      label: 'Auto Restart',
      type: 'toggle',
      value: effective.autoRestart ?? false,
      applyMode: 'restart',
      writable: true,
      description: 'Restart this agent after failures when the scheduler supports it.',
    },
    {
      key: 'maxRetries',
      label: 'Max Retries',
      type: 'number',
      value: effective.maxRetries ?? 0,
      applyMode: 'restart',
      writable: true,
    },
  ];

  if (typeof effective.interval === 'number') {
    variables.push({
      key: 'interval',
      label: 'Interval Seconds',
      type: 'number',
      value: effective.interval,
      applyMode: 'restart',
      writable: true,
    });
  }

  if (typeof effective.inactivityThreshold === 'number') {
    variables.push({
      key: 'inactivityThreshold',
      label: 'Idle Threshold Seconds',
      type: 'number',
      value: effective.inactivityThreshold,
      applyMode: 'restart',
      writable: true,
    });
  }

  if (id === 'environment-bridge') {
    variables.push(
      {
        key: 'adapterUrl',
        label: 'Adapter URL',
        type: 'url',
        value: typeof effective.adapterUrl === 'string' ? effective.adapterUrl : '',
        applyMode: 'restart',
        writable: true,
        description: 'Authenticated full-duplex WebSocket endpoint exposed by the environment adapter.',
      },
      {
        key: 'graph',
        label: 'Graph',
        type: 'text',
        value: typeof effective.graph === 'string' ? effective.graph : 'environment',
        applyMode: 'restart',
        writable: true,
        description: 'Cognitive graph mode used for returned observations.',
      },
    );
  }

  return variables;
}

function environmentBridgeVariables(): AgentVariableDescriptor[] {
  const state = readEnvironmentBridgeState();
  const summary = summarizeEnvironmentBridgeState(state);
  const activeSessions = summary.sessions.filter(session => session.status === 'connected');
  const latestSession = summary.sessions
    .slice()
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0];
  const connectedRobots = activeSessions
    .map(session => `${session.sessionId} (${session.adapter})`)
    .join(', ');
  return [
    {
      key: 'deliveryEnabled',
      label: 'Action Delivery',
      type: 'toggle',
      value: state.enabled,
      applyMode: 'live',
      writable: true,
      description: 'Allow connected robot gateways to receive actions.',
    },
    {
      key: 'serviceToken',
      label: 'Internal Token',
      type: 'readonly',
      value: process.env.MH_ENVIRONMENT_BRIDGE_TOKEN?.trim() ? 'Configured' : 'Missing',
      applyMode: 'readonly',
      writable: false,
      description: 'Loaded from MH_ENVIRONMENT_BRIDGE_TOKEN when MetaHuman OS starts.',
    },
    {
      key: 'adapterToken',
      label: 'Adapter Token',
      type: 'readonly',
      value: process.env.MH_ENVIRONMENT_ADAPTER_TOKEN?.trim() ? 'Configured' : 'Missing',
      applyMode: 'readonly',
      writable: false,
      description: 'Loaded from MH_ENVIRONMENT_ADAPTER_TOKEN when MetaHuman OS starts.',
    },
    {
      key: 'activeSessions',
      label: 'Active Robots',
      type: 'readonly',
      value: String(activeSessions.length),
      applyMode: 'readonly',
      writable: false,
    },
    {
      key: 'actionStreams',
      label: 'Action Streams',
      type: 'readonly',
      value: String(getEnvironmentActionSubscriberCount()),
      applyMode: 'readonly',
      writable: false,
    },
    {
      key: 'connectedRobots',
      label: 'Connected Robots',
      type: 'readonly',
      value: connectedRobots || 'None',
      applyMode: 'readonly',
      writable: false,
    },
    {
      key: 'lastContact',
      label: 'Last Robot Contact',
      type: 'readonly',
      value: latestSession?.lastSeenAt ?? 'Never',
      applyMode: 'readonly',
      writable: false,
    },
  ];
}

export function buildAgentDescriptor(id: string, schedulerConfig?: SchedulerAgentConfig): AgentDescriptor {
  const known = DESCRIPTORS[id];
  const kind = known?.kind ?? inferKind(id, schedulerConfig);
  const bootEligible = known?.bootEligible ?? false;
  return {
    id,
    name: known?.name ?? labelFromId(id),
    description: known?.description ?? schedulerConfig?.comment ?? 'Background MetaHuman agent.',
    kind,
    startable: known?.startable ?? hasRunnableAgentSource(id),
    bootEligible,
    dependencyNotes: known?.dependencyNotes ?? [],
    variables: [
      ...schedulerVariables(schedulerConfig, id, kind, bootEligible),
      ...(id === 'environment-bridge' ? environmentBridgeVariables() : []),
    ],
  };
}

export function variableValue(descriptor: AgentDescriptor, key: string): string | number | boolean | string[] | null | undefined {
  return descriptor.variables.find(variable => variable.key === key)?.value;
}

export function bootEntryForDescriptor(descriptor: AgentDescriptor): AgentBootEntry {
  return {
    agentId: descriptor.id,
    displayName: descriptor.name,
    description: descriptor.description,
    kind: descriptor.kind,
    enabled: Boolean(variableValue(descriptor, 'enabled')),
    runOnBoot: Boolean(variableValue(descriptor, 'runOnBoot')),
    autoRestart: Boolean(variableValue(descriptor, 'autoRestart')),
    maxRetries: Number(variableValue(descriptor, 'maxRetries') ?? 0),
    dependencyNotes: descriptor.dependencyNotes ?? [],
  };
}

export function updateEnvironmentBridgeVariable(key: string, value: string | number | boolean | string[] | null): void {
  if (key !== 'deliveryEnabled') {
    throw new Error(`Environment Bridge variable is not editable: ${key}`);
  }
  setEnvironmentBridgeEnabled(Boolean(value));
}

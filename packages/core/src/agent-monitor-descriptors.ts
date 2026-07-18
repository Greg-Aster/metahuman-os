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
  AgentCatalogEntry,
  AgentMonitorConfig,
} from './agent-monitor-types.js';
import type { AgentCatalogItem } from './agent-catalog.js';
import { AGENT_CATALOG_DEFINITIONS, getAgentCatalogDefinition, type AgentCatalogDefinition } from './agent-catalog-definitions.js';

function monitorKind(definition: AgentCatalogDefinition): AgentKind {
  if (definition.id === 'environment-bridge') return 'connection';
  if (definition.lifecycle === 'service') return 'service';
  if (definition.id === 'audio-organizer') return 'one-shot';
  if (definition.defaultTrigger?.type === 'manual') return 'manual';
  return 'scheduled';
}

export const DESCRIPTORS: Record<string, Omit<AgentDescriptor, 'variables'>> = Object.fromEntries(
  Object.values(AGENT_CATALOG_DEFINITIONS).map(definition => [definition.id, {
    id: definition.id,
    name: definition.displayName,
    description: definition.description,
    kind: monitorKind(definition),
    startable: true,
    bootEligible: definition.lifecycle === 'service',
    dependencyNotes: definition.id === 'environment-bridge'
      ? ['Requires internal and adapter tokens plus a WebSocket adapter URL.']
      : definition.id === 'audio-organizer'
        ? ['Finite audio processing runs through the Work Coordinator only when explicitly requested.']
        : [],
  }]),
);

export const SERVICE_LIFECYCLE_FIELDS = new Set([
  'enabled',
  'startOnSystemBoot',
  'autoRestart',
  'maxRetries',
  'interval',
  'inactivityThreshold',
  'adapterUrl',
  'graph',
  'jitterMs',
  'boredomMovementInactivityThreshold',
  'boredomMovementJitterMs',
  'maxCycleSteps',
  'sessionId',
]);

export const ENVIRONMENT_BRIDGE_FIELDS = new Set([
  'deliveryEnabled',
]);

export function triggerConfigPath(): string {
  return path.join(systemPaths.root, 'etc', 'agents.json');
}

export function serviceConfigPath(): string {
  return path.join(systemPaths.root, 'etc', 'services.json');
}

export function readAgentMonitorConfig(): AgentMonitorConfig {
  let agents: AgentMonitorConfig['agents'] = {};
  let services: AgentMonitorConfig['services'] = {};
  try {
    const triggerConfig = JSON.parse(fs.readFileSync(triggerConfigPath(), 'utf8')) as AgentMonitorConfig;
    agents = triggerConfig.agents ?? {};
  } catch {}
  try {
    const serviceConfig = JSON.parse(fs.readFileSync(serviceConfigPath(), 'utf8')) as AgentMonitorConfig;
    services = serviceConfig.services ?? {};
  } catch {}
  return { agents, services };
}

export function writeServiceConfig(config: AgentMonitorConfig): void {
  const serviceConfig = {
    $schema: 'https://metahuman.dev/schemas/services.json',
    version: '1.0.0',
    description: 'Persistent service lifecycle configuration',
    services: config.services ?? {},
  };
  const temporaryPath = `${serviceConfigPath()}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(serviceConfig, null, 2)}\n`);
  fs.renameSync(temporaryPath, serviceConfigPath());
}

function labelFromId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function inferKind(id: string, config?: AgentCatalogEntry): AgentKind {
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

export function defaultAgentCatalogEntry(id: string, kind: AgentKind): AgentCatalogEntry {
  const definition = getAgentCatalogDefinition(id);
  const persistent = definition?.lifecycle === 'service' || kind === 'service' || kind === 'connection';
  return {
    id,
    enabled: true,
    type: definition?.defaultTrigger?.type ?? (kind === 'scheduled' ? 'interval' : 'manual'),
    priority: definition?.priority ?? 'normal',
    agentPath: defaultAgentPath(id),
    usesLLM: definition?.usesLLM ?? false,
    startOnSystemBoot: persistent,
    autoRestart: persistent,
    maxRetries: persistent ? 3 : 1,
  };
}

function serviceLifecycleVariables(config: AgentCatalogEntry | undefined, id: string, kind: AgentKind, bootEligible: boolean): AgentVariableDescriptor[] {
  if (!config && !bootEligible) return [];
  const effective = config ?? defaultAgentCatalogEntry(id, kind);

  if (kind !== 'service' && kind !== 'connection') return [];

  const variables: AgentVariableDescriptor[] = [
    {
      key: 'enabled',
      label: 'Enabled',
      type: 'toggle',
      value: effective.enabled ?? false,
      applyMode: 'restart',
      writable: true,
      description: 'Whether this persistent service or connection is enabled.',
    },
    {
      key: 'startOnSystemBoot',
      label: 'Start On System Boot',
      type: 'toggle',
      value: effective.startOnSystemBoot ?? false,
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
      description: 'Restart this persistent service after a supervised failure.',
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

  if (typeof effective.jitterMs === 'number') {
    variables.push({
      key: 'jitterMs',
      label: 'Timer Jitter Milliseconds',
      type: 'number',
      value: effective.jitterMs,
      applyMode: 'restart',
      writable: true,
    })
  }

  if (typeof effective.maxCycleSteps === 'number') {
    variables.push({
      key: 'maxCycleSteps',
      label: 'Maximum Observation Steps',
      type: 'number',
      value: effective.maxCycleSteps,
      applyMode: 'restart',
      writable: true,
    })
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

  if (id === 'robot-operator') {
    variables.push(
      {
        key: 'boredomMovementInactivityThreshold',
        label: 'Boredom Movement Idle Seconds',
        type: 'number',
        value: typeof effective.boredomMovementInactivityThreshold === 'number'
          ? effective.boredomMovementInactivityThreshold
          : 600,
        applyMode: 'restart',
        writable: true,
        description: 'How long the robot must remain idle before Boredom Movement becomes due.',
      },
      {
        key: 'boredomMovementJitterMs',
        label: 'Boredom Movement Jitter Milliseconds',
        type: 'number',
        value: typeof effective.boredomMovementJitterMs === 'number'
          ? effective.boredomMovementJitterMs
          : 120000,
        applyMode: 'restart',
        writable: true,
        description: 'Random variation applied around the Boredom Movement idle threshold.',
      },
      {
        key: 'graph',
        label: 'Observation Graph',
        type: 'text',
        value: typeof effective.graph === 'string' ? effective.graph : 'environment',
        applyMode: 'restart',
        writable: true,
        description: 'Existing cognitive graph used after Robot Observer receives a correlated image.',
      },
      {
        key: 'sessionId',
        label: 'Target Robot Session',
        type: 'text',
        value: typeof effective.sessionId === 'string' ? effective.sessionId : '',
        applyMode: 'restart',
        writable: true,
        description: 'Optional fixed robot session. Leave blank to use the current connected robot.',
      },
    )
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

export function buildAgentDescriptor(id: string, catalogEntry?: AgentCatalogEntry, catalogItem?: AgentCatalogItem): AgentDescriptor {
  const known = DESCRIPTORS[id];
  const kind = known?.kind ?? inferKind(id, catalogEntry);
  const bootEligible = known?.bootEligible ?? false;
  return {
    id,
    name: catalogItem?.displayName ?? known?.name ?? labelFromId(id),
    description: catalogItem?.description ?? known?.description ?? catalogEntry?.comment ?? 'Background MetaHuman agent.',
    kind,
    startable: catalogItem?.canRun ?? known?.startable ?? hasRunnableAgentSource(id),
    bootEligible,
    dependencyNotes: known?.dependencyNotes ?? [],
    variables: [
      ...serviceLifecycleVariables(catalogEntry, id, kind, bootEligible),
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
    startOnSystemBoot: Boolean(variableValue(descriptor, 'startOnSystemBoot')),
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

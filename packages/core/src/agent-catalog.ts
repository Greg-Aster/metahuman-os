import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_CATALOG_DEFINITIONS,
  canonicalAgentIdForSource,
  getAgentCatalogDefinition,
  sourceAgentId,
  type AgentCatalogDefinition,
  type AgentCatalogLifecycle,
  type AgentCatalogRisk,
  type AgentCatalogTriggerType,
} from './agent-catalog-definitions.js';
import { resolveAgentExecutablePath } from './agent-executable-resolver.js';
import { systemPaths } from './path-builder.js';
import { agentHandlerId } from './queue/agent-work-catalog.js';
import { getTriggerConfigService, type TriggerConfigService } from './queue/trigger-config-service.js';

export type AgentCatalogOwner = 'trigger-manager' | 'agent-monitor' | 'workflow' | 'available';
export type AgentCatalogHealth = 'ready' | 'available' | 'missing-source' | 'disabled';

export interface AgentCatalogItem {
  id: string;
  sourceAgentId: string;
  displayName: string;
  description: string;
  lifecycle: AgentCatalogLifecycle;
  owner: AgentCatalogOwner;
  health: AgentCatalogHealth;
  risk: AgentCatalogRisk;
  installed: boolean;
  sourceReady: boolean;
  sourcePath?: string;
  triggerRegistered: boolean;
  serviceRegistered: boolean;
  enabled: boolean;
  triggerType?: AgentCatalogTriggerType;
  handler: string;
  usesLLM: boolean;
  priority: 'low' | 'normal' | 'high';
  parentIds: string[];
  tags: string[];
  canRegister: boolean;
  canUnregister: boolean;
  canRun: boolean;
  statusReason: string;
}

export interface AgentCatalogSnapshot {
  generatedAt: string;
  revision: number;
  scope: 'system';
  counts: {
    total: number;
    installed: number;
    triggerRegistered: number;
    services: number;
    available: number;
    missingSource: number;
    workflowChildren: number;
  };
  agents: AgentCatalogItem[];
}

export interface AgentCatalogServiceOptions {
  agentsDir?: string;
  brainDir?: string;
  servicesConfigPath?: string;
  triggerConfigService?: TriggerConfigService;
}

interface DiscoveredSource {
  canonicalId: string;
  sourceId: string;
  path: string;
}

interface ServiceConfigEntry extends Record<string, unknown> {
  id?: string;
  enabled?: boolean;
  agentPath?: string;
  usesLLM?: boolean;
  priority?: string;
  comment?: string;
}

function labelFromId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function validAgentId(agentId: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agentId);
}

function readJsonObject(filePath: string): Record<string, any> {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export class AgentCatalogService {
  private readonly agentsDir: string;
  private readonly brainDir: string;
  private readonly servicesConfigPath: string;
  private readonly triggerConfig: TriggerConfigService;

  constructor(options: AgentCatalogServiceOptions = {}) {
    this.agentsDir = options.agentsDir ?? systemPaths.agents;
    this.brainDir = options.brainDir ?? systemPaths.brain;
    this.servicesConfigPath = options.servicesConfigPath ?? path.join(systemPaths.etc, 'services.json');
    this.triggerConfig = options.triggerConfigService ?? getTriggerConfigService();
  }

  private discoverSources(): Map<string, DiscoveredSource> {
    const discovered = new Map<string, DiscoveredSource>();
    if (!fs.existsSync(this.agentsDir)) return discovered;
    for (const entry of fs.readdirSync(this.agentsDir, { withFileTypes: true })) {
      let executable: string | undefined;
      let sourceId: string | undefined;
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        sourceId = entry.name.slice(0, -3);
        executable = path.join(this.agentsDir, entry.name);
      } else if (entry.isDirectory()) {
        sourceId = entry.name;
        executable = ['cli.ts', 'index.ts']
          .map(filename => path.join(this.agentsDir, entry.name, filename))
          .find(candidate => fs.existsSync(candidate));
      }
      if (!sourceId || !executable || !validAgentId(sourceId)) continue;
      const canonicalId = canonicalAgentIdForSource(sourceId);
      discovered.set(canonicalId, { canonicalId, sourceId, path: executable });
    }
    return discovered;
  }

  private resolveConfiguredPath(agentId: string, configuredPath?: unknown): string | undefined {
    if (typeof configuredPath === 'string' && configuredPath.trim()) {
      if (configuredPath.startsWith('coordinator:')) return configuredPath;
      const relative = configuredPath.startsWith('services/')
        ? path.join(this.brainDir, configuredPath)
        : path.join(this.agentsDir, configuredPath);
      if (fs.existsSync(relative)) return relative;
    }
    if (this.agentsDir === systemPaths.agents && this.brainDir === systemPaths.brain) {
      return resolveAgentExecutablePath(agentId) ?? undefined;
    }
    const definition = getAgentCatalogDefinition(agentId);
    if (definition?.servicePath) {
      const servicePath = path.join(this.brainDir, definition.servicePath);
      if (fs.existsSync(servicePath)) return servicePath;
    }
    const sourceId = sourceAgentId(agentId);
    return ['cli.ts', 'index.ts']
      .map(filename => path.join(this.agentsDir, sourceId, filename))
      .find(candidate => fs.existsSync(candidate));
  }

  private serviceConfig(): Record<string, ServiceConfigEntry> {
    const raw = readJsonObject(this.servicesConfigPath);
    return raw.services && typeof raw.services === 'object' && !Array.isArray(raw.services)
      ? raw.services as Record<string, ServiceConfigEntry>
      : {};
  }

  getSnapshot(): AgentCatalogSnapshot {
    const triggerRead = this.triggerConfig.load(false);
    const services = this.serviceConfig();
    const discovered = this.discoverSources();
    const ids = new Set([
      ...Object.keys(AGENT_CATALOG_DEFINITIONS),
      ...discovered.keys(),
      ...Object.keys(triggerRead.config.agents),
      ...Object.keys(services),
    ]);
    const agents = [...ids].sort().map(agentId => {
      const definition = getAgentCatalogDefinition(agentId);
      const trigger = triggerRead.config.agents[agentId];
      const service = services[agentId];
      const discoveredSource = discovered.get(agentId);
      const configuredPath = trigger?.agentPath ?? service?.agentPath;
      const sourcePath = discoveredSource?.path ?? this.resolveConfiguredPath(agentId, configuredPath);
      const lifecycle = service
        ? 'service'
        : trigger?.lifecycle ?? definition?.lifecycle ?? 'scheduled-work';
      const workflowReady = lifecycle === 'workflow' && Boolean((trigger?.handler ?? definition?.handler)?.startsWith('workflow.'));
      const sourceReady = workflowReady || Boolean(sourcePath && (sourcePath.startsWith('coordinator:') || fs.existsSync(sourcePath)));
      const triggerRegistered = Boolean(trigger);
      const serviceRegistered = Boolean(service);
      const installed = sourceReady;
      const enabled = trigger?.enabled ?? service?.enabled ?? false;
      const risk = definition?.risk ?? 'standard';
      const owner: AgentCatalogOwner = serviceRegistered
        ? 'agent-monitor'
        : triggerRegistered
          ? 'trigger-manager'
          : lifecycle === 'workflow'
            ? 'workflow'
            : 'available';
      const health: AgentCatalogHealth = !sourceReady
        ? 'missing-source'
        : (triggerRegistered || serviceRegistered) && !enabled
          ? 'disabled'
          : triggerRegistered || serviceRegistered
            ? 'ready'
            : 'available';
      const statusReason = !sourceReady
        ? 'Maintained executable or workflow handler is missing.'
        : serviceRegistered
          ? 'Persistent lifecycle is owned by Agent Monitor and services.json.'
          : triggerRegistered
            ? `${trigger?.type === 'manual' ? 'Manual' : 'Scheduled'} finite work is registered with Trigger Manager.`
            : 'Installed finite agent is available for manual runs or Trigger Manager registration.';
      const sourceId = discoveredSource?.sourceId ?? definition?.sourceId ?? agentId;
      return {
        id: agentId,
        sourceAgentId: sourceId,
        displayName: trigger?.displayName ?? definition?.displayName ?? labelFromId(agentId),
        description: trigger?.description ?? definition?.description ?? service?.comment ?? trigger?.comment ?? 'Installed MetaHuman agent.',
        lifecycle,
        owner,
        health,
        risk,
        installed,
        sourceReady,
        sourcePath: sourcePath
          ? sourcePath.startsWith('coordinator:') ? sourcePath : path.relative(this.brainDir, sourcePath)
          : undefined,
        triggerRegistered,
        serviceRegistered,
        enabled,
        triggerType: trigger?.type,
        handler: trigger?.handler ?? definition?.handler ?? agentHandlerId(agentId),
        usesLLM: trigger?.usesLLM ?? service?.usesLLM ?? definition?.usesLLM ?? true,
        priority: trigger?.priority ?? (service?.priority === 'low' || service?.priority === 'high' ? service.priority : undefined) ?? definition?.priority ?? 'normal',
        parentIds: definition?.parentIds ?? [],
        tags: definition?.tags ?? [],
        canRegister: sourceReady && lifecycle !== 'service' && !triggerRegistered,
        canUnregister: triggerRegistered,
        canRun: sourceReady && (serviceRegistered
          ? enabled
          : lifecycle !== 'service' && (triggerRegistered ? enabled : risk === 'standard')),
        statusReason,
      } satisfies AgentCatalogItem;
    });
    return {
      generatedAt: new Date().toISOString(),
      revision: triggerRead.revision,
      scope: 'system',
      counts: {
        total: agents.length,
        installed: agents.filter(agent => agent.installed).length,
        triggerRegistered: agents.filter(agent => agent.triggerRegistered).length,
        services: agents.filter(agent => agent.serviceRegistered).length,
        available: agents.filter(agent => agent.canRegister).length,
        missingSource: agents.filter(agent => !agent.sourceReady).length,
        workflowChildren: agents.filter(agent => agent.parentIds.length > 0).length,
      },
      agents,
    };
  }

  getAgent(agentId: string): AgentCatalogItem | undefined {
    return this.getSnapshot().agents.find(agent => agent.id === agentId);
  }

  register(agentId: string, actor: string): AgentCatalogSnapshot {
    if (!validAgentId(agentId)) throw new Error('Agent id must use lowercase kebab-case');
    const current = this.getAgent(agentId);
    if (!current) throw new Error(`Unknown installed agent: ${agentId}`);
    if (!current.canRegister) {
      if (current.triggerRegistered) throw new Error(`Agent is already registered: ${agentId}`);
      if (current.lifecycle === 'service') throw new Error(`${agentId} is a persistent service managed by Agent Monitor`);
      throw new Error(`Agent cannot be registered because its executable is missing: ${agentId}`);
    }
    const definition = getAgentCatalogDefinition(agentId);
    const defaultTrigger = definition?.defaultTrigger ?? { type: 'manual' as const };
    const config: Record<string, unknown> = {
      id: agentId,
      displayName: current.displayName,
      description: current.description,
      enabled: defaultTrigger.enabled ?? true,
      type: defaultTrigger.type,
      lifecycle: definition?.lifecycle ?? 'scheduled-work',
      handler: definition?.handler ?? agentHandlerId(agentId),
      priority: definition?.priority ?? 'normal',
      agentPath: current.sourcePath?.startsWith('agents/')
        ? current.sourcePath.slice('agents/'.length)
        : current.sourcePath,
      usesLLM: definition?.usesLLM ?? true,
      allowedModes: defaultTrigger.type === 'manual' || defaultTrigger.type === 'event'
        ? ['reactive', 'semi', 'full']
        : ['semi', 'full'],
      startupPolicy: 'skip',
      maxRetries: 1,
      comment: `Registered from Agent Catalog by ${actor}.`,
    };
    if (defaultTrigger.interval !== undefined) config.interval = defaultTrigger.interval;
    if (defaultTrigger.schedule !== undefined) config.schedule = defaultTrigger.schedule;
    if (defaultTrigger.inactivityThreshold !== undefined) config.inactivityThreshold = defaultTrigger.inactivityThreshold;
    if (defaultTrigger.eventPattern !== undefined) config.eventPattern = defaultTrigger.eventPattern;
    if (defaultTrigger.eventCountThreshold !== undefined) config.eventCountThreshold = defaultTrigger.eventCountThreshold;
    if (defaultTrigger.eventCountField !== undefined) config.eventCountField = defaultTrigger.eventCountField;
    if (defaultTrigger.idleResetSeconds !== undefined) config.idleResetSeconds = defaultTrigger.idleResetSeconds;
    this.triggerConfig.registerAgent(agentId, config, actor);
    return this.getSnapshot();
  }

  unregister(agentId: string, actor: string): AgentCatalogSnapshot {
    if (!validAgentId(agentId)) throw new Error('Agent id must use lowercase kebab-case');
    const current = this.getAgent(agentId);
    if (!current?.triggerRegistered) throw new Error(`Agent is not registered with Trigger Manager: ${agentId}`);
    this.triggerConfig.unregisterAgent(agentId, actor);
    return this.getSnapshot();
  }
}

let instance: AgentCatalogService | null = null;

export function getAgentCatalogService(): AgentCatalogService {
  if (!instance) instance = new AgentCatalogService();
  return instance;
}

export function resetAgentCatalogService(): void {
  instance = null;
}

export function getAgentCatalogSnapshot(): AgentCatalogSnapshot {
  return getAgentCatalogService().getSnapshot();
}

export function getCatalogDefinition(agentId: string): AgentCatalogDefinition | undefined {
  return getAgentCatalogDefinition(agentId);
}

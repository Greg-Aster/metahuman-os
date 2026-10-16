import type { AutonomyMode, TaskType } from './queue/types.js';

export type AgentCatalogLifecycle = 'scheduled-work' | 'workflow' | 'service';
export type AgentCatalogRisk = 'standard' | 'privileged' | 'destructive';
export type AgentCatalogTriggerType = 'interval' | 'time-of-day' | 'event' | 'activity' | 'manual';
export type AgentExecutionContext = 'user' | 'system';

export interface AgentCatalogDefaultTrigger {
  type: AgentCatalogTriggerType;
  enabled?: boolean;
  interval?: number;
  schedule?: string;
  inactivityThreshold?: number;
  eventPattern?: string;
  eventCountThreshold?: number;
  eventCountField?: string;
  idleResetSeconds?: number;
  probability?: number;
  jitterMs?: number;
  allowedModes?: AutonomyMode[];
  startupPolicy?: 'skip' | 'run-once' | 'recover-missed';
  maxRetries?: number;
}

export interface AgentCatalogDefinition {
  id: string;
  displayName: string;
  description: string;
  lifecycle: AgentCatalogLifecycle;
  /**
   * System services must not open an arbitrary profile merely to start.
   * User-scoped work defaults to an authenticated user context.
   */
  executionContext?: AgentExecutionContext;
  sourceId?: string;
  servicePath?: string;
  handler?: string;
  taskType?: TaskType;
  usesLLM: boolean;
  priority: 'low' | 'normal' | 'high';
  risk: AgentCatalogRisk;
  defaultTrigger?: AgentCatalogDefaultTrigger;
  defaultService?: { startOnSystemBoot: boolean; autoRestart: boolean; maxRetries: number };
  parentIds?: string[];
  tags?: string[];
  /** Internal worker hidden from public registration and manual-run surfaces. */
  internalOwner?: string;
}

/**
 * Canonical built-in agent metadata.
 *
 * Runtime registration remains in etc/agents.json and service lifecycle remains
 * in etc/services.json. This table describes what shipped source is and how an
 * unregistered finite agent may be safely introduced to Trigger Manager.
 */
export const AGENT_CATALOG_DEFINITIONS: Record<string, AgentCatalogDefinition> = {
  'audio-organizer': {
    id: 'audio-organizer',
    displayName: 'Audio Organizer',
    description: 'Converts completed audio transcripts into episodic memories when explicitly requested.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['audio', 'memory'],
  },
  curator: {
    id: 'curator',
    displayName: 'Curator',
    description: 'Curates memory records into higher-quality training material.',
    lifecycle: 'scheduled-work',
    taskType: 'training_curate',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['sleep-workflow'],
    tags: ['memory', 'training', 'sleep', 'workflow-child'],
  },
  'environment-training-curator': {
    id: 'environment-training-curator',
    displayName: 'Environment Training Curator',
    description: 'Reviews saved intent, task, and Freestyle attempts and proposes training corrections for human approval.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['environment', 'training', 'review'],
  },
  'environment-training-trainer': {
    id: 'environment-training-trainer',
    displayName: 'Environment Training Trainer',
    description: 'Fits reviewed intent and task adapters, evaluates them against frozen cases and exports GGUF LoRAs.',
    lifecycle: 'scheduled-work',
    usesLLM: false,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['environment', 'training'],
  },
  curiosity: {
    id: 'curiosity',
    sourceId: 'curiosity-service',
    displayName: 'Curiosity',
    description: 'Generates user-facing curiosity questions after conversation inactivity.',
    lifecycle: 'scheduled-work',
    handler: 'agent.curiosity-service',
    taskType: 'curiosity',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['curiosity', 'conversation'],
  },
  'curiosity-researcher': {
    id: 'curiosity-researcher',
    displayName: 'Curiosity Researcher',
    description: 'Independently researches pending user-facing curiosity questions and records grounded local-memory findings.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['curiosity', 'research'],
  },
  daydreamer: {
    id: 'daydreamer',
    displayName: 'Daydreamer',
    description: 'Creates brief internal daydreams during idle periods.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['dream', 'inner-dialogue'],
  },
  dreamer: {
    id: 'dreamer',
    displayName: 'Dreamer',
    description: 'Creates overnight dream narratives from lifetime memory fragments.',
    lifecycle: 'scheduled-work',
    taskType: 'dream',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['sleep-workflow'],
    tags: ['dream', 'sleep', 'workflow-child'],
  },
  'desire-agent': {
    id: 'desire-agent',
    sourceId: 'desire-generator',
    displayName: 'Desire Agent',
    description: 'Sole controller for reviewing persisted history, nurturing desires, planning approved work, executing it, and reviewing outcomes.',
    lifecycle: 'scheduled-work',
    handler: 'agent.desire-generator',
    taskType: 'desire_generate',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['sleep-workflow'],
    tags: ['agency', 'sleep', 'workflow-child', 'controller'],
  },
  'desire-planner': {
    id: 'desire-planner',
    displayName: 'Desire Planner',
    description: 'Builds executable plans for desires using cognitive graphs.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    parentIds: ['desire-agent'],
    tags: ['agency', 'internal-worker'],
    internalOwner: 'desire-agent',
  },
  'environment-bridge': {
    id: 'environment-bridge',
    displayName: 'Environment Bridge Worker',
    description: 'Shared singleton transport behind the Local and Remote agents.',
    lifecycle: 'service',
    executionContext: 'system',
    usesLLM: false,
    priority: 'high',
    risk: 'standard',
    internalOwner: 'agent-monitor',
    tags: ['environment', 'internal-worker'],
  },
  'environment-bridge-local': {
    id: 'environment-bridge-local',
    servicePath: 'agents/environment-bridge/local.ts',
    displayName: 'Environment Bridge Local',
    description: 'Connects directly to local Body Control without Cloudflare. Starting this agent switches from the remote connection.',
    lifecycle: 'service',
    executionContext: 'system',
    usesLLM: false,
    priority: 'high',
    risk: 'standard',
    tags: ['environment', 'connection', 'local'],
  },
  'environment-bridge-remote': {
    id: 'environment-bridge-remote',
    servicePath: 'agents/environment-bridge/remote.ts',
    displayName: 'Environment Bridge Remote',
    description: 'Connects to Body Control on a configured machine through SSH or Cloudflare Access. Starting this agent switches from the local connection.',
    lifecycle: 'service',
    executionContext: 'system',
    usesLLM: false,
    priority: 'high',
    risk: 'standard',
    tags: ['environment', 'connection', 'remote'],
  },
  'robot-status': {
    id: 'robot-status',
    displayName: 'Robot Status',
    description: 'Builds a compact situational snapshot from canonical robot telemetry, action history, conversation, and active Agency desires.',
    lifecycle: 'workflow',
    handler: 'workflow.robot-status',
    taskType: 'generic',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['robot-operator'],
    tags: ['robot', 'environment', 'agency', 'context'],
  },
  'robot-autonomy-controller': {
    id: 'robot-autonomy-controller',
    displayName: 'Robot Autonomy Controller',
    description: 'Evaluates activation levels for the supplied operations using the supplied context. Semi requests updates at 100; Full requests the highest returned activation.',
    lifecycle: 'workflow',
    handler: 'workflow.robot-autonomy-controller',
    taskType: 'generic',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual', allowedModes: ['semi', 'full'] },
    parentIds: ['robot-operator'],
    tags: ['robot', 'environment', 'autonomy', 'controller'],
  },
  'robot-goal-review': {
    id: 'robot-goal-review',
    displayName: 'Robot Goal Review',
    description: 'Reviews the current execution objective and returned evidence; may complete, continue, wait, request the user, abandon, speak, or select a catalog-backed activity.',
    lifecycle: 'workflow',
    handler: 'workflow.robot-goal-review',
    taskType: 'generic',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['robot-operator'],
    tags: ['robot', 'environment', 'task', 'context'],
  },
  'boredom-observer': {
    id: 'boredom-observer',
    displayName: 'Boredom Observer',
    description: 'Uses one fresh correlated image plus persona and bounded context to author a high-level observation interest for Robot Autonomy Executor.',
    lifecycle: 'workflow',
    handler: 'workflow.boredom-observer',
    taskType: 'generic',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['robot-operator'],
    tags: ['robot', 'environment', 'vision'],
  },
  'boredom-movement': {
    id: 'boredom-movement',
    displayName: 'Boredom Movement',
    description: 'Uses persona, current state, bounded context, and advertised capabilities to author an embodied intention for Robot Autonomy Executor.',
    lifecycle: 'workflow',
    handler: 'workflow.boredom-movement',
    taskType: 'generic',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['robot-operator'],
    tags: ['robot', 'environment', 'engagement', 'autonomy'],
  },
  'boredom-reflection': {
    id: 'boredom-reflection',
    displayName: 'Boredom Reflection',
    description: 'Uses sampled historical memory, persona, and bounded context to author a memory-inspired intention for Robot Autonomy Executor.',
    lifecycle: 'workflow',
    handler: 'workflow.boredom-reflection',
    taskType: 'generic',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['robot-operator'],
    tags: ['robot', 'memory', 'reflection', 'autonomy'],
  },
  'robot-operator': {
    id: 'robot-operator',
    displayName: 'Active Operator',
    sourceId: 'active-operator',
    description: 'Coordinates robot autonomy. Reactive keeps this agent dormant. Semi selects activation updates at 100; Full selects the highest returned activation. Uses the existing Work Coordinator and shared Environment workflow.',
    lifecycle: 'service',
    executionContext: 'system',
    servicePath: 'agents/active-operator/index.ts',
    usesLLM: false,
    priority: 'normal',
    risk: 'standard',
    tags: ['robot', 'environment', 'autonomy'],
  },
  ingestor: {
    id: 'ingestor',
    displayName: 'Inbox Ingestor',
    description: 'Converts files in the memory inbox into episodic memories.',
    lifecycle: 'scheduled-work',
    usesLLM: false,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'interval', interval: 60 },
    tags: ['memory', 'inbox'],
  },
  'inner-curiosity': {
    id: 'inner-curiosity',
    displayName: 'Inner Curiosity',
    description: 'Generates and investigates self-directed questions as private inner dialogue.',
    lifecycle: 'scheduled-work',
    taskType: 'inner_curiosity',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['curiosity', 'inner-dialogue'],
  },
  terminal: {
    id: 'terminal',
    displayName: 'Terminal',
    description: 'Owns on-demand shell sessions, terminal screens, and Big Brother CLI execution.',
    lifecycle: 'service',
    executionContext: 'system',
    servicePath: 'services/terminal.ts',
    usesLLM: false,
    priority: 'normal',
    risk: 'privileged',
    tags: ['terminal', 'system'],
    defaultService: { startOnSystemBoot: false, autoRestart: false, maxRetries: 0 },
  },
  'maintenance-service': {
    id: 'maintenance-service',
    displayName: 'Maintenance Service',
    description: 'Performs stale-lock health checks, audit-log cleanup, and embedding preload.',
    lifecycle: 'service',
    executionContext: 'system',
    servicePath: 'services/maintenance-service.ts',
    usesLLM: false,
    priority: 'normal',
    risk: 'standard',
    tags: ['maintenance'],
  },
  'body-event-trigger': {
    id: 'body-event-trigger', displayName: 'Body Event Trigger',
    description: 'Analyze the supplied body event, its measurements, Robot Status, and current task.',
    lifecycle: 'scheduled-work', usesLLM: true, priority: 'high', risk: 'standard',
    defaultTrigger: { type: 'manual' }, tags: ['robot', 'environment', 'graph'],
  },
  mood: {
    id: 'mood',
    displayName: 'Mood',
    description: 'Reviews recent user conversation or inner dialogue and selects an enabled persona facet through the Mood Review graph.',
    lifecycle: 'scheduled-work',
    taskType: 'mood_review',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: {
      type: 'event',
      enabled: false,
      eventPattern: 'conversation.user-message.appended',
      eventCountThreshold: 10,
      eventCountField: 'userMessageCount',
      idleResetSeconds: 1800,
    },
    tags: ['persona', 'mood', 'conversation', 'graph'],
  },
  organizer: {
    id: 'organizer',
    displayName: 'Organizer',
    description: 'Enriches memories with tags, entities, and metadata.',
    lifecycle: 'scheduled-work',
    taskType: 'memory_curate',
    usesLLM: true,
    priority: 'high',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['sleep-workflow'],
    tags: ['memory', 'sleep', 'workflow-child'],
  },
  'profile-sync': {
    id: 'profile-sync',
    displayName: 'Profile Sync',
    description: 'Synchronizes profile configuration, credentials, and memory data.',
    lifecycle: 'scheduled-work',
    usesLLM: false,
    priority: 'high',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['profile', 'sync'],
  },
  psychoanalyzer: {
    id: 'psychoanalyzer',
    displayName: 'Psychotherapist',
    description: 'Reviews saved conversations and other recent memories, then proposes and applies validated persona updates during Sleep or manual review.',
    lifecycle: 'scheduled-work',
    taskType: 'psychoanalyze',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['sleep-workflow'],
    tags: ['persona', 'memory', 'sleep', 'workflow-child'],
  },
  reflector: {
    id: 'reflector',
    displayName: 'Mind Wandering',
    description: 'Generates reflections after conversation inactivity.',
    lifecycle: 'scheduled-work',
    taskType: 'reflect',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['reflection', 'memory'],
  },
  'sleep-workflow': {
    id: 'sleep-workflow',
    displayName: 'Sleep Workflow',
    description: 'Owns the bounded sequential memory, desire, dreaming, persona-review, and indexing cycle while the system sleeps.',
    lifecycle: 'workflow',
    handler: 'workflow.sleep',
    taskType: 'sleep_workflow',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'time-of-day', schedule: '02:00' },
    tags: ['sleep', 'workflow'],
  },
  'train-of-thought': {
    id: 'train-of-thought',
    displayName: 'Train of Thought',
    description: 'Extends a supplied thought or bounded memory seed through related historical memories and persists one reasoning chain.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['reflector', 'inner-curiosity'],
    tags: ['reasoning', 'memory', 'workflow-child'],
  },
};

export function getAgentCatalogDefinition(agentId: string): AgentCatalogDefinition | undefined {
  return AGENT_CATALOG_DEFINITIONS[agentId];
}

export function canonicalAgentIdForSource(sourceId: string): string {
  return Object.values(AGENT_CATALOG_DEFINITIONS)
    .find(definition => definition.sourceId === sourceId)?.id ?? sourceId;
}

export function sourceAgentId(agentId: string): string {
  return getAgentCatalogDefinition(agentId)?.sourceId ?? agentId;
}

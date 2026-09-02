import type { TaskType } from './queue/types.js';

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
  parentIds?: string[];
  tags?: string[];
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
    defaultTrigger: { type: 'activity', inactivityThreshold: 900 },
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
    defaultTrigger: { type: 'interval', interval: 3600 },
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
    defaultTrigger: { type: 'activity', inactivityThreshold: 300 },
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
  'desire-executor': {
    id: 'desire-executor',
    displayName: 'Desire Executor',
    description: 'Executes approved desire plans through the operator system.',
    lifecycle: 'scheduled-work',
    handler: 'agency.desire-execute',
    taskType: 'desire_execute',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['sleep-workflow'],
    tags: ['agency', 'sleep', 'workflow-child'],
  },
  'desire-generator': {
    id: 'desire-generator',
    displayName: 'Desire Generator',
    description: 'Synthesizes desires from goals, tasks, memories, and conversation patterns.',
    lifecycle: 'scheduled-work',
    taskType: 'desire_generate',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['sleep-workflow'],
    tags: ['agency', 'sleep', 'workflow-child'],
  },
  'desire-outcome-reviewer': {
    id: 'desire-outcome-reviewer',
    displayName: 'Desire Outcome Reviewer',
    description: 'Reviews completed and failed desire work to choose the next action.',
    lifecycle: 'scheduled-work',
    handler: 'agency.desire-outcome-review',
    taskType: 'desire_review',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['sleep-workflow'],
    tags: ['agency', 'sleep', 'workflow-child'],
  },
  'desire-planner': {
    id: 'desire-planner',
    displayName: 'Desire Planner',
    description: 'Builds executable plans for desires using cognitive graphs.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['sleep-workflow'],
    tags: ['agency', 'sleep', 'workflow-child'],
  },
  'environment-bridge': {
    id: 'environment-bridge',
    displayName: 'Environment Bridge',
    description: 'Transfers semantic actions and observations through a configured environment adapter.',
    lifecycle: 'service',
    executionContext: 'system',
    usesLLM: false,
    priority: 'high',
    risk: 'standard',
    tags: ['environment', 'connection'],
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
  'boredom-observer': {
    id: 'boredom-observer',
    displayName: 'Boredom Observer',
    description: 'Uses one fresh correlated image plus persona and bounded context to author a high-level observation interest for Boredom Autonomy.',
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
    description: 'Uses persona, current state, bounded context, and advertised capabilities to author an embodied intention for Boredom Autonomy.',
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
    description: 'Uses sampled historical memory, persona, and bounded context to author a memory-inspired intention for Boredom Autonomy.',
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
    displayName: 'Robot Operator',
    description: 'Owns robot-autonomy scheduling, cooldowns, mutual exclusion, and admission for Robot Status plus Boredom Observer, Movement, and Reflection while Active Operator is semi or full.',
    lifecycle: 'service',
    executionContext: 'system',
    servicePath: 'services/robot-operator.ts',
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
    defaultTrigger: { type: 'interval', interval: 3600 },
    tags: ['curiosity', 'inner-dialogue'],
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
    displayName: 'Psychoanalyzer',
    description: 'Applies deterministic, evidence-backed persona learning during Sleep or manual review.',
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
    defaultTrigger: { type: 'activity', inactivityThreshold: 900 },
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

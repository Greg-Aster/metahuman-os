import type { TaskType } from './queue/types.js';

export type AgentCatalogLifecycle = 'scheduled-work' | 'workflow' | 'service';
export type AgentCatalogRisk = 'standard' | 'privileged' | 'destructive';
export type AgentCatalogTriggerType = 'interval' | 'time-of-day' | 'event' | 'activity' | 'manual';

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
    parentIds: ['transcriber'],
    tags: ['audio', 'memory'],
  },
  'auto-indexer': {
    id: 'auto-indexer',
    displayName: 'Auto Indexer',
    description: 'Rebuilds the vector index when its configured maintenance window is due.',
    lifecycle: 'scheduled-work',
    taskType: 'index_build',
    usesLLM: false,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'time-of-day', schedule: '03:00' },
    tags: ['memory', 'index'],
  },
  coder: {
    id: 'coder',
    displayName: 'System Coder',
    description: 'Inspects captured system errors and prepares approval-gated code repair proposals.',
    lifecycle: 'scheduled-work',
    taskType: 'code_analyze',
    usesLLM: true,
    priority: 'low',
    risk: 'privileged',
    defaultTrigger: { type: 'manual' },
    tags: ['maintenance', 'code', 'approval-required'],
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
    defaultTrigger: { type: 'activity', inactivityThreshold: 600 },
    tags: ['memory', 'training'],
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
    description: 'Researches pending curiosity questions and saves supporting context.',
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
  digest: {
    id: 'digest',
    displayName: 'Digest',
    description: 'Builds long-term thematic understanding from memories and updates the persona cache.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'interval', interval: 86_400 },
    tags: ['memory', 'persona'],
  },
  dreamer: {
    id: 'dreamer',
    displayName: 'Dreamer',
    description: 'Creates overnight dream narratives and learnings from lifetime memory fragments.',
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
    taskType: 'desire_execute',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'interval', interval: 300 },
    tags: ['agency'],
  },
  'desire-explorer': {
    id: 'desire-explorer',
    displayName: 'Desire Explorer',
    description: 'Explores desire feasibility and generates context-aware questions.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'interval', interval: 120 },
    tags: ['agency'],
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
    defaultTrigger: { type: 'activity', inactivityThreshold: 600 },
    tags: ['agency'],
  },
  'desire-outcome-reviewer': {
    id: 'desire-outcome-reviewer',
    displayName: 'Desire Outcome Reviewer',
    description: 'Reviews completed and failed desire work to choose the next action.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'interval', interval: 600 },
    tags: ['agency'],
  },
  'desire-planner': {
    id: 'desire-planner',
    displayName: 'Desire Planner',
    description: 'Builds executable plans for desires using cognitive graphs.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'interval', interval: 300 },
    tags: ['agency'],
  },
  'environment-bridge': {
    id: 'environment-bridge',
    displayName: 'Environment Bridge',
    description: 'Transfers semantic actions and observations through a configured environment adapter.',
    lifecycle: 'service',
    usesLLM: false,
    priority: 'high',
    risk: 'standard',
    tags: ['environment', 'connection'],
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
    servicePath: 'services/maintenance-service.ts',
    usesLLM: false,
    priority: 'normal',
    risk: 'standard',
    tags: ['maintenance'],
  },
  'memory-pruner': {
    id: 'memory-pruner',
    displayName: 'Memory Pruner',
    description: 'Finds duplicate, contaminated, and low-quality memories and can move them out of active storage.',
    lifecycle: 'scheduled-work',
    usesLLM: false,
    priority: 'low',
    risk: 'destructive',
    defaultTrigger: { type: 'manual' },
    tags: ['memory', 'cleanup', 'destructive'],
  },
  'memory-sync': {
    id: 'memory-sync',
    displayName: 'Memory Sync',
    description: 'Synchronizes memory data with the configured remote profile service.',
    lifecycle: 'scheduled-work',
    usesLLM: false,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['memory', 'sync'],
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
    defaultTrigger: { type: 'activity', inactivityThreshold: 600 },
    tags: ['memory'],
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
    description: 'Reviews recent memories and incrementally updates persona understanding.',
    lifecycle: 'scheduled-work',
    taskType: 'psychoanalyze',
    usesLLM: true,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['persona', 'memory'],
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
    description: 'Queues bounded Dreamer and persona-review children through the Work Coordinator.',
    lifecycle: 'workflow',
    handler: 'workflow.sleep',
    taskType: 'sleep_workflow',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'time-of-day', schedule: '02:00' },
    tags: ['sleep', 'workflow'],
  },
  summarizer: {
    id: 'summarizer',
    displayName: 'Conversation Summarizer',
    description: 'Summarizes conversation sessions into concise overviews stored as episodic events.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'interval', interval: 3600 },
    tags: ['conversation', 'memory'],
  },
  'train-of-thought': {
    id: 'train-of-thought',
    displayName: 'Train of Thought',
    description: 'Performs recursive reasoning by following associations between memories.',
    lifecycle: 'scheduled-work',
    usesLLM: true,
    priority: 'low',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    parentIds: ['reflector'],
    tags: ['reasoning', 'workflow-child'],
  },
  transcriber: {
    id: 'transcriber',
    displayName: 'Transcriber',
    description: 'Transcribes audio inbox files with the configured Whisper provider.',
    lifecycle: 'scheduled-work',
    usesLLM: false,
    priority: 'normal',
    risk: 'standard',
    defaultTrigger: { type: 'manual' },
    tags: ['audio', 'transcription'],
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

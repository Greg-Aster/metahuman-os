/**
 * Work coordinator lifecycle facade.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { UnifiedQueueManager, getQueueManager, isDesireAgentAdmission } from './unified-queue-manager.js';
import { ExecutionEngine } from './execution-engine.js';
import { TriggerManager } from './trigger-manager.js';
import { getTriggerConfigService, type TriggerConfigRead } from './trigger-config-service.js';
import { RemoteDispatcher } from './remote-dispatcher.js';
import type {
  AutonomyMode,
  PersistedQueueState,
  QueueConfig,
  QueueEvent,
  QueueLifecycleState,
  QueuedTask,
  TaskInput,
} from './types.js';
import { systemPaths } from '../path-builder.js';
import { audit } from '../audit.js';
import { eventBus } from '../infrastructure/event-bus/client.js';
import {
  auditRecovery,
  clearQueueState,
  createImmediateSaver,
  loadQueueState,
  persistQueueState,
  shouldRestoreState,
} from './queue-persister.js';
import { isWorkCoordinatorOwner } from './work-coordinator-ownership.js';
import { recoverDurableExecutions } from '../durable-execution/recovery.js';
import { openExecutionStore } from '../durable-execution/storage.js';
import { resolvePath } from '../storage-client.js';
import { getAuthenticatedRuntimeId, getCurrentlyActiveUser } from '../sessions.js';
import { agentHandlerId, agentTaskType } from './agent-work-catalog.js';
import { SLEEP_WORKFLOW_HANDLERS } from './sleep-workflow.js';
import {
  readSleepRuntimeState,
  reconcileSleepRuntime,
  wakeSleepSession,
} from '../sleep-runtime.js';

interface QueueSystemConfig {
  enabled: boolean;
}

const DEFAULT_CONFIG: QueueSystemConfig = { enabled: true };

function parseQueueConfig(value: unknown): QueueConfig {
  if (!value || typeof value !== 'object') throw new Error('queue.json must contain an object');
  const raw = value as Record<string, any>;
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new Error('queue.json enabled must be a boolean');
  }
  if (!raw.lanes || typeof raw.lanes !== 'object') throw new Error('queue.json lanes are required');
  for (const laneId of ['local-llm', 'vector-index', 'remote-llm'] as const) {
    const lane = raw.lanes[laneId];
    if (!lane || !Number.isInteger(lane.maxConcurrent) || lane.maxConcurrent < 1) {
      throw new Error(`queue.json lanes.${laneId}.maxConcurrent must be a positive integer`);
    }
  }
  const staleTaskTimeoutMs = raw.execution?.staleTaskTimeoutMs;
  if (staleTaskTimeoutMs !== undefined && (!Number.isFinite(staleTaskTimeoutMs) || staleTaskTimeoutMs < 0)) {
    throw new Error('queue.json execution.staleTaskTimeoutMs must be a non-negative number');
  }
  const maxAttempts = raw.execution?.maxAttempts;
  if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
    throw new Error('queue.json execution.maxAttempts must be a positive integer');
  }
  const terminalExecutionRetentionDays = raw.execution?.terminalExecutionRetentionDays ?? 30;
  if (!Number.isInteger(terminalExecutionRetentionDays) || terminalExecutionRetentionDays < 1) {
    throw new Error('queue.json execution.terminalExecutionRetentionDays must be a positive integer');
  }
  return {
    enabled: raw.enabled ?? true,
    lanes: {
      'local-llm': { ...raw.lanes['local-llm'], id: 'local-llm' },
      'vector-index': { ...raw.lanes['vector-index'], id: 'vector-index' },
      'remote-llm': { ...raw.lanes['remote-llm'], id: 'remote-llm' },
    },
    execution: { staleTaskTimeoutMs, maxAttempts, terminalExecutionRetentionDays },
  };
}

export function buildRobotOperatorManualTaskInput(
  agentId: string,
  config: TriggerConfigRead['config']['agents'][string] | undefined,
  username: string,
  args: string[] = [],
): TaskInput & { handler: string } {
  if (!config || config.runtimeOwner !== 'robot-operator') {
    throw new Error(`Agent '${agentId}' is not owned by Robot Operator`);
  }
  if (!config.enabled) throw new Error(`Agent '${agentId}' is disabled in Robot Operator configuration`);
  if (config.lifecycle !== 'workflow' || !config.handler.startsWith('workflow.')) {
    throw new Error(`Agent '${agentId}' does not have a maintained Robot Operator workflow`);
  }
  const cycleId = randomUUID();
  return {
    type: agentTaskType(agentId),
    handler: config.handler,
    resource: config.resource ?? 'local-llm',
    source: 'user',
    username,
    priority: config.priority,
    cognitiveMode: 'environment',
    input: { agentId, args, triggeredBy: 'manual', cycleId },
    correlationId: cycleId,
    maxAttempts: Math.max(1, (config.maxRetries ?? 0) + 1),
    metadata: { producer: 'robot-operator', childAgent: agentId, admission: 'manual' },
  };
}

export class QueueSystem extends EventEmitter {
  private readonly config: QueueSystemConfig;
  private queueConfig: QueueConfig | null = null;
  private readonly queueManager: UnifiedQueueManager;
  private readonly executionEngine: ExecutionEngine;
  private readonly triggerManager: TriggerManager;
  private readonly triggerConfig = getTriggerConfigService();
  private readonly remoteDispatcher: RemoteDispatcher;
  private lifecycle: QueueLifecycleState = 'stopped';
  private initialized = false;
  private proactiveScheduling = false;
  private lastError?: string;
  private immediateSave?: () => void;
  private startPromise: Promise<boolean> | null = null;
  private readonly unsubscribeTriggerConfig: () => void;
  private readonly unsubscribeEventBus: () => void;

  constructor(config: Partial<QueueSystemConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.queueManager = getQueueManager();
    const runtimeId = getAuthenticatedRuntimeId();
    if (!runtimeId) throw new Error('Work Coordinator must establish its authentication runtime before starting');
    this.queueManager.configureRecovery(runtimeId, () => {
      const user = getCurrentlyActiveUser();
      return user && user.role !== 'guest' ? user.username : null;
    });
    this.executionEngine = new ExecutionEngine({ wakeFallbackMs: 1_000,
      maintain: () => recoverDurableExecutions(this.queueManager, this.queueConfig?.execution?.terminalExecutionRetentionDays ?? 30),
    }, this.queueManager);
    this.triggerManager = new TriggerManager(this.queueManager);
    this.remoteDispatcher = new RemoteDispatcher(this.queueManager);
    this.triggerManager.setHandlerInspector(config => ({
      registered: this.executionEngine.hasHandler(config.handler),
      sourceResolvable: config.handler.startsWith('agent.')
        ? this.executionEngine.isAgentSourceResolvable(config.id)
        : this.executionEngine.hasHandler(config.handler),
    }));
    this.unsubscribeTriggerConfig = this.triggerConfig.subscribe(read => this.applyTriggerConfig(read));
    this.unsubscribeEventBus = eventBus.subscribe(event => this.triggerManager.triggerEvent(event.event, event.data));
    this.queueManager.addEventListener(event => this.emit('queue', event));
    this.triggerManager.on('stateChange', event => this.emit('triggerState', event));
  }

  private applyTriggerConfig(read: TriggerConfigRead): void {
    for (const [agentId, config] of Object.entries(read.config.agents)) {
      if (config.lifecycle !== 'service' && config.handler.startsWith('agent.')) {
        this.executionEngine.registerAgentHandler(agentId, config.handler);
      }
    }
    this.triggerManager.applyConfig(read);
    this.cancelLegacySleepAdmissions();
    this.cancelLegacyDesireAdmissions();
  }

  private cancelLegacySleepAdmissions(): void {
    for (const task of this.queueManager.getAllTasks()) {
      const admittedByAwakeAutonomy = task.source === 'timer' || task.source === 'autonomy';
      if (
        admittedByAwakeAutonomy
        && SLEEP_WORKFLOW_HANDLERS.has(task.handler)
        && !task.input?.sleepWorkflow
      ) {
        this.queueManager.cancel(task.id, 'Automatic ownership moved to Sleep Workflow');
      }
    }
  }

  private cancelLegacyDesireAdmissions(): void {
    for (const task of this.queueManager.getAllTasks()) {
      if (!isDesireAgentAdmission(task)) {
        this.queueManager.cancel(task.id, 'Desire System admission moved to Desire Agent');
      }
    }
  }

  private get configPath(): string {
    return path.join(systemPaths.etc, 'queue.json');
  }

  private setLifecycle(lifecycle: QueueLifecycleState, error?: string): void {
    this.lifecycle = lifecycle;
    this.lastError = error;
    this.emit('lifecycle', { lifecycle, error });
  }

  loadConfig(): boolean {
    try {
      if (!fs.existsSync(this.configPath)) throw new Error(`Queue configuration not found: ${this.configPath}`);
      this.queueConfig = parseQueueConfig(JSON.parse(fs.readFileSync(this.configPath, 'utf8')));
      this.queueManager.configure(this.queueConfig);
      audit({
        level: 'info',
        category: 'system',
        event: 'queue_config_loaded',
        actor: 'queue_system',
        details: { enabled: this.queueConfig.enabled },
      });
      return true;
    } catch (error) {
      this.queueConfig = null;
      this.setLifecycle('degraded', (error as Error).message);
      console.error('[QueueSystem] Invalid queue configuration:', error);
      return false;
    }
  }

  initialize(): boolean {
    if (this.initialized) return true;
    if (!this.loadConfig()) return false;

    try {
      try {
        this.triggerConfig.load(true);
      } catch (error) {
        this.triggerManager.markConfigError(error);
        audit({
          level: 'error',
          category: 'system',
          event: 'trigger_config_load_failed',
          actor: 'queue_system',
          details: { error: (error as Error).message },
        });
      }
      if (shouldRestoreState()) {
        const state = loadQueueState();
        if (state) {
          this.queueManager.importState(state);
          auditRecovery(
            this.queueManager.getAllTasks().length,
            state.inFlightRemote?.length || 0,
            state.items?.find(task => task.error?.code === 'restart_recovery')?.id,
          );
        }
      }
      this.cancelLegacySleepAdmissions();
      this.cancelLegacyDesireAdmissions();
      if (shouldRestoreState()) persistQueueState(this.queueManager.exportState());
      reconcileSleepRuntime(this.queueManager.getAllTasks());

      this.immediateSave = createImmediateSaver(() => this.queueManager.exportState());
      this.queueManager.setOnQueueChange(() => {
        try {
          this.immediateSave!();
        } catch (error) {
          this.setLifecycle('degraded', (error as Error).message);
          throw error;
        }
        this.emit('stateChange', this.getState());
      });
      this.initialized = true;
      audit({ level: 'info', category: 'system', event: 'queue_system_initialized', actor: 'queue_system' });
      return true;
    } catch (error) {
      this.setLifecycle('degraded', (error as Error).message);
      console.error('[QueueSystem] Initialization failed:', error);
      return false;
    }
  }

  async start(): Promise<boolean> {
    if (this.lifecycle === 'running' || this.lifecycle === 'paused') return true;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<boolean> {
    this.setLifecycle('starting');
    if (!this.initialize()) return false;
    if (!this.config.enabled || this.queueConfig?.enabled === false) {
      this.setLifecycle('stopped');
      return false;
    }
    try {
      // Startup restores only the system ledger. Profile recovery stays dormant
      // until authentication selects a storage-ready user in this server lifetime.
      this.executionEngine.start();
      this.triggerManager.start();
      this.setLifecycle('running');
      audit({ level: 'info', category: 'system', event: 'queue_system_started', actor: 'queue_system' });
      this.emit('started');
      return true;
    } catch (error) {
      this.setLifecycle('degraded', (error as Error).message);
      this.emit('error', { error });
      return false;
    }
  }

  async stop(): Promise<boolean> {
    if (this.lifecycle === 'stopped') return true;
    this.setLifecycle('stopping');
    try {
      this.triggerManager.stop();
      await this.executionEngine.stop();
      this.immediateSave?.();
      this.setLifecycle('stopped');
      audit({ level: 'info', category: 'system', event: 'queue_system_stopped', actor: 'queue_system' });
      this.emit('stopped');
      return true;
    } catch (error) {
      this.setLifecycle('degraded', (error as Error).message);
      this.emit('error', { error });
      return false;
    }
  }

  async dispose(): Promise<boolean> {
    const stopped = await this.stop();
    this.triggerManager.dispose();
    this.unsubscribeTriggerConfig();
    this.unsubscribeEventBus();
    return stopped;
  }

  setProactiveScheduling(enabled: boolean): void {
    this.proactiveScheduling = enabled;
    this.triggerManager.setAutonomyMode(enabled ? 'semi' : 'reactive');
  }

  setAutonomyMode(mode: AutonomyMode): void {
    this.proactiveScheduling = mode === 'semi' || mode === 'full';
    this.triggerManager.setAutonomyMode(mode);
  }

  isProactiveSchedulingEnabled(): boolean {
    return this.proactiveScheduling;
  }

  pause(): void {
    this.queueManager.pause();
    this.setLifecycle('paused');
  }

  resume(): void {
    this.queueManager.resume();
    this.setLifecycle('running');
  }

  enqueue(input: TaskInput): QueuedTask {
    if (!this.initialize()) {
      throw new Error(this.lastError || 'Work coordinator is not configured');
    }
    if (input.handler?.startsWith('agent.') && typeof input.input?.agentId === 'string') {
      this.executionEngine.registerAgentHandler(input.input.agentId, input.handler);
    }
    return this.queueManager.enqueue(input);
  }

  enqueueUserMessage(message: string, username: string, options?: Partial<TaskInput>): QueuedTask {
    if (!this.initialize()) {
      throw new Error(this.lastError || 'Work coordinator is not configured');
    }
    return this.queueManager.enqueueUserMessage(message, username, options);
  }

  triggerAgent(agentId: string, username?: string, args: string[] = []): string | null {
    if (agentId !== 'sleep-workflow') this.recordActivity(username);
    return this.triggerManager.triggerManual(agentId, username, args);
  }

  enqueueFiniteAgent(agentId: string, username: string, args: string[] = []): QueuedTask {
    const handler = agentHandlerId(agentId);
    if (!this.executionEngine.registerAgentHandler(agentId, handler) && !this.executionEngine.hasHandler(handler)) {
      throw new Error(`No maintained executable for agent: ${agentId}`);
    }
    return this.enqueue({
      type: agentTaskType(agentId),
      handler,
      source: 'user',
      username,
      priority: 'normal',
      input: { agentId, args, triggeredBy: 'manual' },
      metadata: { producer: 'manual-agent-control', agentId },
    });
  }

  enqueueRobotOperatorChild(agentId: string, username: string, args: string[] = []): QueuedTask {
    const config = this.triggerConfig.load(false).config.agents[agentId];
    const input = buildRobotOperatorManualTaskInput(agentId, config, username, args);
    if (!this.executionEngine.hasHandler(input.handler)) {
      throw new Error(`Robot Operator workflow handler is unavailable: ${input.handler}`);
    }

    const task = this.enqueue(input);
    this.recordActivity(username);
    audit({
      level: 'info',
      category: 'action',
      event: 'robot_operator_child_manual_admitted',
      actor: agentId,
      details: { agent: agentId, taskId: task.id, handler: task.handler, requestedBy: username },
    });
    return task;
  }

  recordActivity(username?: string): void {
    this.triggerManager.recordActivity(username);
    const sleep = readSleepRuntimeState().currentSession;
    if (!sleep) return;
    const reason = username ? `User activity resumed for ${username}` : 'User activity resumed';
    for (const task of this.queueManager.getAllTasks()) {
      if (task.id === sleep.parentTaskId || task.input?.sleepWorkflow?.sessionId === sleep.id) {
        this.queueManager.cancel(task.id, reason);
      }
    }
    wakeSleepSession(reason);
  }

  getStats() {
    return this.queueManager.getStats();
  }

  getAllTasks(): QueuedTask[] {
    return this.queueManager.getAllTasks();
  }

  /** The queue is a view/control surface for saved executions, not their owner. */
  getExecutions(username: string) {
    const resolved = resolvePath({ username, category: 'state', subcategory: 'sessions', relativePath: 'executions.sqlite' });
    if (!resolved.success || !resolved.path) throw new Error(resolved.error || 'Execution storage cannot be resolved');
    if (!fs.existsSync(resolved.path)) return [];
    const store = openExecutionStore(username);
    try {
      return store.list(username).map(record => ({
        executionId: record.executionId, graph: record.definition.graphId, status: record.status,
        waitingReason: record.waitingReason, updatedAt: new Date(record.updatedAt).toISOString(),
        liveWriter: Boolean(record.owner && (record.leaseUntil ?? 0) > Date.now()),
      }));
    } finally { store.close(); }
  }

  private taskExecutions(task: QueuedTask): string[] {
    return [...new Set([
      ...(task.graphExecutions ?? []), ...(task.durable ? [task.durable.executionId] : []),
      ...(task.handler === 'graph.signal' || task.handler === 'graph.resume' ? [task.input.executionId] : []),
    ].filter((id): id is string => typeof id === 'string' && Boolean(id)))];
  }

  cancelExecution(username: string, executionId: string, reason: string): void {
    const store = openExecutionStore(username);
    try {
      const execution = store.get(executionId);
      if (execution.username !== username) throw new Error('Execution belongs to another profile');
      if (!['completed', 'failed', 'cancelled'].includes(execution.status)) {
        store.cancel(executionId, { eventId: `queue-cancel:${executionId}`, kind: 'user_cancelled', payload: { reason } });
      }
    } finally { store.close(); }
    for (const task of this.queueManager.getAllTasks()) {
      if (task.username === username && this.taskExecutions(task).includes(executionId)) this.queueManager.cancel(task.id, reason);
    }
    this.emit('queue', { type: 'execution_cancelled', timestamp: new Date().toISOString(), details: { executionId } } satisfies QueueEvent);
  }

  cancelTask(taskId: string, reason: string): QueuedTask | null {
    const task = this.queueManager.getTask(taskId);
    if (!task) return null;
    for (const executionId of this.taskExecutions(task)) this.cancelExecution(task.username, executionId, reason);
    return this.queueManager.cancel(taskId, reason) ?? this.queueManager.getTask(taskId);
  }

  cancelPending(username: string, reason: string): number {
    const tasks = this.queueManager.getAllTasks();
    const running = new Set(tasks.filter(task => task.state === 'leased').flatMap(task => this.taskExecutions(task)));
    const pending = tasks.filter(task => ['queued', 'waiting'].includes(task.state)
      && !this.taskExecutions(task).some(id => running.has(id)));
    const executions = this.getExecutions(username).filter(execution => execution.status === 'waiting'
      && !execution.liveWriter && !running.has(execution.executionId));
    for (const execution of executions) this.cancelExecution(username, execution.executionId, reason);
    for (const task of pending) this.cancelTask(task.id, reason);
    return pending.length + executions.length;
  }

  async confirmRobotStopped(taskId: string, confirmedBy: string): Promise<QueuedTask> {
    const task = this.queueManager.getTask(taskId);
    if (!task || task.type !== 'environment_command' || !task.bodyLease || !task.cancellationRequestedAt) {
      throw new Error('Only a robot action awaiting cancellation can be confirmed stopped');
    }
    const { recordEnvironmentActionResult } = await import('../environment-interface/store.js');
    // The adapter may have settled the action while the confirmation dialog was open.
    const current = this.queueManager.getTask(taskId)!;
    if (!['leased', 'waiting'].includes(current.state)) return current;
    recordEnvironmentActionResult({ id: `owner-stopped:${task.id}`, actionId: task.input.id || task.id,
      timestamp: task.cancellationRequestedAt, type: 'cancelled', message: 'Owner confirmed the robot is stopped',
      data: { producer: 'owner_confirmation', confirmedBy } });
    return this.queueManager.getTask(taskId)!;
  }

  getState() {
    return {
      lifecycle: this.lifecycle,
      running: this.lifecycle === 'running' || this.lifecycle === 'paused',
      paused: this.lifecycle === 'paused',
      degraded: this.lifecycle === 'degraded',
      error: this.lastError,
      proactiveScheduling: this.proactiveScheduling,
      stats: this.queueManager.getStats(),
      tasks: this.queueManager.getAllTasks(),
      history: this.queueManager.getHistory(),
      handlers: this.executionEngine.getHandlerIds(),
      resourceCapacity: {
        'local-llm': this.queueManager.getLaneStatus('local-llm'),
        'vector-index': this.queueManager.getLaneStatus('vector-index'),
        'remote-llm': this.queueManager.getLaneStatus('remote-llm'),
      },
      inFlightRemote: this.queueManager.getInFlightRemote(),
      nextTriggers: this.triggerManager.getNextTriggers(),
      lastActivity: this.triggerManager.getLastActivity(),
      triggerManager: this.triggerManager.getSnapshot(),
    };
  }

  get queue(): UnifiedQueueManager {
    return this.queueManager;
  }

  get engine(): ExecutionEngine {
    return this.executionEngine;
  }

  get triggers(): TriggerManager {
    return this.triggerManager;
  }

  get triggerConfiguration() {
    return this.triggerConfig;
  }

  get remote(): RemoteDispatcher {
    return this.remoteDispatcher;
  }

  getLifecycleState(): QueueLifecycleState {
    return this.lifecycle;
  }

  isRunning(): boolean {
    return this.lifecycle === 'running' || this.lifecycle === 'paused';
  }
}

let instance: QueueSystem | null = null;

export function getQueueSystem(): QueueSystem {
  if (!instance) instance = new QueueSystem();
  return instance;
}

export async function ensureQueueSystemStarted(): Promise<QueueSystem> {
  if (!isWorkCoordinatorOwner()) {
    throw new Error('This process is not the work-coordinator owner; submit work through the coordinator service endpoint');
  }
  const system = getQueueSystem();
  const started = await system.start();
  if (!started) {
    const state = system.getState();
    throw new Error(state.error || `Work coordinator failed to start (${state.lifecycle})`);
  }
  return system;
}

export function resetQueueSystem(): void {
  if (instance) void instance.dispose();
  instance = null;
}

export { clearQueueState };
export type { PersistedQueueState, QueueEvent };

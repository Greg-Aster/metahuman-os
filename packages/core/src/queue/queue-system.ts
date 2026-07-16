/**
 * Work coordinator lifecycle facade.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { UnifiedQueueManager, getQueueManager } from './unified-queue-manager.js';
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
  createDebouncedSaver,
  createImmediateSaver,
  loadQueueState,
  persistQueueState,
  shouldRestoreState,
} from './queue-persister.js';
import { isWorkCoordinatorOwner } from './work-submission.js';
import { agentHandlerId, agentTaskType } from './agent-work-catalog.js';

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
  return {
    enabled: raw.enabled ?? true,
    lanes: {
      'local-llm': { ...raw.lanes['local-llm'], id: 'local-llm' },
      'vector-index': { ...raw.lanes['vector-index'], id: 'vector-index' },
      'remote-llm': { ...raw.lanes['remote-llm'], id: 'remote-llm' },
    },
    execution: { staleTaskTimeoutMs, maxAttempts },
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
    this.executionEngine = new ExecutionEngine({ wakeFallbackMs: 1_000 }, this.queueManager);
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
          persistQueueState(this.queueManager.exportState());
          auditRecovery(
            this.queueManager.getAllTasks().length,
            state.inFlightRemote?.length || 0,
            state.items?.find(task => task.error?.code === 'restart_recovery')?.id,
          );
        }
      }

      const onPersistenceError = (error: Error) => {
        this.setLifecycle('degraded', error.message);
        this.emit('error', { error });
      };
      const debouncedSave = createDebouncedSaver(
        () => this.queueManager.exportState(),
        onPersistenceError,
      );
      this.queueManager.setOnQueueChange(() => {
        debouncedSave();
        this.emit('stateChange', this.getState());
      });
      this.immediateSave = createImmediateSaver(() => this.queueManager.exportState());
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

  recordActivity(username?: string): void {
    this.triggerManager.recordActivity(username);
  }

  getStats() {
    return this.queueManager.getStats();
  }

  getAllTasks(): QueuedTask[] {
    return this.queueManager.getAllTasks();
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

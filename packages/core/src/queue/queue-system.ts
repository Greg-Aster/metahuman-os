/**
 * Queue System Facade
 *
 * Main entry point for the unified queue system.
 * Wires together all components:
 * - UnifiedQueueManager (queue with lanes)
 * - ExecutionEngine (main loop)
 * - TriggerManager (agent scheduling)
 * - RemoteDispatcher (non-blocking remote calls)
 *
 * Usage:
 *   const system = new QueueSystem();
 *   await system.start();
 *   // ... system runs in background
 *   await system.stop();
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { UnifiedQueueManager } from './unified-queue-manager.js';
import { ExecutionEngine } from './execution-engine.js';
import { TriggerManager } from './trigger-manager.js';
import { RemoteDispatcher } from './remote-dispatcher.js';
import { QueueConfig, TaskInput, QueuedTask, QueueEvent, PersistedQueueState } from './types.js';
import { systemPaths } from '../path-builder.js';
import { audit } from '../audit.js';
import {
  loadQueueState,
  clearQueueState,
  loadCurrentTask,
  clearCurrentTask,
  shouldRestoreState,
  auditRecovery,
  createDebouncedSaver,
  createImmediateSaver,
  persistQueueState,
} from './queue-persister.js';

// ============================================================================
// Queue System Configuration
// ============================================================================

interface QueueSystemConfig {
  enabled: boolean;
  autoStart: boolean;
}

const DEFAULT_CONFIG: QueueSystemConfig = {
  enabled: true,
  autoStart: false,
};

// ============================================================================
// Queue System
// ============================================================================

export class QueueSystem extends EventEmitter {
  private config: QueueSystemConfig;
  private queueConfig: QueueConfig | null = null;

  // Components
  private queueManager: UnifiedQueueManager;
  private executionEngine: ExecutionEngine;
  private triggerManager: TriggerManager;
  private remoteDispatcher: RemoteDispatcher;

  // State
  private running: boolean = false;
  private initialized: boolean = false;
  private immediateSave?: () => void;

  constructor(config?: Partial<QueueSystemConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize components
    this.queueManager = new UnifiedQueueManager();
    this.executionEngine = new ExecutionEngine({
      loopIntervalMs: 100,
      onTaskComplete: (task, success, result) => {
        this.emit('taskComplete', { task, success, result });
      },
      onError: (error, task) => {
        this.emit('error', { error, task });
      },
    });
    this.triggerManager = new TriggerManager(this.queueManager);
    this.remoteDispatcher = new RemoteDispatcher(this.queueManager);

    // Wire up event forwarding
    this.queueManager.addEventListener((event) => {
      this.emit('queue', event);
    });
  }

  /**
   * Get the config file path
   */
  private get configPath(): string {
    return path.join(systemPaths.etc, 'queue.json');
  }

  /**
   * Load configuration from etc/queue.json
   */
  loadConfig(): boolean {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.warn('[QueueSystem] No queue.json found, using defaults');
        return false;
      }

      const data = fs.readFileSync(this.configPath, 'utf-8');
      this.queueConfig = JSON.parse(data);

      audit({
        level: 'info',
        category: 'system',
        event: 'queue_config_loaded',
        actor: 'queue_system',
        details: {
          enabled: this.queueConfig?.enabled,
        },
      });

      return true;
    } catch (error) {
      console.error('[QueueSystem] Failed to load config:', error);
      return false;
    }
  }

  /**
   * Initialize the queue system (load configs, wire components)
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    try {
      // Load configurations
      this.loadConfig();
      this.triggerManager.loadConfig();

      // Restore persisted state if available and not too old
      if (shouldRestoreState()) {
        const persistedState = loadQueueState();
        if (persistedState) {
          this.queueManager.importState(persistedState);

          // Check for crashed task
          const crashedTask = loadCurrentTask();
          const tasksRestored = this.queueManager.getAllTasks().length;

          auditRecovery(
            tasksRestored,
            persistedState.inFlightRemote?.length || 0,
            crashedTask?.task.id
          );

          console.log(`[QueueSystem] Restored ${tasksRestored} queued tasks from disk`);

          // Clear the current task file - crashed task was lost
          if (crashedTask) {
            console.log(`[QueueSystem] Found crashed task: ${crashedTask.task.type} (${crashedTask.task.id})`);
            clearCurrentTask();
          }
        }
      }

      // Set up debounced persistence callback
      const debouncedSave = createDebouncedSaver(() => this.queueManager.exportState());
      this.queueManager.setOnQueueChange(() => {
        debouncedSave();
        this.emit('stateChange', this.getState());
      });

      // Store immediate saver for shutdown
      this.immediateSave = createImmediateSaver(() => this.queueManager.exportState());

      this.initialized = true;

      audit({
        level: 'info',
        category: 'system',
        event: 'queue_system_initialized',
        actor: 'queue_system',
      });

      console.log('[QueueSystem] Initialized');
      return true;
    } catch (error) {
      console.error('[QueueSystem] Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Start the queue system
   */
  async start(): Promise<boolean> {
    if (this.running) {
      console.warn('[QueueSystem] Already running');
      return false;
    }

    if (!this.initialized) {
      await this.initialize();
    }

    if (this.queueConfig && !this.queueConfig.enabled) {
      console.log('[QueueSystem] Disabled in config, not starting');
      return false;
    }

    try {
      // Start components
      this.executionEngine.start();
      this.triggerManager.start();

      this.running = true;

      audit({
        level: 'info',
        category: 'system',
        event: 'queue_system_started',
        actor: 'queue_system',
      });

      console.log('[QueueSystem] Started');
      this.emit('started');
      return true;
    } catch (error) {
      console.error('[QueueSystem] Failed to start:', error);
      return false;
    }
  }

  /**
   * Stop the queue system
   */
  async stop(): Promise<boolean> {
    if (!this.running) {
      console.warn('[QueueSystem] Not running');
      return false;
    }

    try {
      // Stop components
      await this.executionEngine.stop();
      this.triggerManager.stop();

      // Save state immediately before shutdown
      if (this.immediateSave) {
        this.immediateSave();
        console.log('[QueueSystem] Queue state persisted to disk');
      }

      this.running = false;

      audit({
        level: 'info',
        category: 'system',
        event: 'queue_system_stopped',
        actor: 'queue_system',
      });

      console.log('[QueueSystem] Stopped');
      this.emit('stopped');
      return true;
    } catch (error) {
      console.error('[QueueSystem] Failed to stop:', error);
      return false;
    }
  }

  /**
   * Pause processing (queue still accepts tasks)
   */
  pause(): void {
    this.queueManager.pause();
    this.triggerManager.pauseAll();
    this.emit('paused');
  }

  /**
   * Resume processing
   */
  resume(): void {
    this.queueManager.resume();
    this.triggerManager.resumeAll();
    this.emit('resumed');
  }

  /**
   * Pause a specific lane
   */
  pauseLane(laneId: 'local-llm' | 'vector-index' | 'remote-llm'): void {
    this.queueManager.pauseLane(laneId);
    this.emit('lanePaused', { lane: laneId });
  }

  /**
   * Resume a specific lane
   */
  resumeLane(laneId: 'local-llm' | 'vector-index' | 'remote-llm'): void {
    this.queueManager.resumeLane(laneId);
    this.emit('laneResumed', { lane: laneId });
  }

  /**
   * Check if a specific lane is paused
   */
  isLanePaused(laneId: 'local-llm' | 'vector-index' | 'remote-llm'): boolean {
    return this.queueManager.isLanePaused(laneId);
  }

  /**
   * Get all paused lanes
   */
  getPausedLanes(): string[] {
    return this.queueManager.getPausedLanes();
  }

  /**
   * Enqueue a task
   */
  enqueue(input: TaskInput): QueuedTask {
    return this.queueManager.enqueue(input);
  }

  /**
   * Enqueue a user message (critical priority)
   */
  enqueueUserMessage(
    message: string,
    username: string,
    options?: Partial<TaskInput>
  ): QueuedTask {
    return this.queueManager.enqueueUserMessage(message, username, options);
  }

  /**
   * Manually trigger an agent
   */
  triggerAgent(agentId: string, username?: string): string | null {
    return this.triggerManager.triggerManual(agentId, username);
  }

  /**
   * Record user activity (pauses queue temporarily)
   */
  recordActivity(username?: string): void {
    this.triggerManager.recordActivity(username);
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return this.queueManager.getStats();
  }

  /**
   * Get all tasks across all lanes
   */
  getAllTasks(): QueuedTask[] {
    return this.queueManager.getAllTasks();
  }

  /**
   * Get system state (for API/dashboard)
   */
  getState() {
    return {
      running: this.running,
      paused: this.queueManager.isPaused(),
      stats: this.queueManager.getStats(),
      lanes: {
        'local-llm': this.queueManager.getLaneStatus('local-llm'),
        'vector-index': this.queueManager.getLaneStatus('vector-index'),
        'remote-llm': this.queueManager.getLaneStatus('remote-llm'),
      },
      inFlightRemote: this.queueManager.getInFlightRemote(),
      nextTriggers: this.triggerManager.getNextTriggers(),
      lastActivity: this.triggerManager.getLastActivity(),
    };
  }

  /**
   * Access to underlying components (for advanced use)
   */
  get queue(): UnifiedQueueManager {
    return this.queueManager;
  }

  get engine(): ExecutionEngine {
    return this.executionEngine;
  }

  get triggers(): TriggerManager {
    return this.triggerManager;
  }

  get remote(): RemoteDispatcher {
    return this.remoteDispatcher;
  }

  /**
   * Check if system is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

// Singleton instance
let instance: QueueSystem | null = null;

/**
 * Get the singleton QueueSystem instance
 */
export function getQueueSystem(): QueueSystem {
  if (!instance) {
    instance = new QueueSystem();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetQueueSystem(): void {
  if (instance?.isRunning()) {
    instance.stop();
  }
  instance = null;
}

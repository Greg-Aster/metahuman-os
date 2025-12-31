/**
 * Execution Engine
 *
 * Runs the unified queue with resource-aware scheduling:
 * - Local LLM tasks execute sequentially (GPU contention)
 * - Remote LLM tasks fire and forget (non-blocking)
 * - Vector index tasks can run in parallel (always available)
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { UnifiedQueueManager, getQueueManager } from './unified-queue-manager.js';
import { RemoteDispatcher } from './remote-dispatcher.js';
import {
  QueuedTask,
  ResourceLaneId,
  TaskType,
  RemoteResult,
  QueueConfig,
} from './types.js';
import { audit } from '../audit.js';
import { ROOT } from '../paths.js';
import { recordTaskFromTask } from './lane-metrics.js';

// Map task types to agent file paths
const TASK_TO_AGENT: Partial<Record<TaskType, string>> = {
  memory_curate: 'brain/agents/organizer/index.ts',
  training_curate: 'brain/agents/curator/index.ts',
  reflect: 'brain/agents/reflector/index.ts',
  curiosity: 'brain/agents/curiosity-service/index.ts',
  inner_curiosity: 'brain/agents/inner-curiosity/index.ts',
  dream: 'brain/agents/dreamer/index.ts',
  desire_generate: 'brain/agents/desire-generator/index.ts',
  desire_execute: 'brain/agents/desire-executor/index.ts',
  psychoanalyze: 'brain/agents/psychoanalyzer/index.ts',
  code_analyze: 'brain/agents/coder/index.ts',
};

export interface ExecutionEngineOptions {
  loopIntervalMs?: number;
  onTaskComplete?: (task: QueuedTask, success: boolean, result: any) => void;
  onError?: (error: Error, task?: QueuedTask) => void;
}

export class ExecutionEngine {
  private queueManager: UnifiedQueueManager;
  private remoteDispatcher: RemoteDispatcher;
  private running: boolean = false;
  private loopIntervalMs: number;
  private options: ExecutionEngineOptions;

  // Execution handlers for special task types
  private handlers: Map<TaskType, (task: QueuedTask) => Promise<any>>;

  constructor(options: ExecutionEngineOptions = {}) {
    this.queueManager = getQueueManager();
    this.remoteDispatcher = new RemoteDispatcher(this.queueManager);
    this.loopIntervalMs = options.loopIntervalMs ?? 100;
    this.options = options;
    this.handlers = new Map();

    // Register default handlers
    this.registerDefaultHandlers();
  }

  /**
   * Register a custom handler for a task type
   */
  registerHandler(type: TaskType, handler: (task: QueuedTask) => Promise<any>): void {
    this.handlers.set(type, handler);
  }

  /**
   * Register default handlers for built-in task types
   */
  private registerDefaultHandlers(): void {
    // User message handler (chat)
    this.handlers.set('user_message', async (task) => {
      // This should be handled by the chat system
      // Return the payload for external handling
      return { type: 'user_message', payload: task.payload };
    });

    // Index build handler
    this.handlers.set('index_build', async (task) => {
      const { buildMemoryIndex } = await import('../vector-index.js');
      return buildMemoryIndex({
        force: task.payload.force ?? false,
        username: task.username,
      });
    });

    // Semantic search handler (bypass queue, always available)
    this.handlers.set('semantic_search', async (task) => {
      const { queryIndex } = await import('../vector-index.js');
      return queryIndex(task.payload.query, {
        topK: task.payload.limit || 10,
        username: task.username,
      });
    });
  }

  /**
   * Start the execution loop
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[ExecutionEngine] Already running');
      return;
    }

    this.running = true;
    console.log('[ExecutionEngine] Starting execution loop');

    audit({
      category: 'system',
      event: 'execution_engine_started',
      actor: 'system',
      level: 'info',
    });

    await this.runLoop();
  }

  /**
   * Stop the execution loop
   */
  stop(): void {
    this.running = false;
    console.log('[ExecutionEngine] Stopping execution loop');

    audit({
      category: 'system',
      event: 'execution_engine_stopped',
      actor: 'system',
      level: 'info',
    });
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Main execution loop
   */
  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        // Get next executable task from any lane
        const task = this.queueManager.getNextExecutable();

        if (!task) {
          // Nothing to execute, wait and check again
          await this.sleep(this.loopIntervalMs);
          continue;
        }

        // Dequeue the task (marks as started)
        const dequeuedTask = this.queueManager.dequeue(task.id);
        if (!dequeuedTask) {
          continue; // Task was removed while we were processing
        }

        // Route based on lane
        switch (dequeuedTask.resourceLane) {
          case 'local-llm':
            await this.executeLocalLLM(dequeuedTask);
            break;

          case 'vector-index':
            await this.executeVectorTask(dequeuedTask);
            break;

          case 'remote-llm':
            // Non-blocking - fire and forget
            this.dispatchRemote(dequeuedTask);
            break;
        }
      } catch (error) {
        console.error('[ExecutionEngine] Loop error:', error);
        if (this.options.onError) {
          this.options.onError(error as Error);
        }
        await this.sleep(1000); // Back off on error
      }
    }
  }

  /**
   * Execute a local LLM task (blocking within lane)
   */
  private async executeLocalLLM(task: QueuedTask): Promise<void> {
    const startTime = Date.now();

    try {
      let result: any;

      // Check for custom handler first
      if (this.handlers.has(task.type)) {
        result = await this.handlers.get(task.type)!(task);
      } else {
        // Fall back to agent execution
        result = await this.runAgent(task);
      }

      const durationMs = Date.now() - startTime;

      audit({
        category: 'action',
        event: 'task_executed',
        actor: 'execution_engine',
        level: 'info',
        details: {
          taskId: task.id,
          type: task.type,
          lane: task.resourceLane,
          durationMs,
          success: true,
        },
      });

      this.queueManager.complete(task.id, true);

      // Record metrics
      recordTaskFromTask(task, true);

      if (this.options.onTaskComplete) {
        this.options.onTaskComplete(task, true, result);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      console.error(`[ExecutionEngine] Task ${task.id} failed:`, error);

      audit({
        category: 'action',
        event: 'task_failed',
        actor: 'execution_engine',
        level: 'error',
        details: {
          taskId: task.id,
          type: task.type,
          lane: task.resourceLane,
          durationMs,
          error: errorMessage,
        },
      });

      // Try to retry
      const retried = this.queueManager.requeue(task);
      if (!retried) {
        this.queueManager.complete(task.id, false, errorMessage);
        // Record failed metrics (only if not retrying)
        recordTaskFromTask(task, false);
      }

      if (this.options.onError) {
        this.options.onError(error as Error, task);
      }

      if (this.options.onTaskComplete) {
        this.options.onTaskComplete(task, false, { error: errorMessage });
      }
    }
  }

  /**
   * Execute a vector index task (fast, parallel OK)
   */
  private async executeVectorTask(task: QueuedTask): Promise<void> {
    const startTime = Date.now();

    try {
      let result: any;

      if (this.handlers.has(task.type)) {
        result = await this.handlers.get(task.type)!(task);
      } else {
        throw new Error(`No handler for vector task type: ${task.type}`);
      }

      const durationMs = Date.now() - startTime;

      audit({
        category: 'action',
        event: 'vector_task_executed',
        actor: 'execution_engine',
        level: 'info',
        details: {
          taskId: task.id,
          type: task.type,
          durationMs,
        },
      });

      this.queueManager.complete(task.id, true);

      // Record metrics
      recordTaskFromTask(task, true);

      if (this.options.onTaskComplete) {
        this.options.onTaskComplete(task, true, result);
      }
    } catch (error) {
      console.error(`[ExecutionEngine] Vector task ${task.id} failed:`, error);
      this.queueManager.complete(task.id, false, (error as Error).message);

      // Record failed metrics
      recordTaskFromTask(task, false);

      if (this.options.onError) {
        this.options.onError(error as Error, task);
      }
    }
  }

  /**
   * Dispatch a remote task (non-blocking)
   */
  private dispatchRemote(task: QueuedTask): void {
    // Fire and forget - the remote dispatcher handles callbacks
    this.remoteDispatcher.dispatch(task).catch(error => {
      console.error(`[ExecutionEngine] Remote dispatch failed for ${task.id}:`, error);

      // Create failed result
      const result: RemoteResult = {
        taskId: task.id,
        success: false,
        output: { error: (error as Error).message },
        durationMs: 0,
      };

      this.queueManager.handleRemoteCallback(result);
    });

    // Queue continues immediately - no waiting
  }

  /**
   * Run an agent via subprocess
   */
  private async runAgent(task: QueuedTask): Promise<any> {
    const agentPath = TASK_TO_AGENT[task.type];
    if (!agentPath) {
      throw new Error(`No agent defined for task type: ${task.type}`);
    }

    const fullPath = path.join(ROOT, agentPath);

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        MH_TRIGGER_USERNAME: task.username,
        MH_TASK_ID: task.id,
        MH_TASK_PAYLOAD: JSON.stringify(task.payload),
      };

      const child = spawn('tsx', [fullPath], {
        cwd: ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Agent exited with code ${code}: ${stderr || stdout}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a vector query immediately (bypass queue)
   * This is the fast path for semantic search
   */
  async executeVectorQueryDirect(query: string, limit: number, username: string): Promise<any> {
    const { queryIndex } = await import('../vector-index.js');
    return queryIndex(query, { topK: limit, username });
  }
}

// Singleton instance
let engineInstance: ExecutionEngine | null = null;

export function getExecutionEngine(options?: ExecutionEngineOptions): ExecutionEngine {
  if (!engineInstance) {
    engineInstance = new ExecutionEngine(options);
  }
  return engineInstance;
}

export function resetExecutionEngine(): void {
  if (engineInstance) {
    engineInstance.stop();
    engineInstance = null;
  }
}

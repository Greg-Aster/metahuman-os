/**
 * Event-driven executor registry for coordinator work.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { UnifiedQueueManager, getQueueManager } from './unified-queue-manager.js';
import { RemoteDispatcher } from './remote-dispatcher.js';
import type { QueueEvent, QueuedTask } from './types.js';
import { audit } from '../audit.js';
import { ROOT } from '../paths.js';
import { systemPaths } from '../path-builder.js';
import { readSystemActivityTimestamp } from '../system-activity.js';
import {
  buildAgentNodePath,
  resolveAgentExecutablePath,
  resolveTsx,
} from '../agent-executable-resolver.js';

const DEFERRED = Symbol('deferred-work-completion');

const AGENT_HANDLERS: Record<string, string> = {
  'agent.organizer': 'organizer',
  'agent.curator': 'curator',
  'agent.reflector': 'reflector',
  'agent.curiosity-service': 'curiosity-service',
  'agent.inner-curiosity': 'inner-curiosity',
  'agent.dreamer': 'dreamer',
  'agent.desire-generator': 'desire-generator',
  'agent.desire-executor': 'desire-executor',
  'agent.psychoanalyzer': 'psychoanalyzer',
  'agent.coder': 'coder',
};

function isWithinWindow(window: { start: string; end: string }, now = new Date()): boolean {
  const [startHour, startMinute] = window.start.split(':').map(Number);
  const [endHour, endMinute] = window.end.split(':').map(Number);
  const current = now.getHours() * 60 + now.getMinutes();
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return start > end ? current >= start || current < end : current >= start && current < end;
}

export interface WorkHandlerContext {
  signal: AbortSignal;
  emit: (chunk: string) => void;
  enqueue: UnifiedQueueManager['enqueue'];
}

export type WorkHandler = (
  task: QueuedTask,
  context: WorkHandlerContext,
) => Promise<any | typeof DEFERRED | void>;

export interface ExecutionEngineOptions {
  wakeFallbackMs?: number;
  onTaskComplete?: (task: QueuedTask, success: boolean, result: any) => void;
  onError?: (error: Error, task?: QueuedTask) => void;
}

export class ExecutionEngine {
  private readonly queueManager: UnifiedQueueManager;
  private readonly remoteDispatcher: RemoteDispatcher;
  private readonly handlers = new Map<string, WorkHandler>();
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly wakeFallbackMs: number;
  private readonly options: ExecutionEngineOptions;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private wakeResolver?: () => void;

  constructor(options: ExecutionEngineOptions = {}, queueManager = getQueueManager()) {
    this.queueManager = queueManager;
    this.remoteDispatcher = new RemoteDispatcher(this.queueManager);
    this.wakeFallbackMs = Math.max(250, options.wakeFallbackMs ?? 1_000);
    this.options = options;
    this.registerDefaultHandlers();
    this.queueManager.addEventListener((event) => this.onQueueEvent(event));
  }

  registerHandler(handlerId: string, handler: WorkHandler): void {
    if (!handlerId.trim()) throw new Error('Work handler id is required');
    this.handlers.set(handlerId, handler);
    this.wake();
  }

  unregisterHandler(handlerId: string): void {
    this.handlers.delete(handlerId);
  }

  hasHandler(handlerId: string): boolean {
    return this.handlers.has(handlerId);
  }

  getHandlerIds(): string[] {
    return [...this.handlers.keys()].sort();
  }

  private registerDefaultHandlers(): void {
    this.registerHandler('vector.index-build', async (task) => {
      const { buildMemoryIndex } = await import('../vector-index.js');
      return buildMemoryIndex({ force: task.input.force ?? false, username: task.username });
    });

    this.registerHandler('vector.append-event', async (task) => {
      const { appendEventToIndex } = await import('../vector-index.js');
      await appendEventToIndex({
        id: task.input.id,
        timestamp: task.input.timestamp,
        content: task.input.content,
        tags: task.input.tags,
        entities: task.input.entities,
        path: task.input.path,
      });
      return { eventId: task.input.id };
    });

    this.registerHandler('vector.semantic-search', async (task) => {
      const { queryIndex } = await import('../vector-index.js');
      return queryIndex(task.input.query, { topK: task.input.limit || 10, username: task.username });
    });

    for (const [handlerId, agentId] of Object.entries(AGENT_HANDLERS)) {
      this.registerHandler(handlerId, (task, context) => this.runAgent(task, agentId, context.signal));
    }

    for (const handlerId of ['remote.big-brother', 'remote.runpod']) {
      this.registerHandler(handlerId, async (task) => {
        void this.remoteDispatcher.dispatch(task);
        return DEFERRED;
      });
    }

    this.registerHandler('chat.persona', async (task, context) => {
      const { executeChatWork } = await import('./chat-work-handler.js');
      return executeChatWork('persona', task, context);
    });
    this.registerHandler('chat.response-pipeline', async (task, context) => {
      const { executeChatWork } = await import('./chat-work-handler.js');
      return executeChatWork('response-pipeline', task, context);
    });
    this.registerHandler('operator.policy', async (task, context) => {
      const { executeOperatorPolicyWork } = await import('./operator-policy-handler.js');
      return executeOperatorPolicyWork(task, context);
    });
    this.registerHandler('environment.observation', async (task, context) => {
      const observation = task.input.observation ?? task.input;
      const graphName = task.input.graph;
      if (!graphName || task.username === 'system') {
        return { recorded: true, sessionId: observation.sessionId, graphExecuted: false };
      }

      const now = Date.now();
      const recentSessionRuns = this.queueManager.getHistory().filter(candidate =>
        candidate.type === 'environment_observation'
        && candidate.input?.observation?.sessionId === observation.sessionId
        && candidate.completedAt
        && now - Date.parse(candidate.completedAt) < 60_000).length;
      if (recentSessionRuns >= 8) {
        return { recorded: true, sessionId: observation.sessionId, graphExecuted: false, reason: 'automatic_step_limit' };
      }

      const [{ getUsers }, { loadGraphForMode }, { runGraph }, { withUserContext }] = await Promise.all([
        import('../users.js'),
        import('../graph-streaming.js'),
        import('../graph-runtime.js'),
        import('../context.js'),
      ]);
      const user = getUsers().find(candidate => candidate.username === task.username);
      if (!user) throw new Error(`Environment bridge user not found: ${task.username}`);
      const loaded = await loadGraphForMode(graphName, user.username);
      if (!loaded) throw new Error(`Environment graph not found: ${graphName}`);
      const text = (observation.text ?? []).map((event: any) => event.text).filter(Boolean).join('\n');
      const prompt = text || (observation.visual || observation.visuals?.length
        ? 'Review the returned environment image and state, then choose the next semantic action if one is needed.'
        : 'Review the returned environment state and choose the next semantic action if one is needed.');
      const graphState = await withUserContext(
        { userId: user.id, username: user.username, role: user.role },
        () => runGraph({
          graph: loaded.graph,
          signal: context.signal,
          context: {
            sessionId: observation.sessionId,
            userMessage: prompt,
            userId: user.id,
            username: user.username,
            cognitiveMode: 'environment',
            environment: 'server',
            environmentObservation: observation,
            abortSignal: context.signal,
          },
        }),
      );
      if (graphState.status !== 'completed') throw new Error('Environment graph execution failed');
      return {
        recorded: true,
        sessionId: observation.sessionId,
        graphExecuted: true,
        graph: graphName,
      };
    });

    this.registerHandler('workflow.sleep', async (task, context) => {
      const configPath = path.join(systemPaths.etc, 'sleep.json');
      const config = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
        : { enabled: true, window: { start: '23:00', end: '06:30' }, minIdleMins: 15 };
      if (!config.enabled) return { skipped: true, reason: 'sleep_disabled' };

      const manuallyRequested = task.source === 'user' || task.input.force === true;
      if (!manuallyRequested && !isWithinWindow(config.window)) {
        return { skipped: true, reason: 'outside_sleep_window' };
      }
      const lastActivity = readSystemActivityTimestamp();
      const idleMs = lastActivity ? Date.now() - lastActivity : Number.POSITIVE_INFINITY;
      if (!manuallyRequested && idleMs < Math.max(0, config.minIdleMins || 0) * 60_000) {
        return { skipped: true, reason: 'system_active' };
      }

      const date = new Date().toISOString().slice(0, 10);
      const children = [
        context.enqueue({
          type: 'dream',
          handler: 'agent.dreamer',
          source: task.source,
          username: task.username,
          priority: 'background',
          input: { triggeredBy: 'sleep-workflow' },
          parentTaskId: task.id,
          idempotencyKey: `sleep:${date}:dream`,
        }),
        context.enqueue({
          type: 'psychoanalyze',
          handler: 'agent.psychoanalyzer',
          source: task.source,
          username: task.username,
          priority: 'background',
          input: { triggeredBy: 'sleep-workflow' },
          parentTaskId: task.id,
          idempotencyKey: `sleep:${date}:psychoanalyze`,
        }),
      ];
      return {
        children: children.map(child => child.id),
        note: 'Audio processing and LoRA training remain explicit owner-triggered workflows.',
      };
    });

    this.registerHandler('generic', async (task) => ({ accepted: true, input: task.input }));
    this.registerHandler('custom', async (task) => ({ accepted: true, input: task.input }));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
    audit({ category: 'system', event: 'execution_engine_started', actor: 'system', level: 'info' });
  }

  async stop(): Promise<void> {
    if (!this.running && !this.loopPromise) return;
    this.running = false;
    this.wake();
    await this.loopPromise;
    await Promise.allSettled(this.activeExecutions.values());
    this.loopPromise = null;
    audit({ category: 'system', event: 'execution_engine_stopped', actor: 'system', level: 'info' });
  }

  isRunning(): boolean {
    return this.running;
  }

  private onQueueEvent(event: QueueEvent): void {
    if (event.type === 'task_enqueued' && event.taskId) {
      const incoming = this.queueManager.getTask(event.taskId);
      if (incoming?.type === 'user_message' && incoming.priority === 'critical') {
        const runningBackgroundTask = this.queueManager.getAllTasks().find(task =>
          task.state === 'leased'
          && task.resource === incoming.resource
          && task.source !== 'user'
          && task.priority !== 'critical'
          && !task.cancellationRequestedAt);
        if (runningBackgroundTask) {
          this.queueManager.cancel(
            runningBackgroundTask.id,
            `Preempted by critical user message ${incoming.id}`,
          );
        }
      }
    }
    if (event.type === 'task_cancel_requested' && event.taskId) {
      this.abortControllers.get(event.taskId)?.abort(event.details?.reason || 'Work cancelled');
    }
    this.wake();
  }

  private wake(): void {
    this.wakeResolver?.();
    this.wakeResolver = undefined;
  }

  private async waitForWake(): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.wakeResolver === finish) this.wakeResolver = undefined;
        resolve();
      };
      const timer = setTimeout(finish, this.wakeFallbackMs);
      timer.unref?.();
      this.wakeResolver = finish;
      if (!this.running) finish();
    });
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      this.queueManager.releaseWaiting();
      let dispatched = false;

      while (this.running) {
        const next = this.queueManager.getNextExecutable(task => this.canHandle(task));
        if (!next) break;
        const task = this.queueManager.claim(next.id);
        if (!task) break;
        dispatched = true;
        const execution = this.execute(task).finally(() => {
          this.activeExecutions.delete(task.id);
          this.abortControllers.delete(task.id);
          this.wake();
        });
        this.activeExecutions.set(task.id, execution);
      }

      if (!dispatched) await this.waitForWake();
    }
  }

  private async execute(task: QueuedTask): Promise<void> {
    const handler = this.resolveHandler(task);
    if (!handler) return;
    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);
    const startedAt = Date.now();

    try {
      const result = await handler(task, {
        signal: controller.signal,
        emit: chunk => this.queueManager.appendOutput(task.id, chunk),
        enqueue: this.queueManager.enqueue.bind(this.queueManager),
      });
      if (result === DEFERRED) return;
      if (controller.signal.aborted || task.cancellationRequestedAt) {
        this.queueManager.acknowledgeCancellation(task.id);
        return;
      }

      const normalizedResult = result && typeof result === 'object' ? result : {};
      this.queueManager.complete(task.id, true, normalizedResult);
      this.options.onTaskComplete?.(task, true, normalizedResult);
      audit({
        category: 'action',
        event: 'task_executed',
        actor: 'execution_engine',
        level: 'info',
        details: {
          taskId: task.id,
          type: task.type,
          handler: task.handler,
          resource: task.resource,
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (error) {
      if (controller.signal.aborted || task.cancellationRequestedAt) {
        this.queueManager.acknowledgeCancellation(task.id);
        return;
      }
      const normalized = error instanceof Error ? error : new Error(String(error));
      const retried = this.queueManager.requeue(task, {
        code: 'handler_failed',
        message: normalized.message,
        retryable: true,
      });
      this.options.onError?.(normalized, task);
      this.options.onTaskComplete?.(task, false, { error: normalized.message });
      audit({
        category: 'action',
        event: 'task_failed',
        actor: 'execution_engine',
        level: 'error',
        details: {
          taskId: task.id,
          type: task.type,
          handler: task.handler,
          durationMs: Date.now() - startedAt,
          error: normalized.message,
          retried,
        },
      });
    }
  }

  private canHandle(task: QueuedTask): boolean {
    return Boolean(this.resolveHandler(task));
  }

  private resolveHandler(task: QueuedTask): WorkHandler | undefined {
    const registered = this.handlers.get(task.handler);
    if (registered) return registered;
    if (!task.handler.startsWith('agent.')) return undefined;
    const agentId = task.handler.slice('agent.'.length);
    if (!resolveAgentExecutablePath(agentId)) return undefined;
    return (work, context) => this.runAgent(work, agentId, context.signal);
  }

  private runAgent(task: QueuedTask, agentId: string, signal: AbortSignal): Promise<Record<string, any>> {
    const fullPath = resolveAgentExecutablePath(agentId);
    if (!fullPath) return Promise.reject(new Error(`No maintained executable for agent: ${agentId}`));
    return new Promise((resolve, reject) => {
      const child = spawn(resolveTsx(), [fullPath], {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_PATH: buildAgentNodePath(),
          MH_TRIGGER_USERNAME: task.username,
          MH_TASK_ID: task.id,
          MH_TASK_PAYLOAD: JSON.stringify(task.input),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const abort = () => child.kill('SIGTERM');
      signal.addEventListener('abort', abort, { once: true });
      child.stdout?.on('data', data => { stdout += data.toString(); });
      child.stderr?.on('data', data => { stderr += data.toString(); });
      child.on('error', reject);
      child.on('close', code => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) {
          reject(new DOMException('Work cancelled', 'AbortError'));
        } else if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Agent exited with code ${code}: ${stderr || stdout}`));
        }
      });
    });
  }

  async executeVectorQueryDirect(query: string, limit: number, username: string): Promise<any> {
    const { queryIndex } = await import('../vector-index.js');
    return queryIndex(query, { topK: limit, username });
  }
}

let engineInstance: ExecutionEngine | null = null;

export function getExecutionEngine(options?: ExecutionEngineOptions): ExecutionEngine {
  if (!engineInstance) engineInstance = new ExecutionEngine(options);
  return engineInstance;
}

export function resetExecutionEngine(): void {
  if (engineInstance) void engineInstance.stop();
  engineInstance = null;
}

import type { QueueEvent, QueuedTask, WorkCognitiveMode } from '../queue/types.js';
import { getQueueManager, getQueueSystem } from '../queue/index.js';
import { loadCognitiveMode } from '../cognitive-mode.js';
import { readSystemActivityTimestamp } from '../system-activity.js';

export interface OperatorPolicyLimits {
  cooldownMs: number;
  maxConsecutiveTasks: number;
  maxEvaluationsPerHour: number;
  userPresenceCooldownMs: number;
}

const DEFAULT_LIMITS: OperatorPolicyLimits = {
  cooldownMs: 30_000,
  maxConsecutiveTasks: 5,
  maxEvaluationsPerHour: 12,
  userPresenceCooldownMs: 60_000,
};

export class OperatorPolicyService {
  private running = false;
  private username = 'system';
  private limits = DEFAULT_LIMITS;
  private timer?: NodeJS.Timeout;
  private scheduledAt?: number;
  private evaluationTimes: number[] = [];
  private consecutiveAutonomousWork = 0;
  private pauseUntil = 0;

  constructor() {
    getQueueManager().addEventListener(event => this.onQueueEvent(event));
  }

  start(username: string, limits: Partial<OperatorPolicyLimits> = {}): void {
    this.username = username;
    this.limits = {
      cooldownMs: Math.max(5_000, limits.cooldownMs ?? DEFAULT_LIMITS.cooldownMs),
      maxConsecutiveTasks: Math.max(1, limits.maxConsecutiveTasks ?? DEFAULT_LIMITS.maxConsecutiveTasks),
      maxEvaluationsPerHour: Math.max(1, limits.maxEvaluationsPerHour ?? DEFAULT_LIMITS.maxEvaluationsPerHour),
      userPresenceCooldownMs: Math.max(0, limits.userPresenceCooldownMs ?? DEFAULT_LIMITS.userPresenceCooldownMs),
    };
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.scheduledAt = undefined;
    for (const task of getQueueManager().getAllTasks()) {
      if (task.handler === 'operator.policy') getQueueManager().cancel(task.id, 'Full autonomy disabled');
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus() {
    const now = Date.now();
    this.evaluationTimes = this.evaluationTimes.filter(timestamp => now - timestamp < 60 * 60 * 1_000);
    return {
      running: this.running,
      scheduledAt: this.scheduledAt ? new Date(this.scheduledAt).toISOString() : undefined,
      evaluationsLastHour: this.evaluationTimes.length,
      consecutiveAutonomousWork: this.consecutiveAutonomousWork,
      pauseUntil: this.pauseUntil > now ? new Date(this.pauseUntil).toISOString() : undefined,
      limits: this.limits,
    };
  }

  private onQueueEvent(event: QueueEvent): void {
    if (!this.running) return;
    if (!['task_completed', 'task_failed', 'task_cancelled', 'task_expired'].includes(event.type) || !event.taskId) return;
    const task = getQueueManager().getTask(event.taskId);
    if (!task) return;
    if (task.handler === 'operator.policy') {
      const wakeAt = task.result?.wakeAt ? Date.parse(String(task.result.wakeAt)) : NaN;
      this.schedule(Number.isFinite(wakeAt) ? Math.max(0, wakeAt - Date.now()) : this.limits.cooldownMs);
      return;
    }
    if (task.source === 'autonomy') {
      this.consecutiveAutonomousWork += 1;
      if (this.consecutiveAutonomousWork >= this.limits.maxConsecutiveTasks) {
        this.pauseUntil = Date.now() + Math.max(5 * 60_000, this.limits.cooldownMs * 10);
      }
    } else {
      this.consecutiveAutonomousWork = 0;
      this.pauseUntil = 0;
    }
    this.schedule(this.limits.cooldownMs);
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    const target = Date.now() + Math.max(0, delayMs);
    if (this.timer && this.scheduledAt && this.scheduledAt <= target) return;
    if (this.timer) clearTimeout(this.timer);
    this.scheduledAt = target;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.scheduledAt = undefined;
      this.maybeEnqueuePolicy();
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private maybeEnqueuePolicy(): void {
    if (!this.running) return;
    const manager = getQueueManager();
    if (manager.getAllTasks().length > 0 || !getQueueSystem().isRunning()) return;
    const now = Date.now();
    if (this.pauseUntil > now) {
      this.schedule(this.pauseUntil - now);
      return;
    }
    if (this.pauseUntil && this.pauseUntil <= now) {
      this.pauseUntil = 0;
      this.consecutiveAutonomousWork = 0;
    }
    const activityAt = readSystemActivityTimestamp() || 0;
    if (activityAt && now - activityAt < this.limits.userPresenceCooldownMs) {
      this.schedule(this.limits.userPresenceCooldownMs - (now - activityAt));
      return;
    }
    this.evaluationTimes = this.evaluationTimes.filter(timestamp => now - timestamp < 60 * 60 * 1_000);
    if (this.evaluationTimes.length >= this.limits.maxEvaluationsPerHour) {
      this.schedule(60 * 60 * 1_000 - (now - this.evaluationTimes[0]));
      return;
    }

    const cognitiveMode = loadCognitiveMode().currentMode as WorkCognitiveMode;
    const bucket = Math.floor(now / this.limits.cooldownMs);
    const task = manager.enqueue({
      type: 'operator_policy',
      handler: 'operator.policy',
      resource: 'local-llm',
      source: 'autonomy',
      priority: 'background',
      input: { policyBudget: this.getStatus() },
      username: this.username,
      cognitiveMode,
      maxAttempts: 1,
      idempotencyKey: `operator-policy-evaluation:${bucket}`,
      metadata: { producer: 'operator-policy-service' },
    });
    if (task.handler === 'operator.policy') this.evaluationTimes.push(now);
  }
}

let instance: OperatorPolicyService | null = null;

export function getOperatorPolicyService(): OperatorPolicyService {
  if (!instance) instance = new OperatorPolicyService();
  return instance;
}

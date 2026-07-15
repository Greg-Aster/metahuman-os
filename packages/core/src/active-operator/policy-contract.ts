import type { UnifiedQueueManager } from '../queue/unified-queue-manager.js';
import type { QueuedTask, TaskInput, WorkCognitiveMode } from '../queue/types.js';

export type OperatorPolicyDecision =
  | { decision: 'execute'; taskId: string; reason: string }
  | { decision: 'wait'; reason: string; wakeAt?: string }
  | { decision: 'request_input'; taskId: string; reason: string }
  | { decision: 'propose'; handler: string; reason: string };

interface ProposalTemplate {
  type: TaskInput['type'];
  handler: string;
  input: Record<string, any>;
}

export const AUTONOMOUS_PROPOSALS: Record<string, ProposalTemplate> = {
  'agent.reflector': { type: 'reflect', handler: 'agent.reflector', input: { agentId: 'reflector' } },
  'agent.curiosity-service': { type: 'curiosity', handler: 'agent.curiosity-service', input: { agentId: 'curiosity' } },
  'agent.inner-curiosity': { type: 'inner_curiosity', handler: 'agent.inner-curiosity', input: { agentId: 'inner-curiosity' } },
  'agent.dreamer': { type: 'dream', handler: 'agent.dreamer', input: { agentId: 'dreamer' } },
  'agent.organizer': { type: 'memory_curate', handler: 'agent.organizer', input: { agentId: 'organizer' } },
  'agent.desire-generator': { type: 'desire_generate', handler: 'agent.desire-generator', input: { agentId: 'desire-generator' } },
};

export function parsePolicyDecision(value: unknown): OperatorPolicyDecision | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : '';
  if (!reason) return null;
  if (candidate.decision === 'execute' && typeof candidate.taskId === 'string') {
    return { decision: 'execute', taskId: candidate.taskId, reason };
  }
  if (candidate.decision === 'wait') {
    return {
      decision: 'wait',
      reason,
      wakeAt: typeof candidate.wakeAt === 'string' ? candidate.wakeAt : undefined,
    };
  }
  if (candidate.decision === 'request_input' && typeof candidate.taskId === 'string') {
    return { decision: 'request_input', taskId: candidate.taskId, reason };
  }
  if (candidate.decision === 'propose' && typeof candidate.handler === 'string') {
    return { decision: 'propose', handler: candidate.handler, reason };
  }
  return null;
}

export interface AppliedPolicyDecision {
  accepted: boolean;
  decision: OperatorPolicyDecision;
  selectedTaskId?: string;
  proposedTaskId?: string;
  wakeAt?: string;
  rejection?: string;
}

function rejection(decision: OperatorPolicyDecision, message: string): AppliedPolicyDecision {
  return { accepted: false, decision, rejection: message };
}

export function applyPolicyDecision(
  manager: UnifiedQueueManager,
  decision: OperatorPolicyDecision,
  options: { username: string; cognitiveMode?: WorkCognitiveMode; now?: number },
): AppliedPolicyDecision {
  const now = options.now ?? Date.now();
  if (decision.decision === 'execute') {
    const task = manager.getTask(decision.taskId);
    if (!task || task.state !== 'queued') return rejection(decision, 'Selected work is not queued');
    const next = manager.getNextExecutable();
    if (!next || next.id !== task.id) return rejection(decision, 'Selected work is not the deterministic next item');
    return { accepted: true, decision, selectedTaskId: task.id };
  }

  if (decision.decision === 'request_input') {
    const task = manager.getTask(decision.taskId);
    if (!task || task.state !== 'queued') return rejection(decision, 'Input may only be requested for queued work');
    manager.wait(task.id, decision.reason);
    return { accepted: true, decision, selectedTaskId: task.id };
  }

  if (decision.decision === 'wait') {
    if (decision.wakeAt) {
      const wakeAt = Date.parse(decision.wakeAt);
      if (!Number.isFinite(wakeAt) || wakeAt <= now || wakeAt > now + 60 * 60 * 1_000) {
        return rejection(decision, 'wakeAt must be within the next hour');
      }
    }
    return { accepted: true, decision, wakeAt: decision.wakeAt };
  }

  if (options.cognitiveMode === 'emulation') {
    return rejection(decision, 'Emulation cognitive mode cannot propose autonomous work');
  }
  const template = AUTONOMOUS_PROPOSALS[decision.handler];
  if (!template) return rejection(decision, 'Handler is not in the bounded autonomous proposal set');
  const bucket = Math.floor(now / (15 * 60 * 1_000));
  const task = manager.enqueue({
    type: template.type,
    handler: template.handler,
    source: 'autonomy',
    priority: 'low',
    input: { ...template.input, policyReason: decision.reason },
    username: options.username,
    cognitiveMode: options.cognitiveMode,
    maxAttempts: 1,
    idempotencyKey: `operator-policy:${template.handler}:${bucket}`,
    metadata: { producer: 'operator-policy' },
  });
  return { accepted: true, decision, proposedTaskId: task.id };
}

export function summarizePolicyTask(task: QueuedTask): Record<string, unknown> {
  return {
    id: task.id,
    type: task.type,
    handler: task.handler,
    state: task.state,
    priority: task.priority,
    source: task.source,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    result: task.result,
    error: task.error?.message,
  };
}

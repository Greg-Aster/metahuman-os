import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getQueueManager } from '../../queue/index.js';
import { readSystemActivityTimestamp } from '../../system-activity.js';
import { summarizeEnvironmentBridgeState } from '../../environment-interface/index.js';
import { summarizePolicyTask } from '../../active-operator/policy-contract.js';

const execute: NodeExecutor = async (_inputs, context) => {
  const manager = getQueueManager();
  const now = Date.now();
  const activityAt = readSystemActivityTimestamp() || 0;
  const activeWork = manager.getAllTasks()
    .filter(task => task.handler !== 'operator.policy')
    .slice(0, 20)
    .map(summarizePolicyTask);
  const recentHistory = manager.getHistory()
    .filter(task => task.handler !== 'operator.policy')
    .slice(0, 12)
    .map(summarizePolicyTask);
  const environment = summarizeEnvironmentBridgeState();

  return {
    policyContext: {
      autonomyMode: context.autonomyMode || 'full',
      cognitiveMode: context.cognitiveMode || 'dual',
      username: context.username || context.userId || 'system',
      activeWork,
      recentHistory,
      userActivity: {
        lastActivityAt: activityAt ? new Date(activityAt).toISOString() : null,
        idleMs: activityAt ? Math.max(0, now - activityAt) : null,
      },
      budget: context.policyBudget || {},
      environment: {
        enabled: environment.enabled,
        sessionCount: environment.sessionCount,
        sessions: environment.sessions.map(session => ({
          sessionId: session.sessionId,
          environmentId: session.environmentId,
          status: session.status,
          lastSeenAt: session.lastSeenAt,
        })),
      },
      gatheredAt: new Date(now).toISOString(),
    },
  };
};

export const OperatorPolicyContextNode: NodeDefinition = defineNode({
  id: 'operator_policy_context',
  name: 'Operator Policy Context',
  category: 'active-operator',
  inputs: [],
  outputs: [{ name: 'policyContext', type: 'object', description: 'Bounded coordinator, history, mode, activity, budget, and environment context' }],
  properties: {},
  description: 'Builds the bounded context for one full-autonomy policy decision',
  execute,
});

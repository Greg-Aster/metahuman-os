import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getQueueManager } from '../../queue/index.js';
import {
  applyPolicyDecision,
  parsePolicyDecision,
} from '../../active-operator/policy-contract.js';
import { audit } from '../../audit.js';

const execute: NodeExecutor = async (inputs, context) => {
  const decision = parsePolicyDecision(inputs.decision);
  if (!decision) {
    return { accepted: false, rejection: 'Invalid policy decision', decision: inputs.decision };
  }
  const applied = applyPolicyDecision(getQueueManager(), decision, {
    username: context.username || context.userId || 'system',
    cognitiveMode: context.cognitiveMode,
  });
  audit({
    category: 'system',
    level: applied.accepted ? 'info' : 'warn',
    event: 'operator_policy_decision',
    actor: 'active-operator',
    details: applied,
  });
  return applied;
};

export const OperatorPolicyGateNode: NodeDefinition = defineNode({
  id: 'operator_policy_gate',
  name: 'Operator Policy Gate',
  category: 'active-operator',
  inputs: [{ name: 'decision', type: 'decision', description: 'Untrusted LLM policy output' }],
  outputs: [
    { name: 'accepted', type: 'boolean', description: 'Whether deterministic validation accepted the decision' },
    { name: 'decision', type: 'decision', description: 'Validated decision' },
    { name: 'selectedTaskId', type: 'string', optional: true, description: 'Existing selected work ID' },
    { name: 'proposedTaskId', type: 'string', optional: true, description: 'New bounded work proposal ID' },
    { name: 'wakeAt', type: 'string', optional: true, description: 'Requested future wake time' },
    { name: 'rejection', type: 'string', optional: true, description: 'Deterministic rejection reason' },
  ],
  properties: {},
  description: 'Validates policy output and permits only coordinator selection, wait, input request, or one bounded proposal',
  execute,
});

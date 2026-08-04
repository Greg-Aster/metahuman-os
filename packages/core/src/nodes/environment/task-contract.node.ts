import { defineNode } from '../types.js';
import {
  environmentTaskContractFromRouting,
  type EnvironmentCompletionBasis,
  type EnvironmentContinuationPolicy,
  type EnvironmentTaskContract,
  type EnvironmentTaskDecision,
} from './helpers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decisionContract(value: EnvironmentTaskDecision): EnvironmentTaskContract | null {
  const continuationPolicy = value.continuationPolicy;
  const requiredCompletionBasis = value.requiredCompletionBasis;
  if (
    (continuationPolicy !== 'none' && continuationPolicy !== 'bounded')
    || !requiredCompletionBasis
    || requiredCompletionBasis === 'none'
  ) return null;
  return {
    objective: '',
    continuationPolicy: continuationPolicy as EnvironmentContinuationPolicy,
    requiredCompletionBasis: requiredCompletionBasis as EnvironmentCompletionBasis,
  };
}

export const environmentTaskContractNode = defineNode({
  id: 'environment_task_contract',
  name: 'Environment Task Contract',
  category: 'environment',
  inputs: [
    { name: 'taskDecision', type: 'object', optional: true, description: 'Environment LLM task result and completion claim' },
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'State-aware whole-objective contract from Environment Context Router' },
  ],
  outputs: [
    { name: 'taskDecision', type: 'object', description: 'Task decision carrying the independently classified whole-objective contract' },
    { name: 'contract', type: 'object', description: 'Selected continuation and completion-evidence contract' },
    { name: 'reconciled', type: 'boolean', description: 'Whether router-owned contract fields replaced the model fields' },
    { name: 'valid', type: 'boolean', description: 'Whether a structured task decision was available' },
    { name: 'error', type: 'string', description: 'Structured reconciliation error' },
  ],
  description: 'Reconciles independent task-contract classification without changing actions, outcome, completion claims, or evidence.',
  async execute(inputs) {
    if (!isRecord(inputs.taskDecision)) {
      return {
        taskDecision: null,
        contract: null,
        reconciled: false,
        valid: false,
        error: 'missing_task_decision',
      };
    }

    const taskDecision = inputs.taskDecision as unknown as EnvironmentTaskDecision;
    const routedContract = environmentTaskContractFromRouting(inputs.routingAnalysis);
    const modelContract = decisionContract(taskDecision);
    if (!routedContract) {
      return {
        taskDecision: { ...taskDecision },
        contract: modelContract,
        reconciled: false,
        valid: true,
        error: '',
      };
    }

    const reconciled = !modelContract
      || modelContract.continuationPolicy !== routedContract.continuationPolicy
      || modelContract.requiredCompletionBasis !== routedContract.requiredCompletionBasis;
    return {
      taskDecision: {
        ...taskDecision,
        continuationPolicy: routedContract.continuationPolicy,
        requiredCompletionBasis: routedContract.requiredCompletionBasis,
      },
      contract: routedContract,
      reconciled,
      valid: true,
      error: '',
    };
  },
});

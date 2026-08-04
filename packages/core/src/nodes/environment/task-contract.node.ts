import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { defineNode } from '../types.js';
import {
  environmentTaskContractFromObservation,
  environmentTaskContractFromRouting,
  type EnvironmentCompletionBasis,
  type EnvironmentContinuationPolicy,
  type EnvironmentTaskContract,
  type EnvironmentTaskContractConflict,
  type EnvironmentTaskContractSource,
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

function contractsDiffer(
  left: EnvironmentTaskContract,
  right: EnvironmentTaskContract,
): boolean {
  return left.continuationPolicy !== right.continuationPolicy
    || left.requiredCompletionBasis !== right.requiredCompletionBasis;
}

export const environmentTaskContractNode = defineNode({
  id: 'environment_task_contract',
  name: 'Environment Task Contract',
  category: 'environment',
  inputs: [
    { name: 'taskDecision', type: 'object', optional: true, description: 'Environment LLM task result and completion claim' },
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'Typed route including any newly authorized action contract' },
    { name: 'observation', type: 'object', optional: true, description: 'Current observation carrying any validator-persisted whole-objective contract' },
  ],
  outputs: [
    { name: 'taskDecision', type: 'object', description: 'Task decision carrying the independently classified whole-objective contract' },
    { name: 'contract', type: 'object', description: 'Selected continuation and completion-evidence contract' },
    { name: 'reconciled', type: 'boolean', description: 'Whether an authoritative persisted or fallback contract replaced missing or conflicting model fields' },
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
    const routingAnalysis = isRecord(inputs.routingAnalysis) ? inputs.routingAnalysis : null;
    const persistedContract = environmentTaskContractFromObservation(
      isRecord(inputs.observation)
        ? inputs.observation as unknown as EnvironmentObservation
        : null,
    );
    // The Environment decision owns whether a new objective is one-shot or
    // bounded. When both independent classifiers agree it is bounded, the Context
    // Router owns the whole-objective evidence classification. This keeps a
    // completion image from turning a one-shot action into a loop while ensuring
    // that a separate sensor stopping condition cannot be reduced to action_result.
    // Once persisted, the validator-owned contract is authoritative on every pass.
    const routedContract = routingAnalysis?.needsAction === true
      ? environmentTaskContractFromRouting(routingAnalysis)
      : null;
    const modelContract = decisionContract(taskDecision);
    let authoritativeContract: EnvironmentTaskContract | null = null;
    let taskContractSource: EnvironmentTaskContractSource | null = null;
    if (persistedContract) {
      authoritativeContract = persistedContract;
      taskContractSource = 'persisted';
    } else if (
      modelContract?.continuationPolicy === 'bounded'
      && routedContract?.continuationPolicy === 'bounded'
    ) {
      authoritativeContract = {
        ...modelContract,
        requiredCompletionBasis: routedContract.requiredCompletionBasis,
      };
      taskContractSource = contractsDiffer(modelContract, authoritativeContract)
        ? 'bounded_router_evidence'
        : 'environment_decision';
    } else if (modelContract) {
      authoritativeContract = modelContract;
      taskContractSource = 'environment_decision';
    } else if (routedContract) {
      authoritativeContract = routedContract;
      taskContractSource = 'router_fallback';
    }
    if (!authoritativeContract) {
      return {
        taskDecision: { ...taskDecision },
        contract: modelContract,
        reconciled: false,
        valid: true,
        error: '',
      };
    }

    const taskContractConflict: EnvironmentTaskContractConflict | null = (
      modelContract
      && routedContract
      && contractsDiffer(modelContract, routedContract)
    ) ? {
        model: {
          continuationPolicy: modelContract.continuationPolicy,
          requiredCompletionBasis: modelContract.requiredCompletionBasis,
        },
        routed: {
          continuationPolicy: routedContract.continuationPolicy,
          requiredCompletionBasis: routedContract.requiredCompletionBasis,
        },
      }
      : null;
    const reconciled = !modelContract
      || modelContract.continuationPolicy !== authoritativeContract.continuationPolicy
      || modelContract.requiredCompletionBasis !== authoritativeContract.requiredCompletionBasis;
    return {
      taskDecision: {
        ...taskDecision,
        continuationPolicy: authoritativeContract.continuationPolicy,
        requiredCompletionBasis: authoritativeContract.requiredCompletionBasis,
        taskContractSource: taskContractSource!,
        ...(taskContractConflict ? { taskContractConflict } : {}),
      },
      contract: authoritativeContract,
      reconciled,
      valid: true,
      error: '',
    };
  },
});

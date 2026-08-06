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
    ...(value.motionClass ? { motionClass: value.motionClass } : {}),
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
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'Advisory route containing fallback task-contract fields' },
    { name: 'observation', type: 'object', optional: true, description: 'Current observation carrying any validator-persisted whole-objective contract' },
  ],
  outputs: [
    { name: 'taskDecision', type: 'object', description: 'Environment LLM task decision carrying the selected whole-objective contract' },
    { name: 'contract', type: 'object', description: 'Selected continuation and completion-evidence contract' },
    { name: 'reconciled', type: 'boolean', description: 'Whether an authoritative persisted or fallback contract replaced missing or conflicting model fields' },
    { name: 'valid', type: 'boolean', description: 'Whether a structured task decision was available' },
    { name: 'error', type: 'string', description: 'Structured reconciliation error' },
  ],
  description: 'Preserves the Environment LLM task contract, using persisted lifecycle state or router fallback only when the model did not supply one.',
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
    // The Environment LLM is the semantic owner for a new task. The router
    // supplies a fallback only when the LLM omitted a usable contract. Once
    // persisted, validator-owned objective and evidence fields are authoritative
    // on every later pass.
    const routedContract = routingAnalysis?.needsAction === true
      ? environmentTaskContractFromRouting(routingAnalysis)
      : null;
    const modelContract = decisionContract(taskDecision);
    let authoritativeContract: EnvironmentTaskContract | null = null;
    let taskContractSource: EnvironmentTaskContractSource | null = null;
    if (persistedContract) {
      authoritativeContract = persistedContract;
      taskContractSource = 'persisted';
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
    const currentMotionClass = modelContract?.motionClass ?? authoritativeContract.motionClass;
    const selectedContract = {
      ...authoritativeContract,
      ...(currentMotionClass ? { motionClass: currentMotionClass } : {}),
    };
    const reconciled = !modelContract
      || modelContract.continuationPolicy !== authoritativeContract.continuationPolicy
      || modelContract.requiredCompletionBasis !== authoritativeContract.requiredCompletionBasis;
    return {
      taskDecision: {
        ...taskDecision,
        continuationPolicy: authoritativeContract.continuationPolicy,
        requiredCompletionBasis: authoritativeContract.requiredCompletionBasis,
        ...(currentMotionClass
          ? { motionClass: currentMotionClass }
          : {}),
        taskContractSource: taskContractSource!,
        ...(taskContractConflict ? { taskContractConflict } : {}),
      },
      contract: selectedContract,
      reconciled,
      valid: true,
      error: '',
    };
  },
});

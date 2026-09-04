/**
 * Browser-safe cognitive graph scheduling contract.
 *
 * This module has no runtime dependencies so editors and the engine share one
 * persisted contract and one set of defaults.
 */

export type GraphConditionValue = string | number | boolean | null;

/** Tests one output without treating false, zero, or empty strings as absent. */
export interface GraphOutputCondition {
  output: string;
  equals?: GraphConditionValue;
  notEquals?: GraphConditionValue;
  truthy?: boolean;
}

export interface GraphNodeActivation {
  mode?: 'required-inputs' | 'any-input' | 'always';
  requiredInputs?: string[];
  /** All conditions must match before this node is eligible to run. */
  when?: Array<GraphOutputCondition & { nodeId: string }>;
}

export interface GraphSchedulerContract {
  version: 1;
  activation: 'demand';
  skippedState: 'explicit';
  sideEffectOrder: 'serial-topological';
  maxLoopIterations: number;
}

export const DEFAULT_GRAPH_SCHEDULER: GraphSchedulerContract = {
  version: 1,
  activation: 'demand',
  skippedState: 'explicit',
  sideEffectOrder: 'serial-topological',
  maxLoopIterations: 5,
};

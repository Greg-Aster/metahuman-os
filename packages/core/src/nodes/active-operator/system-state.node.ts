/**
 * System State Node
 *
 * Context node that provides current system state metrics for context-aware decisions.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { gatherSystemState } from '../../active-operator/system-state.js';

const execute: NodeExecutor = async (inputs, context) => {
  const username = context.userId || context.username || 'anonymous';
  const queueLength = inputs.queueLength || 0;

  const state = await gatherSystemState(username, queueLength);

  console.log(`[SystemState] Gathered state: unprocessed=${state.unprocessedMemories}, indexAge=${state.indexAgeHours.toFixed(1)}h, desires(pending=${state.pendingDesires}, readyToAdvance=${state.pendingDesiresReadyToAdvance}, active=${state.activeDesires}, awaiting=${state.awaitingApprovalDesires}, approved=${state.approvedDesires}), tasks=${state.activeTasks || 0}(high=${state.highPriorityTasks || 0}), goals=${state.activeGoals || 0}`);

  return {
    unprocessedMemories: state.unprocessedMemories,
    indexAgeHours: state.indexAgeHours,
    pendingDesires: state.pendingDesires,
    pendingDesiresReadyToAdvance: state.pendingDesiresReadyToAdvance,
    activeDesires: state.activeDesires,
    awaitingApprovalDesires: state.awaitingApprovalDesires,
    approvedDesires: state.approvedDesires,
    hoursSinceReflection: state.hoursSinceReflection,
    userActive: state.userActive,
    // Task metrics
    activeTasks: state.activeTasks || 0,
    highPriorityTasks: state.highPriorityTasks || 0,
    overdueTasks: state.overdueTasks || 0,
    inProgressTasks: state.inProgressTasks || 0,
    blockedTasks: state.blockedTasks || 0,
    // Goal metrics
    shortTermGoals: state.shortTermGoals || 0,
    midTermGoals: state.midTermGoals || 0,
    longTermGoals: state.longTermGoals || 0,
    proposedGoals: state.proposedGoals || 0,
    activeGoals: state.activeGoals || 0,
    // Full state object
    systemState: state,
  };
};

export const SystemStateNode: NodeDefinition = defineNode({
  id: 'system_state',
  name: 'System State',
  category: 'active-operator',
  inputs: [
    { name: 'queueLength', type: 'number', optional: true, description: 'Queue length for metrics' },
  ],
  outputs: [
    { name: 'unprocessedMemories', type: 'number', description: 'Count of unprocessed memories' },
    { name: 'indexAgeHours', type: 'number', description: 'Hours since last index build' },
    { name: 'pendingDesires', type: 'number', description: 'Count of pending desires (waiting for activation)' },
    { name: 'pendingDesiresReadyToAdvance', type: 'number', description: 'Count of pending desires ABOVE activation threshold (can be processed by desire_advance)' },
    { name: 'activeDesires', type: 'number', description: 'Count of active desires (evaluating/planning/reviewing/executing)' },
    { name: 'awaitingApprovalDesires', type: 'number', description: 'Count of desires awaiting user approval' },
    { name: 'approvedDesires', type: 'number', description: 'Count of approved desires ready for autonomous execution' },
    { name: 'hoursSinceReflection', type: 'number', description: 'Hours since last reflection' },
    { name: 'userActive', type: 'boolean', description: 'Whether user is currently active' },
    // Task metrics
    { name: 'activeTasks', type: 'number', description: 'Total active tasks from task manager' },
    { name: 'highPriorityTasks', type: 'number', description: 'Count of P0/P1 priority tasks' },
    { name: 'overdueTasks', type: 'number', description: 'Count of overdue tasks' },
    { name: 'inProgressTasks', type: 'number', description: 'Count of tasks in progress' },
    { name: 'blockedTasks', type: 'number', description: 'Count of blocked tasks' },
    // Goal metrics
    { name: 'shortTermGoals', type: 'number', description: 'Count of short-term persona goals' },
    { name: 'midTermGoals', type: 'number', description: 'Count of mid-term persona goals' },
    { name: 'longTermGoals', type: 'number', description: 'Count of long-term persona goals' },
    { name: 'proposedGoals', type: 'number', description: 'Count of proposed goals awaiting approval' },
    { name: 'activeGoals', type: 'number', description: 'Count of active persona goals' },
    // Full state
    { name: 'systemState', type: 'object', description: 'Full system state object' },
  ],
  properties: {},
  description: 'Provides current system state metrics for context-aware decisions',
  execute,
});

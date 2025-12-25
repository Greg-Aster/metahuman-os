/**
 * Trigger Candidates Node
 *
 * Input node that evaluates all lizard brain triggers and returns
 * candidates that passed their condition checks.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { TRIGGERS, type TriggerResult } from '../../active-operator/lizard-brain.js';

interface TriggerCandidate {
  triggerId: string;
  triggerName: string;
  taskType: string;
  priority: string;
  reason: string;
  urgency: string;
  data?: unknown;
}

const execute: NodeExecutor = async (inputs, context) => {
  const username = context.userId || context.username || 'anonymous';
  const candidates: TriggerCandidate[] = [];

  console.log(`[TriggerCandidates] Evaluating ${TRIGGERS.length} triggers for ${username}...`);

  for (const trigger of TRIGGERS) {
    // Skip calendar_focus_window - it's a constraint, not a task generator
    if (trigger.id === 'calendar_focus_window') {
      continue;
    }

    try {
      const result = await trigger.condition(username);

      if (result.shouldTrigger) {
        // Determine task type (circadian may override)
        let taskType = trigger.taskType;
        if (trigger.id === 'circadian_activity' && result.data) {
          const recommended = (result.data as any).recommendedTasks;
          if (recommended && recommended.length > 0) {
            taskType = recommended[0];
          }
        }

        // Determine priority based on urgency
        let priority = trigger.priority;
        if (result.urgency === 'immediate') {
          priority = 'high';
        } else if (result.urgency === 'whenever') {
          priority = 'background';
        }

        candidates.push({
          triggerId: trigger.id,
          triggerName: trigger.name,
          taskType,
          priority,
          reason: result.reason || 'Condition met',
          urgency: result.urgency || 'soon',
          data: result.data,
        });

        console.log(`[TriggerCandidates] Trigger fired: ${trigger.id} -> ${taskType}`);
      }
    } catch (error) {
      console.error(`[TriggerCandidates] Error evaluating trigger ${trigger.id}:`, error);
    }
  }

  console.log(`[TriggerCandidates] Found ${candidates.length} trigger candidates`);

  return {
    candidates,
    candidateCount: candidates.length,
  };
};

export const TriggerCandidatesNode: NodeDefinition = defineNode({
  id: 'trigger_candidates',
  name: 'Trigger Candidates',
  category: 'active-operator',
  inputs: [],
  outputs: [
    { name: 'candidates', type: 'array', description: 'Array of candidate triggers that passed condition checks' },
    { name: 'candidateCount', type: 'number', description: 'Number of candidates' },
  ],
  properties: {},
  description: 'Input node receiving all triggers that passed their condition check (idle, inbox, circadian, etc.)',
  execute,
});

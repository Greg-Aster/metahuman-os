/**
 * Trigger Candidates Node
 *
 * Input node that evaluates all lizard brain triggers and returns
 * candidates that passed their condition checks.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { TRIGGERS, type TriggerResult } from '../../active-operator/lizard-brain.js';
import { loadConfig } from '../../active-operator/state-persister.js';
import { gatherSystemState } from '../../active-operator/system-state.js';

/**
 * Maintenance task types that should NOT run when user is engaged.
 * These are "housekeeping" tasks that can wait until the user is idle.
 */
const MAINTENANCE_TASKS = new Set([
  'memory_curate',
  'training_curate',
  'index_build',
  'psychoanalyze',
]);

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

  // Load enabled task types from config to filter triggers
  const config = loadConfig();
  const enabledTaskTypes = new Set(config.enabledTaskTypes || []);

  // Check if user is actively engaged (idle < 15 minutes)
  // If so, we'll filter out maintenance triggers to avoid "rude" housekeeping
  const systemState = await gatherSystemState(username);
  const userEngaged = (systemState.idleMinutes || 0) < 15;

  if (userEngaged) {
    console.log(`[TriggerCandidates] User is engaged (idle ${systemState.idleMinutes}m) - filtering maintenance triggers`);
  }

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

        // Skip triggers for disabled task types
        if (!enabledTaskTypes.has(taskType)) {
          console.log(`[TriggerCandidates] Skipping disabled task: ${trigger.id} -> ${taskType}`);
          continue;
        }

        // SOCIAL AWARENESS: Skip maintenance triggers when user is engaged
        // This prevents "rude" housekeeping while the user is actively chatting
        if (userEngaged && MAINTENANCE_TASKS.has(taskType)) {
          console.log(`[TriggerCandidates] Skipping maintenance task (user engaged): ${trigger.id} -> ${taskType}`);
          continue;
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

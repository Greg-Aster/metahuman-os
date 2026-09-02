import { defineNode } from '../types.js';
import {
  parseEnvironmentTaskInstruction,
  parseEnvironmentTaskState,
  type EnvironmentTaskState,
} from './helpers.js';
import { cleanEnvironmentText } from './task-lifecycle.js';

export const environmentTaskInputNode = defineNode({
  id: 'environment_task_input',
  name: 'Environment Task Input',
  category: 'environment',
  inputs: [
    { name: 'instruction', type: 'string', description: 'Current user or planner instruction' },
    { name: 'userInstruction', type: 'string', optional: true, description: 'Current human-authored instruction, when present' },
    { name: 'taskInstruction', type: 'string', optional: true, description: 'Serialized task state from Environment Action Context Input' },
  ],
  outputs: [
    { name: 'taskState', type: 'object', description: 'Loaded or newly initialized Environment task state' },
    { name: 'taskRestored', type: 'boolean', description: 'Whether task state was restored from the reported action' },
  ],
  description: 'Loads one serialized Environment task or initializes one from the explicit current instruction.',
  async execute(inputs) {
    const instruction = cleanEnvironmentText(inputs.instruction, 4_000);
    const userInstruction = cleanEnvironmentText(inputs.userInstruction, 4_000);
    const taskInstruction = cleanEnvironmentText(inputs.taskInstruction, 4_000);
    const restored = userInstruction ? null : parseEnvironmentTaskState(taskInstruction);
    const contract = !userInstruction && !restored
      ? parseEnvironmentTaskInstruction(taskInstruction)
      : null;
    const taskState: EnvironmentTaskState = restored ?? {
      version: 1,
      objective: contract?.objective || instruction || 'Respond to the current environment input.',
      phase: 'new',
      step: 0,
      continuationPolicy: contract?.continuationPolicy ?? 'none',
      requiredCompletionBasis: contract && contract.requiredCompletionBasis !== 'none'
        ? contract.requiredCompletionBasis
        : 'response',
      ...(contract?.motionClass ? { motionClass: contract.motionClass } : {}),
      ...(contract?.actionPurpose ? { actionPurpose: contract.actionPurpose } : {}),
      ...(contract?.visualEvidenceMode ? { visualEvidenceMode: contract.visualEvidenceMode } : {}),
    };
    return {
      taskState,
      taskRestored: Boolean(restored),
    };
  },
});

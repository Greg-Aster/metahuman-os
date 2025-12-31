/**
 * Active Operator Decision Engine Node
 *
 * Uses LLM to decide what cognitive task to run next based on:
 * - Current system state (unprocessed memories, index age, etc.)
 * - Recent activity from scratchpad
 * - Task recommendations
 * - Energy budget constraints
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import type { ModelRole } from '../../model-resolver.js';
import {
  gatherSystemState,
  formatSystemStateForLLM,
  getTaskRecommendations,
} from '../../active-operator/system-state.js';
import {
  loadScratchpad,
  recordDecision,
  getScratchpadContext,
} from '../../active-operator/state-persister.js';
import {
  isWithinBudget,
  getRemainingBudget,
  shouldPauseDueToErrors,
  getErrorStatus,
} from '../../active-operator/cost-tracker.js';
import { loadConfig } from '../../active-operator/state-persister.js';
import type { TaskType, TaskDecision, SystemState } from '../../active-operator/types.js';

/**
 * Task descriptions for the LLM prompt.
 */
const TASK_DESCRIPTIONS: Record<TaskType, string> = {
  user_message: 'Process a user chat message (highest priority)',
  memory_curate: 'Run organizer agent to enrich memories with tags and entities',
  training_curate: 'Run curator agent to prepare memories for LoRA training data',
  index_build: 'Build or update the vector embeddings index for semantic search',
  reflect: 'Generate internal reflections using associative memory chains',
  curiosity: 'Run curiosity service to generate user-facing questions',
  inner_curiosity: 'Generate and answer internal curiosity questions',
  dream: 'Create surreal dreams from memory fragments',
  desire_generate: 'Generate new desires from goals, tasks, and memories',
  desire_advance: 'Advance pending desires through planning/review/approval pipeline',
  desire_execute: 'Execute a pending desire that has reached activation threshold',
  psychoanalyze: 'Run psychoanalyzer to update persona based on recent memories',
  code_analyze: 'Analyze codebase for TypeScript errors (self-healing)',
};

/**
 * Format task options for the LLM.
 */
function formatTaskOptions(enabledTypes: TaskType[]): string {
  return enabledTypes
    .filter((t) => t !== 'user_message') // User messages are handled separately
    .map((t) => `- ${t}: ${TASK_DESCRIPTIONS[t]}`)
    .join('\n');
}

/**
 * Parse LLM response to extract task decision.
 */
function parseDecisionResponse(content: string): TaskDecision | null {
  // Try JSON parse first
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.task && TASK_DESCRIPTIONS[parsed.task as TaskType]) {
        return {
          task: parsed.task as TaskType,
          reasoning: parsed.reasoning || 'No reasoning provided',
          confidence: parsed.confidence,
        };
      }
    }
  } catch {
    // JSON parse failed, try text extraction
  }

  // Try to extract task from text
  for (const taskType of Object.keys(TASK_DESCRIPTIONS) as TaskType[]) {
    if (content.toLowerCase().includes(taskType.replace('_', ' '))) {
      // Extract reasoning from surrounding text
      const reasoningMatch = content.match(/reason(?:ing)?[:\s]+([^.]+)/i);
      return {
        task: taskType,
        reasoning: reasoningMatch?.[1]?.trim() || `Selected ${taskType}`,
      };
    }
  }

  return null;
}

const execute: NodeExecutor = async (inputs, context) => {
  const username = context.username || 'anonymous';
  const config = loadConfig();

  if (process.env.DEBUG_GRAPH) {
    console.log('[DecisionEngine] Starting decision cycle...');
  }

  // Check if we should pause due to errors
  const errorStatus = getErrorStatus();
  if (errorStatus.shouldPause) {
    console.warn('[DecisionEngine] Pausing due to consecutive errors:', errorStatus.consecutiveErrors);
    return {
      decision: null,
      paused: true,
      reason: `Paused after ${errorStatus.consecutiveErrors} consecutive errors. Last error: ${errorStatus.lastError}`,
    };
  }

  // Check energy budget
  if (!isWithinBudget()) {
    const remaining = getRemainingBudget();
    console.log('[DecisionEngine] Energy budget exceeded, waiting...');
    return {
      decision: null,
      paused: true,
      reason: `Energy budget exhausted. Remaining: ${remaining} tokens`,
    };
  }

  // Get queue length from inputs or default
  const queueLength = inputs[0]?.queueLength || 0;

  // Gather system state
  const systemState: SystemState = await gatherSystemState(username, queueLength);
  const stateText = formatSystemStateForLLM(systemState);

  // Get task recommendations - show more options so LLM sees diverse tasks
  const recommendations = getTaskRecommendations(systemState);
  const recommendationsText = recommendations
    .slice(0, 8) // Show top 8 to include more task variety
    .map((r) => `- [${r.urgency.toUpperCase()}] ${r.task}: ${r.reason}`)
    .join('\n');

  // Get recent scratchpad context
  const recentActivity = getScratchpadContext(10);

  // Get enabled task types
  const taskOptions = formatTaskOptions(config.enabledTaskTypes);

  // Build the decision prompt
  const messages = [
    {
      role: 'system' as const,
      content: `You are the Active Operator Decision Engine for MetaHuman OS.

Your role is to continuously decide what cognitive task the system should focus on next.
You are the "brain's executive function" - choosing what to think about based on current needs.

## Available Tasks:
${taskOptions}

## Guidelines:
1. Prioritize HIGH urgency recommendations first
2. Balance maintenance tasks (memory curation, indexing) with creative tasks (dreams, reflections)
3. If the user was recently active, avoid disruptive tasks
4. Consider the scratchpad history to avoid repeating the same task too often
5. If nothing urgent, choose a low-impact background task

## Output Format:
Respond with a JSON object:
{
  "task": "<task_type>",
  "reasoning": "<why this task now>",
  "confidence": 0.0-1.0
}`,
    },
    {
      role: 'user' as const,
      content: `${stateText}

## Recommendations (based on metrics):
${recommendationsText}

## Recent Activity:
${recentActivity}

What should I focus on next? Respond with JSON only.`,
    },
  ];

  try {
    // Determine which model to use
    let modelRole: ModelRole;
    switch (config.decisionModel) {
      case 'persona':
        modelRole = 'persona';
        break;
      case 'fast':
        // 'fast' uses orchestrator role (typically maps to a fast model)
        modelRole = 'orchestrator';
        break;
      default:
        modelRole = 'orchestrator';
    }

    console.log(`[DecisionEngine] Calling LLM (${modelRole}) for decision...`);

    const response = await callLLM({
      role: modelRole,
      messages,
      userId: username,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 256,
        temperature: 0.3,
      },
      onProgress: context.emitProgress,
    });

    // Parse the decision
    const decision = parseDecisionResponse(response.content);

    if (!decision) {
      console.warn('[DecisionEngine] Failed to parse decision:', response.content);
      // Fall back to first high-urgency recommendation
      const fallback = recommendations[0];
      const fallbackDecision: TaskDecision = {
        task: fallback?.task || 'reflect',
        reasoning: `Fallback: ${fallback?.reason || 'No recommendations'}`,
        confidence: 0.5,
      };
      recordDecision(fallbackDecision);
      return {
        decision: fallbackDecision,
        paused: false,
        systemState,
      };
    }

    // Record the decision in scratchpad
    recordDecision(decision);

    console.log(`[DecisionEngine] Decision: ${decision.task} - ${decision.reasoning}`);

    return {
      decision,
      paused: false,
      systemState,
    };
  } catch (error) {
    console.error('[DecisionEngine] Error:', error);
    throw new Error(`Decision engine failed: ${(error as Error).message}`);
  }
};

export const DecisionEngineNode: NodeDefinition = defineNode({
  id: 'active_operator_decision',
  name: 'Active Operator Decision Engine',
  category: 'active-operator',
  inputs: [
    { name: 'queueState', type: 'object', description: 'Current queue state', optional: true },
  ],
  outputs: [
    { name: 'decision', type: 'object', description: 'The task decision' },
    { name: 'paused', type: 'boolean', description: 'Whether operator is paused' },
    { name: 'systemState', type: 'object', description: 'Current system metrics' },
  ],
  properties: {
    model: 'orchestrator',
    temperature: 0.3,
  },
  propertySchemas: {
    model: {
      type: 'string',
      default: 'orchestrator',
      label: 'Decision Model',
      description: 'LLM model to use for decisions',
    },
    temperature: {
      type: 'slider',
      default: 0.3,
      label: 'Temperature',
      description: 'Lower = more deterministic decisions',
      min: 0,
      max: 1,
      step: 0.1,
    },
  },
  description: 'LLM-based decision engine for Active Operator',
  execute,
});

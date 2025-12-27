/**
 * Unified Decision LLM Node
 *
 * Single LLM that evaluates triggers + queue + state and decides what ONE task to execute next.
 * This is the core decision-making node for the Lizard Brain cognitive graph.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { recordDecision } from '../../active-operator/state-persister.js';
import { loadConfig } from '../../active-operator/state-persister.js';
import { audit } from '../../audit.js';
import type { TaskType, TaskDecision } from '../../active-operator/types.js';
import { parseThinkingBlocks } from '../output/thinking-stripper.node.js';

/**
 * Task descriptions for the LLM prompt.
 */
const TASK_DESCRIPTIONS: Record<TaskType, string> = {
  user_message: 'Process a user chat message (highest priority)',
  memory_curate: 'Run organizer agent to enrich memories with tags and entities',
  index_build: 'Build or update the vector embeddings index for semantic search',
  reflect: 'Generate internal reflections using associative memory chains',
  curiosity: 'Run curiosity service to generate user-facing questions',
  inner_curiosity: 'Generate and answer internal curiosity questions',
  dream: 'Create surreal dreams from memory fragments',
  desire_generate: 'Generate new desires from goals, tasks, and memories',
  desire_execute: 'Execute a pending desire that has reached activation threshold',
  psychoanalyze: 'Run psychoanalyzer to update persona based on recent memories',
  code_analyze: 'Analyze codebase for TypeScript errors (self-healing)',
};

const execute: NodeExecutor = async (inputs, context, properties) => {
  const username = context.userId || context.username || 'anonymous';
  const config = loadConfig();

  // Extract inputs from connected nodes
  const candidates = inputs.candidates || [];
  const queuedTasks = inputs.queuedTasks || [];
  const systemState = inputs.systemState || {};
  const recentActivity = inputs.recentActivity || '(No recent activity)';

  console.log(`[UnifiedDecisionLLM] Starting decision with ${candidates.length} triggers, ${queuedTasks.length} queued tasks`);

  // Format trigger list
  const triggerList = candidates.length > 0
    ? candidates.map((c: any) => `- [${c.urgency?.toUpperCase() || 'SOON'}] ${c.triggerName} → ${c.taskType}: ${c.reason}`).join('\n')
    : '(No triggers fired this cycle)';

  // Format queue list
  const queueList = queuedTasks.length > 0
    ? queuedTasks.slice(0, 5).map((t: any) => {
        const age = Math.round((Date.now() - new Date(t.queuedAt).getTime()) / 60000);
        return `- [${t.priority}] ${t.type}: queued ${age}m ago`;
      }).join('\n')
    : '(Queue is empty)';

  // Get enabled task types and format options
  const enabledTypes = config.enabledTaskTypes || Object.keys(TASK_DESCRIPTIONS);
  const taskOptions = enabledTypes
    .filter((t: TaskType) => t !== 'user_message' && TASK_DESCRIPTIONS[t])
    .map((t: TaskType) => `- ${t}: ${TASK_DESCRIPTIONS[t]}`)
    .join('\n');

  // Build the decision prompt
  const messages = [
    {
      role: 'system' as const,
      content: `You are the Lizard Brain for MetaHuman OS - the unified decision maker for autonomous behavior.

Your job is to look at:
1. Triggers that just fired (conditions detected)
2. Tasks already in queue
3. System state
4. Recent activity

And decide: What ONE task should I execute next?

Available Tasks:
${taskOptions}

Guidelines:
1. IMMEDIATE urgency triggers usually warrant action
2. Don't repeat tasks that ran recently (check recent activity)
3. Prioritize HIGH urgency items, but don't neglect maintenance
4. If queue has items, consider executing those before adding more
5. Balance reactive (triggers) with proactive (recommendations)
6. Consider system state - high unprocessed memories → memory_curate
7. DESIRE SYSTEM:
   - 🚀 APPROVED desires = HIGHEST PRIORITY! User approved these - execute immediately via desire_execute
   - If no desires exist (0 pending, 0 active, 0 approved), run desire_generate to create goals
   - If desires are pending/active, run desire_execute to process them
   - Desires awaiting approval: wait for user to approve (don't auto-approve unless high trust)
8. TRUST LEVELS:
   - observe/suggest: desires need user approval before execution
   - supervised_auto: low-risk desires auto-approved, medium/high need user approval
   - bounded_auto+: low/medium-risk auto-approved, high-risk needs approval
   - adaptive_auto: can expand boundaries based on successful outcomes
9. TASK AWARENESS:
   - High priority or overdue tasks may warrant desire_generate to address them
   - Many blocked tasks may indicate need for reflection or planning
10. GOAL AWARENESS:
   - If user has active goals but no desires, run desire_generate to make progress
   - Proposed goals need user review - don't wait indefinitely for them

Respond with JSON only: {"task": "<type>", "reasoning": "<why>"}
If nothing should run, respond: {"task": null, "reasoning": "<why waiting>"}`,
    },
    {
      role: 'user' as const,
      content: `=== TRIGGERS FIRED ===
${triggerList}

=== CURRENT QUEUE ===
${queueList}

=== SYSTEM STATE ===
- Unprocessed memories: ${systemState.unprocessedMemories || 0}
- Index age: ${(systemState.indexAgeHours || 0).toFixed(1)} hours
- Pending desires: ${systemState.pendingDesires || 0}
- Active desires: ${systemState.activeDesires || 0}
- Desires awaiting approval: ${systemState.awaitingApprovalDesires || 0}
- 🚀 APPROVED desires (ready to execute!): ${systemState.approvedDesires || 0}
- Last reflection: ${(systemState.hoursSinceReflection || 0).toFixed(1)} hours ago
- User active: ${systemState.userActive ? 'Yes' : 'No'}

=== USER TASKS ===
- Active tasks: ${systemState.activeTasks || 0} (${systemState.highPriorityTasks || 0} high priority, ${systemState.overdueTasks || 0} overdue)
- In progress: ${systemState.inProgressTasks || 0}, Blocked: ${systemState.blockedTasks || 0}

=== PERSONA GOALS ===
- Short-term: ${systemState.shortTermGoals || 0}, Mid-term: ${systemState.midTermGoals || 0}, Long-term: ${systemState.longTermGoals || 0}
- Active goals: ${systemState.activeGoals || 0}, Proposed: ${systemState.proposedGoals || 0}

=== RECENT ACTIVITY ===
${recentActivity}

What should I do next?`,
    },
  ];

  try {
    // Note: We don't pass cognitiveMode here because the lizard brain is a system utility,
    // not a cognitive mode. It uses the orchestrator role directly without mode-specific mappings.
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      userId: username,
      options: {
        // Increased from 256 to 512 to accommodate Qwen3's <think> blocks
        // before the actual JSON output
        maxTokens: properties?.maxTokens || 512,
        temperature: properties?.temperature || 0.2,
      },
    });

    // Strip <think> blocks before parsing JSON (Qwen3 reasoning mode support)
    const { stripped, thinking } = parseThinkingBlocks(response.content);
    if (thinking) {
      console.log(`[UnifiedDecisionLLM] Model reasoning: ${thinking.substring(0, 200)}...`);
    }

    // Parse response
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    let decision: TaskDecision | null = null;
    // Always ensure reasoning has content for inner dialogue output
    // Priority: explicit JSON reasoning > thinking block > default message
    let reasoning = thinking || 'Evaluating system state and triggers...';

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        // Override with explicit reasoning if provided
        if (parsed.reasoning) {
          reasoning = parsed.reasoning;
        }

        if (parsed.task && TASK_DESCRIPTIONS[parsed.task as TaskType]) {
          decision = {
            task: parsed.task as TaskType,
            reasoning,
          };
        }
      } catch (parseError) {
        console.warn(`[UnifiedDecisionLLM] JSON parse error, using thinking as reasoning`);
      }
    }

    // Log the unified decision
    audit({
      category: 'system',
      level: 'info',
      event: 'lizard_brain_unified_decision',
      actor: 'active-operator',
      details: {
        triggerCount: candidates.length,
        queueLength: queuedTasks.length,
        task: decision?.task || null,
        reasoning,
        triggers: candidates.map((c: any) => c.triggerId),
      },
    });

    if (decision) {
      recordDecision(decision);
      console.log(`[UnifiedDecisionLLM] Decision: ${decision.task} - ${reasoning}`);
    } else {
      console.log(`[UnifiedDecisionLLM] No task selected: ${reasoning}`);
    }

    return {
      task: decision?.task || null,
      reasoning,
      decision,
    };

  } catch (error) {
    console.error('[UnifiedDecisionLLM] Error:', error);
    throw error;
  }
};

export const UnifiedDecisionLLMNode: NodeDefinition = defineNode({
  id: 'unified_decision_llm',
  name: 'Unified Decision LLM',
  category: 'active-operator',
  inputs: [
    { name: 'candidates', type: 'array', description: 'Candidate triggers to evaluate' },
    { name: 'queuedTasks', type: 'array', description: 'Current queue state' },
    { name: 'systemState', type: 'object', description: 'Current system metrics' },
    { name: 'recentActivity', type: 'string', description: 'Recent activity context' },
  ],
  outputs: [
    { name: 'task', type: 'string', description: 'The task type to execute (or null)' },
    { name: 'reasoning', type: 'string', description: 'Why this task was chosen' },
    { name: 'decision', type: 'object', description: 'Full decision object' },
  ],
  properties: {
    model: 'orchestrator',
    temperature: 0.2,
    maxTokens: 256,
  },
  propertySchemas: {
    model: {
      type: 'select',
      default: 'orchestrator',
      label: 'Model',
      options: ['orchestrator', 'persona', 'coder'],
    },
    temperature: {
      type: 'slider',
      default: 0.2,
      label: 'Temperature',
      min: 0,
      max: 1,
      step: 0.1,
    },
    maxTokens: {
      type: 'slider',
      default: 512,
      label: 'Max Tokens',
      min: 128,
      max: 1024,
      step: 64,
    },
  },
  description: 'Single LLM that evaluates triggers + queue + state and decides what ONE task to execute next',
  execute,
});

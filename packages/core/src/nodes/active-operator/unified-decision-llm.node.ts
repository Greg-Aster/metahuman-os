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
import { appendReflectionToBuffer } from '../../conversation-buffer.js';

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
  desire_advance: 'Process PENDING desires through planning/review/approval (before they can execute)',
  desire_execute: 'Execute APPROVED desires only (after user or auto-approval)',
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
7. DESIRE SYSTEM (IMPORTANT - three-step flow):
   - desire_generate: Create new desires (when 0 pending, 0 active, 0 approved)
   - desire_advance: Process PENDING desires through planning/review/approval pipeline (ONLY if pendingReadyToAdvance > 0!)
   - desire_execute: Execute APPROVED desires ONLY (after approval granted)
   - FLOW: pending → (build strength) → desire_advance → (approved OR awaiting_approval) → desire_execute
   - 🚀 If approved > 0: run desire_execute immediately!
   - 📋 If pendingReadyToAdvance > 0: run desire_advance to process them
   - ⚠️ If pending > 0 but pendingReadyToAdvance = 0: desires are below activation threshold, they need reinforcement - DO NOT run desire_advance!
   - ⏳ If awaiting_approval > 0: wait for user (these need manual approval) - DO NOT run desire_advance!
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
11. CONTENT GENERATION CYCLE (CRITICAL):
   - You are a DYNAMIC thinking backend - keep the mind active!
   - When desires are stable (pending below threshold, nothing to execute), run these tasks:
     * curiosity: Asks user questions → user replies create NEW MEMORIES → feeds desire_generate
     * memory_curate: Enriches memories with tags/entities → makes them findable for reflection
     * index_build: Updates vector index → enables semantic search for memory retrieval
     * reflect: Creates reflections from memory associations → feeds desire_generate
     * dream: Creates dreams from memory fragments → feeds desire_generate
     * psychoanalyze: Updates persona understanding → shapes desire priorities
     * inner_curiosity: Generates self-directed Q&A → deepens understanding
   - These tasks CREATE and PROCESS the raw material that desire_generate uses!
   - FULL CYCLE: curiosity → memory_curate → index_build → reflect/dream/psychoanalyze → desire_generate → desire_advance → desire_execute
   - curiosity is especially valuable - it engages the user and generates fresh memory content!
   - If unprocessed memories > 0, run memory_curate to process them
   - If index is stale (> 2 hours), run index_build
   - If you've run desire tasks but nothing is ready, DO NOT repeat them - run content generators instead!
   - Check recent activity: if you just ran desire_advance with 0 processed, run something DIFFERENT next
12. AVOID REPETITION:
   - Look at RECENT ACTIVITY section carefully
   - If a task just ran and returned "processed=0" or similar, DO NOT run it again immediately
   - Cycle through different task types to keep the system evolving

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
- Pending desires (total): ${systemState.pendingDesires || 0}
- 📋 Pending desires READY to advance (above threshold): ${systemState.pendingDesiresReadyToAdvance || 0}
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
        // Enable extended thinking/reasoning for better decision making
        enableThinking: true,
        // Temperature for decision making - slightly higher for thoughtful reasoning
        temperature: properties?.temperature || 0.3,
        // Limit output tokens to leave room for input in context window
        // Model context is 4096, input is ~1200-1500 tokens, so max output ~2500
        // Setting to 2048 to be safe while allowing extended thinking
        maxTokens: 2048,
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

    // Format reasoning for inner dialogue output
    // Only show the explicit JSON reasoning if different from thinking (avoid duplication)
    const explicitReasoning = decision?.reasoning && decision.reasoning !== thinking
      ? `\n**Reason:** ${decision.reasoning}`
      : '';

    const formattedReasoning = thinking
      ? `🧠 **Lizard Brain Reasoning**\n\n${thinking}\n\n---\n**Decision:** ${decision?.task || 'Wait (no task needed)'}${explicitReasoning}`
      : `🧠 **Lizard Brain Decision**\n\n**Task:** ${decision?.task || 'None'}\n**Reason:** ${reasoning}`;

    // Output to inner dialogue (direct call - graph edge removed to prevent duplicates)
    appendReflectionToBuffer(username, formattedReasoning, {
      dialogueSource: 'lizard-brain',
      displayColor: '#8b5cf6', // Purple for Lizard Brain
      type: 'lizard_brain_decision',
      task: decision?.task || null,
    });

    return {
      task: decision?.task || null,
      reasoning: formattedReasoning,
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
    temperature: 0.3,
    // maxTokens comes from backend config (etc/llm-backend.json)
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
      default: 0.3,
      label: 'Temperature',
      min: 0,
      max: 1,
      step: 0.1,
    },
  },
  description: 'Single LLM that evaluates triggers + queue + state and decides what ONE task to execute next',
  execute,
});

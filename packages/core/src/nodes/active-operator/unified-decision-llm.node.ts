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
  training_curate: 'Run curator agent to prepare memories for LoRA training data',
  index_build: '(USER-TRIGGERED ONLY - do not run automatically)', // Incremental updates happen via appendEventToIndex
  reflect: 'Generate internal reflections using associative memory chains',
  curiosity: 'Run curiosity service to generate user-facing questions',
  inner_curiosity: 'Generate and answer internal curiosity questions',
  dream: 'Create surreal dreams from memory fragments',
  desire_generate: 'Generate new desires from goals, tasks, and memories',
  desire_advance: 'Process PENDING desires through planning/review/approval (before they can execute)',
  desire_execute: 'Execute APPROVED desires only (after user or auto-approval)',
  psychoanalyze: 'Run psychoanalyzer to update persona based on recent memories',
  code_analyze: 'Analyze codebase for TypeScript errors (self-healing)',
  help_ticket_review: 'Review user feedback tickets, analyze issues, and propose fixes to System Coder',
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

  // Extract desire summaries for transparency
  const desireSummaries = systemState.desireSummaries || [];

  // Format trigger list
  const triggerList = candidates.length > 0
    ? candidates.map((c: any) => `- [${c.urgency?.toUpperCase() || 'SOON'}] ${c.triggerName} → ${c.taskType}: ${c.reason}`).join('\n')
    : '(No triggers fired this cycle)';

  // Format desire details for the LLM to reason about
  const desireDetails = desireSummaries.length > 0
    ? desireSummaries.map((d: any) => {
        const strengthPct = (d.strength * 100).toFixed(0);
        const ready = d.readyToAdvance ? '✓ READY' : '';
        const status = d.status.toUpperCase();
        return `- "${d.title}" [${status}] ${strengthPct}% strength ${ready}`;
      }).join('\n')
    : '(No desires in pipeline)';

  // Format queue list
  const queueList = queuedTasks.length > 0
    ? queuedTasks.slice(0, 5).map((t: any) => {
        const age = Math.round((Date.now() - new Date(t.queuedAt).getTime()) / 60000);
        return `- [${t.priority}] ${t.type}: queued ${age}m ago`;
      }).join('\n')
    : '(Queue is empty)';

  // Get enabled task types and format options
  // Filter out user_message (handled separately) and index_build (user-triggered only)
  const enabledTypes = config.enabledTaskTypes || Object.keys(TASK_DESCRIPTIONS);
  const taskOptions = enabledTypes
    .filter((t: TaskType) => t !== 'user_message' && t !== 'index_build' && TASK_DESCRIPTIONS[t])
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
⚠️ CRITICAL: Check "Tasks awaiting user approval" FIRST - NEVER select a task that appears in that list!

🚨 SOCIAL AWARENESS (HIGHEST PRIORITY):
- If "User active: Yes" → the human is PRESENT and ENGAGED
- When user is active, AVOID maintenance tasks: memory_curate, training_curate, index_build, psychoanalyze
- These are "housekeeping" - it's RUDE to file papers while someone is talking to you!
- Instead, prioritize ENGAGEMENT: curiosity (ask them questions!), desire_execute, reflect
- Maintenance tasks should ONLY run when user has been idle for 15+ minutes
- Think of it this way: if you were having a conversation with someone, you wouldn't suddenly start organizing your desk

1. IMMEDIATE urgency triggers usually warrant action
2. Don't repeat tasks that ran recently (check recent activity)
3. When user is ACTIVE: prioritize engagement over housekeeping
4. If queue has items, consider executing those before adding more
5. Balance reactive (triggers) with proactive (recommendations)
6. ONLY consider memory_curate if user is INACTIVE and unprocessed memories > 5
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
11. CONTENT GENERATION CYCLE (SOCIAL-AWARE):
   - You are a DYNAMIC thinking backend - keep the mind active!
   - ⚠️ SPLIT INTO TWO MODES based on user presence:

   📍 USER ACTIVE (idleMinutes < 15): ENGAGEMENT MODE
     * curiosity: Ask user questions - CREATE conversation and new memories!
     * desire_execute: Run approved desires - show you're being productive!
     * reflect: Quick internal reflection - stays out of user's way
     * inner_curiosity: Self-directed Q&A - deepens understanding quietly

   💤 USER INACTIVE (idleMinutes >= 15): MAINTENANCE MODE
     * memory_curate: ONLY when user is idle - process untagged memories
     * training_curate: ONLY when user is idle - prepare LoRA training data
     * psychoanalyze: ONLY when user is idle - deep persona analysis
     * dream: ONLY during sleep hours or long idle periods

   - FULL CYCLE: curiosity → (wait for idle) → memory_curate → reflect/dream → desire_generate → desire_advance → desire_execute
   - curiosity is especially valuable - it ENGAGES the user and generates fresh memory content!
   - IMPORTANT: index_build is USER-TRIGGERED ONLY - the index is updated incrementally when memories are saved
   - If you've run desire tasks but nothing is ready, DO NOT repeat them - run content generators instead!
   - Check recent activity: if you just ran desire_advance with 0 processed, run something DIFFERENT next
12. AVOID REPETITION:
   - Look at RECENT ACTIVITY section carefully
   - If a task just ran and returned "processed=0" or similar, DO NOT run it again immediately
   - Cycle through different task types to keep the system evolving
13. HUMAN-IN-THE-LOOP (HITL) PROPOSALS:
   - Check "Tasks awaiting user approval" in SYSTEM STATE
   - If a task type appears in that list, DO NOT select it - it's waiting for user input!
   - Once user approves/rejects, the task will be removed from pending proposals
   - This prevents the same task from being proposed repeatedly while user reviews it

Respond with JSON only: {"task": "<type>", "reasoning": "<why>"}
If nothing should run, respond: {"task": null, "reasoning": "<why waiting>"}`,
    },
    {
      role: 'user' as const,
      content: `=== ⚠️ TASKS BLOCKED (awaiting user approval - DO NOT SELECT) ===
${(systemState.pendingProposalTasks || []).length > 0
  ? systemState.pendingProposalTasks.map((t: string) => `❌ ${t}`).join('\n')
  : '(none - all tasks available)'}

=== TRIGGERS FIRED ===
${triggerList}

=== CURRENT QUEUE ===
${queueList}

=== SYSTEM STATE ===
- 👤 User active: ${systemState.userActive ? 'YES - PRIORITIZE ENGAGEMENT!' : 'No (idle)'}
- ⏱️ Idle minutes: ${systemState.idleMinutes || 0} ${(systemState.idleMinutes || 0) < 15 ? '(< 15 = user is engaged, NO MAINTENANCE!)' : '(≥ 15 = OK for maintenance tasks)'}
- Unprocessed memories: ${systemState.unprocessedMemories || 0} ${systemState.userActive ? '(wait until idle to process!)' : ''}
- Index last updated: ${(systemState.indexAgeHours || 0).toFixed(1)} hours ago (auto-updated when memories are saved)
- Pending desires (total): ${systemState.pendingDesires || 0}
- 📋 Pending desires READY to advance (above threshold): ${systemState.pendingDesiresReadyToAdvance || 0}
- Active desires: ${systemState.activeDesires || 0}
- Desires awaiting approval: ${systemState.awaitingApprovalDesires || 0}
- 🚀 APPROVED desires (ready to execute!): ${systemState.approvedDesires || 0}
- Last reflection: ${(systemState.hoursSinceReflection || 0).toFixed(1)} hours ago

=== DESIRE PIPELINE (what I'm considering) ===
${desireDetails}

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
        // Model context is 4096, input can grow to ~2100+ tokens with recent activity
        // Setting to 1500 to ensure we stay within context limits
        maxTokens: 1500,
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

    // Format desire summary for transparency
    const desireSummaryText = desireSummaries.length > 0
      ? '\n\n**Active Desires:**\n' + desireSummaries.slice(0, 5).map((d: any) => {
          const pct = (d.strength * 100).toFixed(0);
          const statusIcon = d.readyToAdvance ? '🟢' : (d.status === 'approved' ? '🚀' : (d.status === 'awaiting_approval' ? '⏳' : '○'));
          return `${statusIcon} "${d.title}" (${pct}%, ${d.status})`;
        }).join('\n')
      : '';

    // Format reasoning for inner dialogue output
    // Only show the explicit JSON reasoning if different from thinking (avoid duplication)
    const explicitReasoning = decision?.reasoning && decision.reasoning !== thinking
      ? `\n**Reason:** ${decision.reasoning}`
      : '';

    const formattedReasoning = thinking
      ? `🧠 **Lizard Brain Reasoning**\n\n${thinking}\n\n---\n**Decision:** ${decision?.task || 'Wait (no task needed)'}${explicitReasoning}${desireSummaryText}`
      : `🧠 **Lizard Brain Decision**\n\n**Task:** ${decision?.task || 'None'}\n**Reason:** ${reasoning}${desireSummaryText}`;

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

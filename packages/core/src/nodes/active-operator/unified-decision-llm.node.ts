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
import { loadOperatorConfig } from '../../config.js';
import { audit } from '../../audit.js';
import type { TaskType, TaskDecision } from '../../active-operator/types.js';
import { parseThinkingBlocks } from '../output/thinking-stripper.node.js';
import { appendSystemMessageToBuffer } from '../../conversation-buffer.js';

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
  desire_explore: 'Research desire feasibility and generate smart context-aware questions (before planning)',
  desire_advance: 'Process QUESTIONING/PENDING desires through planning/review/approval (after exploration)',
  desire_execute: 'Execute APPROVED desires only (after user or auto-approval)',
  desire_review: 'Review execution outcomes to determine: retry, escalate, complete, or abandon',
  desire_checkin: 'Intelligent check-in on LONG-RUNNING goals - evaluate progress, ask questions, advance milestones',
  psychoanalyze: 'Run psychoanalyzer to update persona based on recent memories',
  code_analyze: 'Analyze codebase for TypeScript errors (self-healing)',
  help_ticket_review: 'Review user feedback tickets, analyze issues, and propose fixes to System Coder',
  idle: 'No-op task - do nothing and wait for conditions to change',
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
  const questioningDetails = systemState.questioningDesireDetails || [];
  const desireDetails = desireSummaries.length > 0
    ? desireSummaries.map((d: any) => {
        const strengthPct = (d.strength * 100).toFixed(0);
        const ready = d.readyToAdvance ? '✓ READY' : '';
        const status = d.status.toUpperCase();
        // Add questioning details if this desire has pending questions
        const qDetail = questioningDetails.find((q: any) => q.id === d.id);
        const questionInfo = qDetail
          ? ` ❓ ${qDetail.questionCount - qDetail.answeredCount} unanswered question(s)`
          : '';
        return `- "${d.title}" [${status}] ${strengthPct}% strength ${ready}${questionInfo}`;
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
7. DESIRE SYSTEM (IMPORTANT - six-step flow):
   - desire_generate: Create new desires (when 0 pending, 0 active, 0 approved)
   - desire_explore: Research feasibility & generate smart questions (when desires cross threshold)
   - desire_advance: Process desires through planning/review/approval pipeline (handles QUESTIONING desires!)
   - desire_execute: Execute APPROVED desires ONLY (after approval granted)
   - desire_review: Review execution outcomes (after execution, decide: retry/escalate/complete/abandon)
   - desire_checkin: Check on LONG-RUNNING goals (multi-week/month projects with milestones)
   - FLOW: pending → (build strength) → desire_explore → questioning → (user answers) → desire_advance → planning → reviewing → awaiting_approval → approved → desire_execute → awaiting_review → desire_review → completed/retry/escalate/abandon
   - 🔬 If pendingReadyToAdvance > 0 AND not yet explored: run desire_explore first!
   - 🚀 If approved > 0: run desire_execute immediately!
   - 🔍 If awaitingReview > 0: run desire_review immediately! (Post-execution review decides next steps)
   - ❓ QUESTIONING DESIRES (CRITICAL - do NOT block on these!):
     * questioningDesires > 0 means desires have unanswered clarifying questions
     * Run desire_advance to RE-PRESENT the questions to the user in chat
     * desire_advance will post the questions as a message the user can respond to
     * Do NOT wait indefinitely - if user hasn't answered after multiple cycles, continue with other tasks
     * The user can respond in chat at their convenience
   - 📋 Run desire_advance when:
     * questioningDesires > 0 (re-present unanswered questions to user!)
     * OR inPipelineDesires > 0 (desires in planning/reviewing need to continue!)
   - ⚠️ If pending > 0 but pendingReadyToAdvance = 0: those desires are below activation threshold, don't explore them
   - ⏳ If awaiting_approval > 0: wait for user approval (these need manual approval) - DO NOT run desire_advance on those!
   - 🔄 activeDesires includes ALL of: questioning, planning, reviewing, executing
   - 🎯 LONG-RUNNING GOALS: Desires like "Hike the PCT" persist for months with milestones
     * longRunningDesires: Count of active long-running goals
     * longRunningDesiresNeedingCheckin: Goals that haven't been checked on recently
     * Run desire_checkin when longRunningDesiresNeedingCheckin > 0 (especially when user is engaged!)
     * Check-ins evaluate progress, ask questions, and can advance milestones
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
- 🔄 In-pipeline desires (evaluating/planning/reviewing): ${systemState.inPipelineDesires || 0} ${(systemState.inPipelineDesires || 0) > 0 ? '← NEED ADVANCEMENT via desire_advance!' : ''}
- ❓ QUESTIONING desires (have unanswered questions): ${systemState.questioningDesires || 0} ${(systemState.questioningDesires || 0) > 0 ? '← RUN desire_advance to re-present questions!' : ''}
- Active desires (all stages including executing): ${systemState.activeDesires || 0}
- Desires awaiting approval: ${systemState.awaitingApprovalDesires || 0}
- 🚀 APPROVED desires (ready to execute!): ${systemState.approvedDesires || 0}
- 🔍 AWAITING REVIEW (post-execution): ${systemState.awaitingReviewDesires || 0} ${(systemState.awaitingReviewDesires || 0) > 0 ? '← NEED REVIEW via desire_review!' : ''}
- 🎯 LONG-RUNNING desires (active): ${systemState.longRunningDesires || 0}
- 📅 Long-running needing check-in: ${systemState.longRunningDesiresNeedingCheckin || 0} ${(systemState.longRunningDesiresNeedingCheckin || 0) > 0 ? '← RUN desire_checkin!' : ''}
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
    // Load operator config to check if Big Brother mode is enabled
    // IMPORTANT: Skip cache to respect user's current settings (they may have toggled BB mode)
    const operatorConfig = loadOperatorConfig(username, true);
    const isBigBrotherEnabled = operatorConfig.bigBrotherMode?.enabled || false;
    const isBigBrotherDelegateAll = operatorConfig.bigBrotherMode?.delegateAll || false;
    console.log(`[UnifiedDecisionLLM] Config check: bigBrotherMode.enabled=${isBigBrotherEnabled}, delegateAll=${isBigBrotherDelegateAll}`);

    // Hybrid mode: Big Brother enabled but not delegateAll - use Big Brother for decision-making
    // This sends autonomous decisions to external LLM (Claude) for better reasoning
    const useBigBrother = isBigBrotherEnabled && !isBigBrotherDelegateAll;

    // Determine max tokens based on whether Big Brother mode is active
    // When Big Brother is used (hybrid or delegateAll), external LLMs have much larger context windows
    let maxTokens: number | undefined;
    if (isBigBrotherEnabled) {
      // Big Brother mode (hybrid or delegateAll) - external LLMs like Claude handle the decision
      maxTokens = 4000;  // Can be more generous with external LLM context
      console.log(`[UnifiedDecisionLLM] Big Brother mode active (${useBigBrother ? 'hybrid' : 'delegateAll'}) - routing to external LLM`);
    } else {
      // Local LLM mode - must be conservative with context window
      // Model context is 4096, input can grow to ~2700+ tokens with recent activity
      // Setting to 1000 to ensure we stay within context limits (4096 - 2700 = ~1396 max)
      maxTokens = 1000;
      console.log(`[UnifiedDecisionLLM] Local LLM mode - using conservative token limit: ${maxTokens}`);
    }

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
        // Dynamic token limit based on Big Brother mode
        maxTokens,
        // Hybrid mode: route this decision to Big Brother for complex autonomous reasoning
        useBigBrother,
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

    // Output to system buffer for lizard brain decisions
    appendSystemMessageToBuffer(username, formattedReasoning, {
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
    // maxTokens is dynamically set based on operator mode:
    // - Big Brother mode with delegateAll: 8000 tokens (external LLMs have large context)
    // - Local LLM mode: 1000 tokens (conservative for 4K context window models)
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

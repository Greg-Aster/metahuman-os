/**
 * Big Brother Decision Node
 *
 * Delegates the Lizard Brain decision making to Big Brother (Claude) instead of
 * using the local vLLM. This bypasses context limits entirely.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { getUserContext } from '../../context.js';
import { loadOperatorConfig } from '../../config.js';
import { escalate, getActiveBackend, getBackend, ensureBackendsInitialized } from '../../escalation-backend.js';

// Task types that can be chosen
const VALID_TASKS = [
  'reflect', 'dream', 'curiosity', 'inner_curiosity', 'memory_curate',
  'training_curate', 'index_build', 'psychoanalyze', 'desire_generate',
  'desire_explore', 'desire_advance', 'desire_execute', 'desire_review', 'idle'
];

// Full task descriptions for Claude
const TASK_DESCRIPTIONS = `
AVAILABLE TASKS:
- reflect: Generate internal reflection based on associative memory chains. GOOD for processing experiences.
- dream: Create surreal dreams from memory fragments. Only during sleep hours or long idle.
- curiosity: Ask the USER a question to learn more about them. ENGAGES the user!
- inner_curiosity: Self-directed Q&A - ask and answer your own questions internally.
- memory_curate: Process unprocessed memories, add tags/entities. ONLY when user is idle.
- training_curate: Prepare curated training data for LoRA fine-tuning. ONLY when user is idle.
- index_build: Rebuild the semantic search index. USER-TRIGGERED ONLY.
- psychoanalyze: Deep persona analysis based on memories. ONLY when user is idle.
- desire_generate: Create new desires from goals, tasks, memories. Run if no pending desires.
- desire_explore: Research desire feasibility & generate smart questions. Run when desires cross threshold!
- desire_advance: Move questioning/pending desires through planning/approval stages.
- desire_execute: Execute APPROVED desires (strength >= threshold). HIGH PRIORITY if approved desires exist!
- desire_review: Review completed desire outcomes.
- idle: Do nothing, wait for conditions to change.
`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  const inputObj = inputs as Record<string, any>;
  const candidates = inputObj.candidates || [];
  const queuedTasks = inputObj.queuedTasks || [];
  const systemState = inputObj.systemState || {};
  const recentActivity = inputObj.recentActivity || '';

  const username = context?.userId || getUserContext()?.username || 'unknown';

  console.log(`[BigBrotherDecision] Starting decision with ${candidates.length} triggers, ${queuedTasks.length} queued tasks`);

  try {
    // Ensure Big Brother backends are loaded
    await ensureBackendsInitialized();

    const userContext = getUserContext();
    // Skip cache to respect user's current Big Brother settings
    const operatorConfig = userContext?.username ? loadOperatorConfig(userContext.username, true) : null;
    const rawProvider = operatorConfig?.bigBrotherMode?.provider;
    const preferredBackend = rawProvider === 'ollama' || rawProvider === 'openai'
      ? 'open-interpreter'
      : rawProvider;

    const backend = preferredBackend ? getBackend(preferredBackend) : getActiveBackend(userContext?.username);
    if (!backend) {
      throw new Error('No Big Brother backend configured');
    }

    const available = await backend.isAvailable();
    if (!available) {
      throw new Error(`Big Brother backend ${backend.name} is not available`);
    }

    console.log(`[BigBrotherDecision] Using ${backend.name} for decision making`);

    // Build the trigger list
    const triggerList = candidates.length > 0
      ? candidates.map((t: any) => `- ${t.taskType} (${t.priority}): ${t.reason || 'triggered'}`).join('\n')
      : '(no triggers fired)';

    // Build the queue list
    const queueList = queuedTasks.length > 0
      ? queuedTasks.map((t: any) => `- ${t.type} (${t.priority})`).join('\n')
      : '(queue empty)';

    // Build blocked tasks list
    const blockedTasks = (systemState.pendingProposalTasks || []).length > 0
      ? systemState.pendingProposalTasks.map((t: string) => `❌ ${t}`).join('\n')
      : '(none - all tasks available)';

    // Full prompt with ALL context - no truncation needed for Claude
    const prompt = `You are the Lizard Brain for MetaHuman OS - the autonomous decision maker.

${TASK_DESCRIPTIONS}

DECISION GUIDELINES:
1. APPROVED DESIRES (approvedDesires > 0): HIGH PRIORITY - run desire_execute!
2. PENDING DESIRES READY (pendingDesiresReadyToAdvance > 0): Run desire_advance to progress them.
3. DON'T repeat tasks that just ran - check RECENT ACTIVITY.
4. USER ACTIVE (idleMinutes < 15): Prefer curiosity, desire_execute, reflect.
5. USER INACTIVE (idleMinutes >= 15): Can run memory_curate, training_curate, psychoanalyze.
6. If nothing productive to do, return "idle".

=== BLOCKED TASKS (awaiting user approval - DO NOT SELECT) ===
${blockedTasks}

=== TRIGGERS FIRED ===
${triggerList}

=== CURRENT QUEUE ===
${queueList}

=== SYSTEM STATE ===
- Unprocessed memories: ${systemState.unprocessedMemories || 0}
- Index age: ${systemState.indexAgeHours?.toFixed(1) || 999} hours
- Hours since reflection: ${systemState.hoursSinceReflection?.toFixed(1) || 'unknown'}
- User active: ${systemState.userActive ? 'Yes' : 'No'} (idle ${systemState.idleMinutes || 0} mins)

=== DESIRES ===
- Pending: ${systemState.pendingDesires || 0}
- Ready to advance: ${systemState.pendingDesiresReadyToAdvance || 0}
- Active (evaluating/planning): ${systemState.activeDesires || 0}
- Awaiting approval: ${systemState.awaitingApprovalDesires || 0}
- APPROVED (ready to execute): ${systemState.approvedDesires || 0} ${systemState.approvedDesires > 0 ? '⚠️ EXECUTE THESE!' : ''}

=== TASKS ===
- Active: ${systemState.activeTasks || 0}
- High priority: ${systemState.highPriorityTasks || 0}
- Overdue: ${systemState.overdueTasks || 0}
- In progress: ${systemState.inProgressTasks || 0}
- Blocked: ${systemState.blockedTasks || 0}

=== PERSONA GOALS ===
- Short-term: ${systemState.shortTermGoals || 0}
- Mid-term: ${systemState.midTermGoals || 0}
- Long-term: ${systemState.longTermGoals || 0}
- Active: ${systemState.activeGoals || 0}
- Proposed: ${systemState.proposedGoals || 0}

=== RECENT ACTIVITY ===
${recentActivity}

Based on all this context, what ONE task should I execute next?

RESPOND WITH JSON ONLY:
{"task": "<task_type>", "reasoning": "<why this task>"}

If nothing should run:
{"task": null, "reasoning": "<why waiting>"}`;

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_decision_request',
      details: {
        triggersCount: candidates.length,
        queueLength: queuedTasks.length,
        approvedDesires: systemState.approvedDesires || 0,
        backend: backend.name,
      },
      actor: username,
    });

    // Send to Big Brother - no token limits!
    const result = await escalate(prompt, {
      timeout: properties?.timeout || 60000,
      sessionId: `lizard-brain-${Date.now()}`,
      preferredBackend,
      username: userContext?.username,
    });

    if (!result.success) {
      throw new Error(result.error || 'Big Brother decision failed');
    }

    const response = result.output;

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    let task: string | null = null;
    let reasoning = 'Big Brother made a decision';

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        task = parsed.task;
        reasoning = parsed.reasoning || reasoning;
      } catch (e) {
        console.error('[BigBrotherDecision] Failed to parse JSON response:', e);
      }
    }

    // Validate task
    if (task && !VALID_TASKS.includes(task)) {
      console.warn(`[BigBrotherDecision] Invalid task "${task}", defaulting to idle`);
      task = 'idle';
      reasoning = `Invalid task suggested: ${task}`;
    }

    console.log(`[BigBrotherDecision] Decision: ${task || 'idle'} - ${reasoning.substring(0, 100)}`);

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_decision_made',
      details: {
        task: task || 'idle',
        reasoning: reasoning.substring(0, 200),
        backend: backend.name,
      },
      actor: username,
    });

    return {
      task: task || 'idle',
      reasoning,
    };

  } catch (error) {
    console.error('[BigBrotherDecision] Error:', error);

    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_decision_failed',
      details: { error: (error as Error).message },
      actor: username,
    });

    return {
      task: 'idle',
      reasoning: `Big Brother decision failed: ${(error as Error).message}`,
    };
  }
};

export const BigBrotherDecisionNode: NodeDefinition = defineNode({
  id: 'big_brother_decision',
  name: 'Big Brother Decision',
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
  ],
  properties: {
    timeout: 60000,
  },
  description: 'Delegates decision making to Big Brother (Claude) - unlimited context',
  execute,
});

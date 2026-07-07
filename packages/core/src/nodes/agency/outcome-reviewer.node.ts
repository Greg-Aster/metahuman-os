/**
 * Outcome Reviewer Node
 *
 * Reviews the outcome of a desire's execution and determines next steps.
 * Routes through LLM to evaluate whether the goal was achieved.
 *
 * Inputs:
 *   - desire: Desire object with execution data
 *   - execution: Execution results from desire_executor
 *
 * Outputs:
 *   - outcomeReview: DesireOutcomeReview object
 *   - verdict: 'completed' | 'continue' | 'retry' | 'escalate' | 'abandon'
 *   - success: boolean
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesireExecution, DesireOutcomeReview, OutcomeVerdict, FailureCategory } from '../../agency/types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { audit } from '../../audit.js';
import { renderPromptTemplate } from '../prompt-template.js';

interface OutcomeReviewOutput {
  verdict: OutcomeVerdict;
  reasoning: string;
  successScore: number;
  failureCategory: FailureCategory;
  errorType?: string;
  isFixableBug: boolean;
  suggestedFix?: string;
  lessonsLearned: string[];
  nextAttemptSuggestions?: string[];
  adjustedStrength?: number;
  notifyUser: boolean;
  userMessage?: string;
  // Long-running goal support
  milestoneAdvance?: boolean;  // True if current milestone completed, advance to next
  completionCriteriaMet?: boolean;  // True only if ultimate goal is achieved
}

const SYSTEM_PROMPT = `You are the Outcome Review module of MetaHuman OS. Your job is to evaluate whether an executed desire actually achieved its goal, and critically analyze any failures.

## Your Role
You are an intelligent reviewer, not a simple pass/fail checker. Analyze the execution deeply:
1. Did the execution actually satisfy the desire?
2. If it failed, WHY did it fail? (This is critical for system improvement)
3. Is the failure fixable by the system itself, or does it need human help?
4. What should happen next?

## CRITICAL: Goal Types and Completion Criteria

**Goal Types**:
- **one_time**: Single achievement, then done (e.g., "buy a car"). Mark completed when done.
- **recurring**: Ongoing without end. Mark continue after each cycle.
- **long_running**: Takes weeks/months with milestones (e.g., "hike the PCT"). SPECIAL HANDLING REQUIRED.

**For LONG_RUNNING Goals**:
- DO NOT mark "completed" just because plan steps finished
- ONLY mark "completed" if the COMPLETION CRITERIA is ACTUALLY MET
- Example: For "Hike the PCT", completion = "Reach Monument 78 at Canadian border"
  - If just research was done → verdict: "continue" (advance to next milestone)
  - If user is still hiking → verdict: "continue"
  - Only when user reaches the border → verdict: "completed"
- Use "continue" verdict with milestoneAdvance: true to progress through phases
- Each plan execution covers ONE milestone, not the entire goal

## Verdict Options
- **completed**: The desire is FULLY satisfied. For long_running: ONLY if completionCriteria is met!
- **continue**: Keep pursuing. For long_running: Current milestone done, advance to next.
- **retry**: Failed or incomplete. Try again with improved approach. You MUST provide specific lessons and suggestions.
- **escalate**: Needs human intervention - external resources, permissions, or decisions required.
- **abandon**: Cannot be achieved or no longer relevant. Give up gracefully.

## Failure Categories (CRITICAL - analyze carefully)
When the execution fails, you MUST categorize the failure:

- **none**: No failure - execution succeeded
- **plan_error**: The strategy/approach was wrong. Need a different plan. Example: tried to use an API that doesn't exist, wrong sequence of steps
- **system_error**: Internal bug or code error in MetaHuman OS itself. Example: null pointer, missing function, type error, file not found where it should exist. The system (Big Brother) may be able to fix this.
- **external_error**: External dependency failed. Example: API rate limited, server down, network error, missing credentials, permission denied. User needs to help.
- **timeout**: Took too long. May need simplification or retry.
- **partial**: Some steps succeeded, some failed. May continue or retry.

## Bug Detection (IMPORTANT)
If you detect what appears to be a code bug in MetaHuman OS:
- Set isFixableBug: true
- Provide suggestedFix with actionable guidance
- This will route to Big Brother (Claude) for self-repair

Examples of fixable bugs:
- "TypeError: Cannot read property X of undefined" → missing null check
- "ENOENT: no such file or directory" → file path construction error
- "SyntaxError in generated code" → template or generation bug
- "Function X is not defined" → missing export or import

## Success Score (0.0 - 1.0)
- 1.0: Perfect execution, goal fully achieved
- 0.7-0.9: Good execution, minor issues
- 0.4-0.6: Partial success, significant work remains
- 0.1-0.3: Poor execution, minimal progress
- 0.0: Complete failure

## Guidelines
- Be precise about what went wrong - vague analysis doesn't help
- For retries, provide SPECIFIC actionable suggestions
- Distinguish between "the plan was bad" vs "the system has a bug" vs "external thing broke"
- If you see patterns suggesting a systemic issue, note it clearly
- Always provide actionable lessons learned

Respond with valid JSON matching the schema.`;

const DEFAULT_USER_PROMPT_TEMPLATE = `## Desire to Review

**Title**: {{title}}
**Description**: {{description}}
**Reason**: {{reason}}
**Original Goal**: {{operatorGoal}}{{previousAttemptsSection}}{{previousLessonsSection}}

## Goal Type & Completion Criteria
**Goal Type**: {{goalType}}
{{completionCriteriaSection}}
{{milestoneSection}}

## Execution Results

**Status**: {{executionStatus}}
**Steps Completed**: {{stepsCompleted}} / {{totalSteps}}
**Started**: {{startedAt}}
**Completed**: {{completedAt}}{{errorSection}}{{resultSection}}

### Step Results
{{stepResults}}

## Analysis Required

1. Did the desire's goal get achieved?
2. If failed: What category of failure is this? (plan_error, system_error, external_error, timeout, partial)
3. If system_error: Is this a bug that Big Brother (Claude with full code access) could fix?
4. What specific lessons should inform the next attempt?

## Output JSON Schema

{
  "verdict": "completed" | "continue" | "retry" | "escalate" | "abandon",
  "reasoning": "Detailed explanation - be specific about what happened",
  "successScore": 0.0-1.0,
  "failureCategory": "none" | "plan_error" | "system_error" | "external_error" | "timeout" | "partial",
  "errorType": "specific error type if identifiable (e.g., TypeError, ENOENT, 403 Forbidden)",
  "isFixableBug": true/false - is this a code bug Big Brother could fix?,
  "suggestedFix": "If isFixableBug, describe what needs to be fixed",
  "lessonsLearned": ["specific lesson 1", "specific lesson 2"],
  "nextAttemptSuggestions": ["actionable suggestion 1", "actionable suggestion 2"],
  "adjustedStrength": 0.0-1.0 (optional, for continue/retry),
  "notifyUser": true/false,
  "userMessage": "Message for user if notifyUser is true",
  "milestoneAdvance": true/false - for long_running: set true if current milestone completed and should advance to next,
  "completionCriteriaMet": true/false - for long_running: set true ONLY if the ultimate completion criteria is actually met
}`;

interface OutcomeReviewOptions {
  systemPrompt?: string;
  userPromptTemplate?: string;
  role?: string;
  temperature?: number;
}

async function runOutcomeReview(
  desire: Desire,
  execution?: DesireExecution,
  username?: string,
  options: OutcomeReviewOptions = {},
): Promise<OutcomeReviewOutput> {
  const plan = desire.plan;
  const exec = execution || desire.execution;

  // Include previous attempt context if this is a retry
  const previousAttempts = desire.metrics?.executionFailCount || 0;
  const previousLessons = desire.userCritique || '';

  // Build goal type and milestone context for long-running goals
  const goalType = desire.goalType || 'one_time';
  const completionCriteria = desire.completionCriteria;
  const currentMilestone = desire.milestones?.[desire.goalProgress?.currentMilestone || 0];
  const totalMilestones = desire.milestones?.length || 0;
  const completedMilestones = desire.goalProgress?.completedMilestones || 0;

  const stepResults = exec?.stepResults?.map((r: { success: boolean; error?: string; result?: unknown }, i: number) =>
    `${i + 1}. ${r.success ? 'success' : 'failed'} ${plan?.steps?.[i]?.action || 'Unknown step'}${r.error ? `\n   Error: ${r.error}` : ''}${r.result ? `\n   Output: ${typeof r.result === 'string' ? r.result.substring(0, 200) : JSON.stringify(r.result).substring(0, 200)}` : ''}`
  ).join('\n') || 'No step results available';

  const userPrompt = renderPromptTemplate(options.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE, {
    title: desire.title,
    description: desire.description,
    reason: desire.reason,
    operatorGoal: plan?.operatorGoal || 'Not specified',
    previousAttempts,
    previousAttemptsSection: previousAttempts > 0 ? `\n**Previous Failed Attempts**: ${previousAttempts}` : '',
    previousLessons,
    previousLessonsSection: previousLessons ? `\n**Previous Lessons/Critique**:\n${previousLessons}` : '',
    goalType,
    completionCriteria: completionCriteria || '',
    completionCriteriaSection: completionCriteria
      ? `**Completion Criteria**: ${completionCriteria}\nIMPORTANT: Only mark "completed" if THIS criteria is ACTUALLY MET, not just because steps finished!`
      : '',
    milestoneSection: goalType === 'long_running' && totalMilestones > 0
      ? `**Milestones**: ${completedMilestones}/${totalMilestones} completed\n**Current Milestone**: ${currentMilestone?.title || 'None'} (${currentMilestone?.description || 'No description'})\n**Note**: This plan execution covers the CURRENT MILESTONE only. If milestone succeeded but more milestones remain, use verdict="continue" with milestoneAdvance=true.`
      : '',
    executionStatus: exec?.status || 'unknown',
    stepsCompleted: exec?.stepsCompleted || 0,
    totalSteps: plan?.steps?.length || 0,
    startedAt: exec?.startedAt || 'unknown',
    completedAt: exec?.completedAt || 'in progress',
    errorSection: exec?.error ? `\n**Error**: ${exec.error}` : '',
    resultSection: exec?.result ? `\n**Result/Output**: ${typeof exec.result === 'string' ? exec.result : JSON.stringify(exec.result, null, 2)}` : '',
    stepResults,
    desire,
    execution: exec,
    plan,
  });

  const messages: RouterMessage[] = [
    { role: 'system', content: options.systemPrompt ?? SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: options.role ?? 'persona',
      messages,
      userId: username,
      options: { temperature: options.temperature ?? 0.3, responseFormat: 'json' },
    });

    if (!response.content) {
      return {
        verdict: 'escalate',
        reasoning: 'Failed to get outcome review response',
        successScore: 0,
        failureCategory: 'system_error',
        isFixableBug: false,
        lessonsLearned: ['Outcome review failed - LLM returned empty response'],
        notifyUser: true,
        userMessage: 'Outcome review could not be completed automatically.',
      };
    }

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        verdict: 'escalate',
        reasoning: 'Could not parse outcome review response',
        successScore: 0,
        failureCategory: 'system_error',
        isFixableBug: true,
        suggestedFix: 'LLM response parsing failed - may need to improve JSON extraction in outcome-reviewer.node.ts',
        lessonsLearned: ['Outcome review parsing failed'],
        notifyUser: true,
        userMessage: 'Outcome review response was invalid.',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as OutcomeReviewOutput;
    return {
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      successScore: Math.max(0, Math.min(1, parsed.successScore)),
      failureCategory: parsed.failureCategory || 'none',
      errorType: parsed.errorType,
      isFixableBug: parsed.isFixableBug ?? false,
      suggestedFix: parsed.suggestedFix,
      lessonsLearned: parsed.lessonsLearned || [],
      nextAttemptSuggestions: parsed.nextAttemptSuggestions,
      adjustedStrength: parsed.adjustedStrength,
      notifyUser: parsed.notifyUser ?? false,
      userMessage: parsed.userMessage,
      // Long-running goal support
      milestoneAdvance: parsed.milestoneAdvance ?? false,
      completionCriteriaMet: parsed.completionCriteriaMet ?? false,
    };
  } catch (error) {
    return {
      verdict: 'escalate',
      reasoning: `Outcome review error: ${(error as Error).message}`,
      successScore: 0,
      failureCategory: 'system_error',
      isFixableBug: true,
      suggestedFix: 'The outcome review process itself failed - check outcome-reviewer.node.ts',
      lessonsLearned: ['Outcome review threw an error - this is a system issue'],
      notifyUser: true,
      userMessage: `Outcome review failed: ${(error as Error).message}`,
    };
  }
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Inputs from graph - graph executor maps by handle name (string keys)
  // Edge uses slot_0/slot_1 handles, so we access by those keys
  // Also check context.desire for direct injection from reviewOutcomeViaGraph
  const slot0 = (inputs['slot_0'] || inputs[0]) as { desire?: Desire; execution?: DesireExecution } | Desire | undefined;
  const slot1 = (inputs['slot_1'] || inputs[1]) as { execution?: DesireExecution } | undefined;
  const username = context.userId || context.username;

  // Handle both wrapped { desire } format and direct Desire object
  // Also check context.desire for cases where desire is injected directly
  let desire: Desire | undefined;
  if (context.desire) {
    desire = context.desire as Desire;
  } else if (slot0) {
    desire = (slot0 as { desire?: Desire }).desire || (slot0 as Desire);
  }
  // Get execution from various sources - slot1, slot0 (if wrapped), or desire itself
  const execution = slot1?.execution ||
    (slot0 as { execution?: DesireExecution })?.execution ||
    desire?.execution;

  if (!desire) {
    return {
      outcomeReview: null,
      verdict: null,
      success: false,
      error: 'No desire provided',
    };
  }

  if (!execution) {
    return {
      outcomeReview: null,
      verdict: null,
      success: false,
      error: 'No execution data available',
    };
  }

  console.log(`[outcome-reviewer] 🔍 Reviewing outcome for: ${desire.title}`);

  try {
    const reviewResult = await runOutcomeReview(desire, execution, username, {
      systemPrompt: properties?.systemPrompt ?? SYSTEM_PROMPT,
      userPromptTemplate: properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE,
      role: properties?.role ?? 'persona',
      temperature: properties?.temperature ?? 0.3,
    });

    const outcomeReview: DesireOutcomeReview = {
      id: `outcome-${desire.id}-${Date.now()}`,
      verdict: reviewResult.verdict,
      reasoning: reviewResult.reasoning,
      successScore: reviewResult.successScore,
      failureCategory: reviewResult.failureCategory,
      errorType: reviewResult.errorType,
      isFixableBug: reviewResult.isFixableBug,
      suggestedFix: reviewResult.suggestedFix,
      lessonsLearned: reviewResult.lessonsLearned,
      nextAttemptSuggestions: reviewResult.nextAttemptSuggestions,
      adjustedStrength: reviewResult.adjustedStrength,
      reviewedAt: new Date().toISOString(),
      notifyUser: reviewResult.notifyUser,
      userMessage: reviewResult.userMessage,
    };

    console.log(`[outcome-reviewer]    Verdict: ${reviewResult.verdict}`);
    console.log(`[outcome-reviewer]    Success Score: ${reviewResult.successScore}`);
    console.log(`[outcome-reviewer]    Failure Category: ${reviewResult.failureCategory}`);
    if (reviewResult.isFixableBug) {
      console.log(`[outcome-reviewer]    🔧 Fixable Bug Detected: ${reviewResult.errorType || 'unknown'}`);
      console.log(`[outcome-reviewer]    Suggested Fix: ${reviewResult.suggestedFix}`);
    }
    if (reviewResult.milestoneAdvance) {
      console.log(`[outcome-reviewer]    📍 Milestone completed - ready to advance`);
    }
    if (reviewResult.completionCriteriaMet) {
      console.log(`[outcome-reviewer]    ✅ Completion criteria MET - goal fully achieved`);
    }

    // Audit the review
    audit({
      category: 'agent',
      level: reviewResult.verdict === 'escalate' ? 'warn' : 'info',
      event: 'desire_outcome_reviewed',
      actor: 'outcome-reviewer-node',
      details: {
        desireId: desire.id,
        title: desire.title,
        verdict: reviewResult.verdict,
        successScore: reviewResult.successScore,
        failureCategory: reviewResult.failureCategory,
        errorType: reviewResult.errorType,
        isFixableBug: reviewResult.isFixableBug,
        notifyUser: reviewResult.notifyUser,
        goalType: desire.goalType,
        milestoneAdvance: reviewResult.milestoneAdvance,
        completionCriteriaMet: reviewResult.completionCriteriaMet,
      },
    });

    // Generate human-readable summary for inner dialogue and TTS
    let summary = `Reviewed "${desire.title}" — verdict: ${reviewResult.verdict}. ${reviewResult.reasoning}`;
    if (reviewResult.lessonsLearned?.length) {
      summary += ` Lessons: ${reviewResult.lessonsLearned.slice(0, 2).join('; ')}`;
    }
    if (reviewResult.milestoneAdvance) {
      summary += ` Milestone completed, advancing to next phase.`;
    }

    return {
      outcomeReview,
      verdict: reviewResult.verdict,
      success: true,
      desire, // Pass through for downstream nodes
      summary, // Human-readable summary for inner dialogue and TTS
      // Long-running goal outputs
      milestoneAdvance: reviewResult.milestoneAdvance,
      completionCriteriaMet: reviewResult.completionCriteriaMet,
    };
  } catch (error) {
    console.error(`[outcome-reviewer] ❌ Error:`, error);
    return {
      outcomeReview: null,
      verdict: null,
      success: false,
      error: (error as Error).message,
    };
  }
};

export const OutcomeReviewerNode: NodeDefinition = defineNode({
  id: 'outcome_reviewer',
  name: 'Outcome Reviewer',
  category: 'agency',
  description: 'Reviews execution outcomes and determines next steps',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire with execution data' },
    { name: 'execution', type: 'object', optional: true, description: 'Execution results (optional, can be on desire)' },
  ],
  outputs: [
    { name: 'outcomeReview', type: 'object', description: 'Outcome review results' },
    { name: 'verdict', type: 'string', description: 'Review verdict' },
    { name: 'success', type: 'boolean', description: 'Whether review completed' },
    { name: 'desire', type: 'object', description: 'Pass-through desire' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
    { name: 'summary', type: 'string', description: 'Human-readable summary for inner dialogue and TTS' },
    { name: 'milestoneAdvance', type: 'boolean', optional: true, description: 'True if milestone completed and should advance' },
    { name: 'completionCriteriaMet', type: 'boolean', optional: true, description: 'True if ultimate completion criteria is met' },
  ],
  properties: {
    temperature: 0.3,
    role: 'persona',
    systemPrompt: SYSTEM_PROMPT,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 0.3,
      label: 'Temperature',
      description: 'LLM temperature for review (lower = more deterministic)',
    },
    role: {
      type: 'string',
      default: 'persona',
      label: 'LLM Role',
    },
    systemPrompt: {
      type: 'text_multiline',
      default: SYSTEM_PROMPT,
      label: 'System Prompt',
      rows: 28,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Template variables include {{title}}, {{executionStatus}}, {{stepResults}}, {{desire}}, {{execution}}, {{plan}}.',
      rows: 34,
    },
  },
  execute,
});

export default OutcomeReviewerNode;

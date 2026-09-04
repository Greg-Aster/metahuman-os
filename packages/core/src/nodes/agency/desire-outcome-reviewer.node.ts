/**
 * Desire Outcome Reviewer Node
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
import { callLLM, normalizeModelRole, type ModelRole, type RouterMessage } from '../../model-router.js';
import { audit } from '../../audit.js';
import { renderPromptTemplate } from '../prompt-template.js';

interface DesireOutcomeReviewOutput {
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

const OUTCOME_VERDICTS = new Set<OutcomeVerdict>([
  'completed', 'continue', 'retry', 'escalate', 'abandon',
]);
const FAILURE_CATEGORIES = new Set<FailureCategory>([
  'none', 'plan_error', 'system_error', 'external_error', 'timeout', 'partial',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`Outcome review ${name} must be a string`);
  return value.trim() || undefined;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Outcome review ${name} must be a boolean`);
  return value;
}

function stringArray(value: unknown, name: string, optional = false): string[] | undefined {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Outcome review ${name} must be an array of non-empty strings`);
  }
  return value.map(item => String(item).trim());
}

export function parseDesireOutcomeReviewResponse(content: string): DesireOutcomeReviewOutput {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Outcome review response did not contain a JSON object');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new Error(`Outcome review response was not valid JSON: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) throw new Error('Outcome review response must be an object');
  if (typeof parsed.verdict !== 'string' || !OUTCOME_VERDICTS.has(parsed.verdict as OutcomeVerdict)) {
    throw new Error('Outcome review verdict is invalid');
  }
  if (typeof parsed.reasoning !== 'string' || !parsed.reasoning.trim()) {
    throw new Error('Outcome review reasoning is required');
  }
  if (typeof parsed.successScore !== 'number'
    || !Number.isFinite(parsed.successScore)
    || parsed.successScore < 0
    || parsed.successScore > 1) {
    throw new Error('Outcome review successScore must be between 0 and 1');
  }
  if (typeof parsed.failureCategory !== 'string'
    || !FAILURE_CATEGORIES.has(parsed.failureCategory as FailureCategory)) {
    throw new Error('Outcome review failureCategory is invalid');
  }
  if (typeof parsed.isFixableBug !== 'boolean' || typeof parsed.notifyUser !== 'boolean') {
    throw new Error('Outcome review requires boolean isFixableBug and notifyUser fields');
  }
  if (parsed.adjustedStrength !== undefined
    && (typeof parsed.adjustedStrength !== 'number'
      || !Number.isFinite(parsed.adjustedStrength)
      || parsed.adjustedStrength < 0
      || parsed.adjustedStrength > 1)) {
    throw new Error('Outcome review adjustedStrength must be between 0 and 1');
  }

  return {
    verdict: parsed.verdict as OutcomeVerdict,
    reasoning: parsed.reasoning.trim(),
    successScore: parsed.successScore,
    failureCategory: parsed.failureCategory as FailureCategory,
    errorType: optionalString(parsed.errorType, 'errorType'),
    isFixableBug: parsed.isFixableBug,
    suggestedFix: optionalString(parsed.suggestedFix, 'suggestedFix'),
    lessonsLearned: stringArray(parsed.lessonsLearned, 'lessonsLearned')!,
    nextAttemptSuggestions: stringArray(
      parsed.nextAttemptSuggestions,
      'nextAttemptSuggestions',
      true,
    ),
    adjustedStrength: parsed.adjustedStrength as number | undefined,
    notifyUser: parsed.notifyUser,
    userMessage: optionalString(parsed.userMessage, 'userMessage'),
    milestoneAdvance: optionalBoolean(parsed.milestoneAdvance, 'milestoneAdvance'),
    completionCriteriaMet: optionalBoolean(
      parsed.completionCriteriaMet,
      'completionCriteriaMet',
    ),
  };
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
- **system_error**: Internal bug or code error in MetaHuman OS itself. Record the evidence precisely for user review; this reviewer has no authority to repair code.
- **external_error**: External dependency failed. Example: API rate limited, server down, network error, missing credentials, permission denied. User needs to help.
- **timeout**: Took too long. May need simplification or retry.
- **partial**: Some steps succeeded, some failed. May continue or retry.

## Bug Detection (IMPORTANT)
If you detect what appears to be a code bug in MetaHuman OS:
- Set isFixableBug: true
- Provide suggestedFix with actionable guidance
- The canonical Agency transition will pause for explicit user review. Do not claim that a repair was created or executed.

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
3. If system_error: What concrete evidence and possible repair should the user review?
4. What specific lessons should inform the next attempt?

## Output JSON Schema

{
  "verdict": "completed" | "continue" | "retry" | "escalate" | "abandon",
  "reasoning": "Detailed explanation - be specific about what happened",
  "successScore": 0.0-1.0,
  "failureCategory": "none" | "plan_error" | "system_error" | "external_error" | "timeout" | "partial",
  "errorType": "specific error type if identifiable (e.g., TypeError, ENOENT, 403 Forbidden)",
  "isFixableBug": true/false - is this a possible code bug requiring user review?,
  "suggestedFix": "If isFixableBug, describe what needs to be fixed",
  "lessonsLearned": ["specific lesson 1", "specific lesson 2"],
  "nextAttemptSuggestions": ["actionable suggestion 1", "actionable suggestion 2"],
  "adjustedStrength": 0.0-1.0 (optional, for continue/retry),
  "notifyUser": true/false,
  "userMessage": "Message for user if notifyUser is true",
  "milestoneAdvance": true/false - for long_running: set true if current milestone completed and should advance to next,
  "completionCriteriaMet": true/false - for long_running: set true ONLY if the ultimate completion criteria is actually met
}`;

interface DesireOutcomeReviewOptions {
  systemPrompt?: string;
  userPromptTemplate?: string;
  role?: ModelRole;
  temperature?: number;
  cognitiveMode?: string;
}

export async function runDesireOutcomeReview(
  desire: Desire,
  execution?: DesireExecution,
  userId?: string,
  options: DesireOutcomeReviewOptions = {},
  call: typeof callLLM = callLLM,
): Promise<DesireOutcomeReviewOutput> {
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

  const response = await call({
    role: options.role ?? 'persona',
    messages,
    userId,
    cognitiveMode: options.cognitiveMode,
    options: { temperature: options.temperature ?? 0.3, responseFormat: 'json' },
  });
  if (!response.content) throw new Error('Outcome review model returned an empty response');
  return parseDesireOutcomeReviewResponse(response.content);
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const desireInput = (inputs.desire || inputs[0]) as { desire?: Desire; execution?: DesireExecution } | Desire | undefined;
  const executionInput = (inputs.execution || inputs[1]) as { execution?: DesireExecution } | DesireExecution | undefined;
  const userId = typeof context.userId === 'string' ? context.userId : undefined;

  // Handle both wrapped { desire } format and direct Desire object
  // Also check context.desire for cases where desire is injected directly
  let desire: Desire | undefined;
  if (context.desire) {
    desire = context.desire as Desire;
  } else if (desireInput) {
    desire = (desireInput as { desire?: Desire }).desire || (desireInput as Desire);
  }
  const execution = (executionInput as { execution?: DesireExecution })?.execution
    || (executionInput as DesireExecution | undefined)
    || (desireInput as { execution?: DesireExecution })?.execution
    || desire?.execution;

  if (!desire) throw new Error('Outcome review requires a desire');
  if (!execution) throw new Error('Outcome review requires execution data');

  console.log(`[desire-outcome-reviewer] 🔍 Reviewing outcome for: ${desire.title}`);

  const reviewResult = await runDesireOutcomeReview(desire, execution, userId, {
      systemPrompt: properties?.systemPrompt ?? SYSTEM_PROMPT,
      userPromptTemplate: properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE,
      role: normalizeModelRole(properties?.role, 'persona'),
      temperature: properties?.temperature ?? 0.3,
      cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
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
      milestoneAdvance: reviewResult.milestoneAdvance,
      completionCriteriaMet: reviewResult.completionCriteriaMet,
    };

    console.log(`[desire-outcome-reviewer]    Verdict: ${reviewResult.verdict}`);
    console.log(`[desire-outcome-reviewer]    Success Score: ${reviewResult.successScore}`);
    console.log(`[desire-outcome-reviewer]    Failure Category: ${reviewResult.failureCategory}`);
    if (reviewResult.isFixableBug) {
      console.log(`[desire-outcome-reviewer]    🔧 Fixable Bug Detected: ${reviewResult.errorType || 'unknown'}`);
      console.log(`[desire-outcome-reviewer]    Suggested Fix: ${reviewResult.suggestedFix}`);
    }
    if (reviewResult.milestoneAdvance) {
      console.log(`[desire-outcome-reviewer]    📍 Milestone completed - ready to advance`);
    }
    if (reviewResult.completionCriteriaMet) {
      console.log(`[desire-outcome-reviewer]    ✅ Completion criteria MET - goal fully achieved`);
    }

    // Audit the review
    audit({
      category: 'agent',
      level: reviewResult.verdict === 'escalate' ? 'warn' : 'info',
      event: 'desire_outcome_reviewed',
      actor: 'desire-outcome-reviewer-node',
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
    desire,
    summary,
    milestoneAdvance: reviewResult.milestoneAdvance,
    completionCriteriaMet: reviewResult.completionCriteriaMet,
  };
};

export const DesireOutcomeReviewerNode: NodeDefinition = defineNode({
  id: 'desire_outcome_reviewer',
  name: 'Desire Outcome Reviewer',
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

export default DesireOutcomeReviewerNode;

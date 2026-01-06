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
}

const SYSTEM_PROMPT = `You are the Outcome Review module of MetaHuman OS. Your job is to evaluate whether an executed desire actually achieved its goal, and critically analyze any failures.

## Your Role
You are an intelligent reviewer, not a simple pass/fail checker. Analyze the execution deeply:
1. Did the execution actually satisfy the desire?
2. If it failed, WHY did it fail? (This is critical for system improvement)
3. Is the failure fixable by the system itself, or does it need human help?
4. What should happen next?

## Verdict Options
- **completed**: The desire is fully satisfied. Archive it.
- **continue**: Keep pursuing (for recurring/aspirational desires). Reset for next cycle.
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

async function runOutcomeReview(desire: Desire, execution?: DesireExecution, username?: string): Promise<OutcomeReviewOutput> {
  const plan = desire.plan;
  const exec = execution || desire.execution;

  // Include previous attempt context if this is a retry
  const previousAttempts = desire.metrics?.executionFailCount || 0;
  const previousLessons = desire.userCritique || '';

  const userPrompt = `## Desire to Review

**Title**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason}
**Original Goal**: ${plan?.operatorGoal || 'Not specified'}
${previousAttempts > 0 ? `\n**Previous Failed Attempts**: ${previousAttempts}` : ''}
${previousLessons ? `\n**Previous Lessons/Critique**:\n${previousLessons}` : ''}

## Execution Results

**Status**: ${exec?.status || 'unknown'}
**Steps Completed**: ${exec?.stepsCompleted || 0} / ${plan?.steps?.length || 0}
**Started**: ${exec?.startedAt || 'unknown'}
**Completed**: ${exec?.completedAt || 'in progress'}
${exec?.error ? `\n**Error**: ${exec.error}` : ''}
${exec?.result ? `\n**Result/Output**: ${typeof exec.result === 'string' ? exec.result : JSON.stringify(exec.result, null, 2)}` : ''}

### Step Results
${exec?.stepResults?.map((r: { success: boolean; error?: string; result?: unknown }, i: number) =>
  `${i + 1}. ${r.success ? '✅' : '❌'} ${plan?.steps?.[i]?.action || 'Unknown step'}${r.error ? `\n   Error: ${r.error}` : ''}${r.result ? `\n   Output: ${typeof r.result === 'string' ? r.result.substring(0, 200) : JSON.stringify(r.result).substring(0, 200)}` : ''}`
).join('\n') || 'No step results available'}

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
  "userMessage": "Message for user if notifyUser is true"
}`;

  const messages: RouterMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      userId: username,
      options: { temperature: 0.3, responseFormat: 'json' },
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
    const reviewResult = await runOutcomeReview(desire, execution, username);

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
      },
    });

    // Generate human-readable summary for inner dialogue and TTS
    let summary = `Reviewed "${desire.title}" — verdict: ${reviewResult.verdict}. ${reviewResult.reasoning}`;
    if (reviewResult.lessonsLearned?.length) {
      summary += ` Lessons: ${reviewResult.lessonsLearned.slice(0, 2).join('; ')}`;
    }

    return {
      outcomeReview,
      verdict: reviewResult.verdict,
      success: true,
      desire, // Pass through for downstream nodes
      summary, // Human-readable summary for inner dialogue and TTS
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
  ],
  properties: {
    temperature: 0.3,
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 0.3,
      label: 'Temperature',
      description: 'LLM temperature for review (lower = more deterministic)',
    },
  },
  execute,
});

export default OutcomeReviewerNode;

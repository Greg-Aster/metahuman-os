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
import type { Desire, DesireExecution, DesireOutcomeReview, OutcomeVerdict } from '../../agency/types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { audit } from '../../audit.js';

interface OutcomeReviewOutput {
  verdict: OutcomeVerdict;
  reasoning: string;
  successScore: number;
  lessonsLearned: string[];
  nextAttemptSuggestions?: string[];
  adjustedStrength?: number;
  notifyUser: boolean;
  userMessage?: string;
}

const SYSTEM_PROMPT = `You are the Outcome Review module of MetaHuman OS. Your job is to evaluate whether an executed desire actually achieved its goal.

## Your Task
Analyze the execution results and determine:
1. Did the execution actually satisfy the desire?
2. What was learned from this attempt?
3. What should happen next?

## Verdict Options
- **completed**: The desire is fully satisfied. The goal was achieved. Archive it.
- **continue**: Keep pursuing this (for recurring desires like "stay healthy", "learn new things"). Reset for next cycle.
- **retry**: The execution failed or was incomplete. Try again with a new approach.
- **escalate**: Something unexpected happened that needs human attention. Alert the user.
- **abandon**: This desire cannot be achieved or is no longer relevant. Give up gracefully.

## Success Score (0.0 - 1.0)
- 1.0: Perfect execution, goal fully achieved
- 0.7-0.9: Good execution, goal mostly achieved
- 0.4-0.6: Partial success, some progress made
- 0.1-0.3: Poor execution, minimal progress
- 0.0: Complete failure

## Guidelines
- Be honest about whether the goal was actually achieved
- For recurring desires, "continue" is often appropriate even after success
- "escalate" should be used sparingly, only for genuine concerns
- Always provide actionable lessons learned
- If retry is recommended, give specific suggestions

Respond with valid JSON matching the schema.`;

async function runOutcomeReview(desire: Desire, execution?: DesireExecution): Promise<OutcomeReviewOutput> {
  const plan = desire.plan;
  const exec = execution || desire.execution;

  const userPrompt = `## Desire to Review

**Title**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason}
**Original Goal**: ${plan?.operatorGoal || 'Not specified'}

## Execution Results

**Status**: ${exec?.status || 'unknown'}
**Steps Completed**: ${exec?.stepsCompleted || 0} / ${plan?.steps?.length || 0}
**Started**: ${exec?.startedAt || 'unknown'}
**Completed**: ${exec?.completedAt || 'in progress'}
${exec?.error ? `**Error**: ${exec.error}` : ''}

### Step Results
${exec?.stepResults?.map((r: { success: boolean; error?: string }, i: number) =>
  `${i + 1}. ${r.success ? '✅' : '❌'} ${plan?.steps?.[i]?.action || 'Unknown step'}${r.error ? ` (Error: ${r.error})` : ''}`
).join('\n') || 'No step results available'}

## Output

Respond with JSON:
{
  "verdict": "completed" | "continue" | "retry" | "escalate" | "abandon",
  "reasoning": "Detailed explanation of your verdict",
  "successScore": 0.0-1.0,
  "lessonsLearned": ["lesson 1", "lesson 2"],
  "nextAttemptSuggestions": ["suggestion 1", "suggestion 2"],
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
      options: { temperature: 0.3, responseFormat: 'json' },
    });

    if (!response.content) {
      return {
        verdict: 'escalate',
        reasoning: 'Failed to get outcome review response',
        successScore: 0,
        lessonsLearned: ['Outcome review failed - manual review needed'],
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
      lessonsLearned: ['Outcome review threw an error'],
      notifyUser: true,
      userMessage: `Outcome review failed: ${(error as Error).message}`,
    };
  }
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Inputs from graph:
  // slot 0: desire from desire_loader or executor output
  // slot 1: execution results from desire_executor (optional, may be on desire)
  const slot0 = inputs[0] as { desire?: Desire; execution?: DesireExecution } | undefined;
  const slot1 = inputs[1] as { execution?: DesireExecution } | undefined;

  const desire = slot0?.desire;
  const execution = slot1?.execution || slot0?.execution || desire?.execution;

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
    const reviewResult = await runOutcomeReview(desire, execution);

    const outcomeReview: DesireOutcomeReview = {
      id: `outcome-${desire.id}-${Date.now()}`,
      verdict: reviewResult.verdict,
      reasoning: reviewResult.reasoning,
      successScore: reviewResult.successScore,
      lessonsLearned: reviewResult.lessonsLearned,
      nextAttemptSuggestions: reviewResult.nextAttemptSuggestions,
      adjustedStrength: reviewResult.adjustedStrength,
      reviewedAt: new Date().toISOString(),
      notifyUser: reviewResult.notifyUser,
      userMessage: reviewResult.userMessage,
    };

    console.log(`[outcome-reviewer]    Verdict: ${reviewResult.verdict}`);
    console.log(`[outcome-reviewer]    Success Score: ${reviewResult.successScore}`);

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
        notifyUser: reviewResult.notifyUser,
      },
    });

    return {
      outcomeReview,
      verdict: reviewResult.verdict,
      success: true,
      desire, // Pass through for downstream nodes
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

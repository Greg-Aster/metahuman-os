import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit, captureEvent } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import {
  loadDesire,
  saveDesire,
  moveDesire,
  addScratchpadEntryToFolder,
  type Desire,
  type DesireOutcomeReview,
  type OutcomeVerdict,
} from '@metahuman/core';
import { callLLM, type RouterMessage } from '@metahuman/core/model-router';
import { loadOperatorConfig } from '@metahuman/core/config';
import { isClaudeSessionReady, sendPrompt, startClaudeSession } from '@metahuman/core/claude-session';

const LOG_PREFIX = '[API:agency/outcome-review]';

// Server-side API base URL for internal calls
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4321';

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

interface VerificationResult {
  verified: boolean;
  evidence: string[];
  errors: string[];
  operatorResponse?: unknown;
}

/**
 * Use Claude CLI to VERIFY outcomes before trusting self-reported success.
 * This is critical - the executor might claim success without actually doing anything!
 *
 * When Big Brother delegateAll is enabled, uses Claude CLI directly.
 * Otherwise falls back to operator API.
 */
async function verifyOutcomeWithOperator(
  desire: Desire,
  cookieHeader?: string
): Promise<VerificationResult> {
  const plan = desire.plan;
  const evidence: string[] = [];
  const errors: string[] = [];

  // Check if Big Brother delegation mode is enabled
  const operatorConfig = loadOperatorConfig();
  const bigBrotherEnabled = operatorConfig.bigBrotherMode?.enabled === true;
  const delegateAll = operatorConfig.bigBrotherMode?.delegateAll === true;

  // Build verification goal based on what the plan was supposed to do
  const operatorGoal = plan?.operatorGoal || desire.description;

  // Determine what type of verification we need
  const goalLower = operatorGoal.toLowerCase();
  let verificationPrompt = '';

  if (goalLower.includes('file') || goalLower.includes('write') || goalLower.includes('create')) {
    // File operation - verify files exist
    const filePaths: string[] = [];
    plan?.steps?.forEach(step => {
      if (step.inputs?.path) filePaths.push(step.inputs.path as string);
      if (step.inputs?.file_path) filePaths.push(step.inputs.file_path as string);
      const pathMatch = step.action.match(/["']([^"']+\.[a-z]+)["']/i);
      if (pathMatch) filePaths.push(pathMatch[1]);
    });

    if (filePaths.length > 0) {
      verificationPrompt = `VERIFICATION TASK: Check if these files exist and have content: ${filePaths.join(', ')}. Read each file to verify it exists and has appropriate content.`;
    } else {
      verificationPrompt = `VERIFICATION TASK: The goal was "${operatorGoal}". Check the filesystem to see if any relevant files were created. List the directory contents and read any new files.`;
    }
  } else if (goalLower.includes('task')) {
    verificationPrompt = `VERIFICATION TASK: Check if any tasks were created or updated related to "${operatorGoal}". List current tasks and check for relevant entries.`;
  } else {
    verificationPrompt = `VERIFICATION TASK: The desire "${desire.title}" claims to be completed. The goal was: "${operatorGoal}". Investigate whether the outcome actually occurred. Check files, tasks, or other artifacts that should exist. Report your findings.`;
  }

  console.log(`${LOG_PREFIX} 🔍 Running verification...`);

  // =========================================================================
  // BIG BROTHER MODE: Use Claude CLI directly for verification
  // =========================================================================
  if (bigBrotherEnabled && delegateAll) {
    console.log(`${LOG_PREFIX}    🤖 Using Claude CLI for verification`);

    try {
      // Ensure Claude session is ready
      if (!isClaudeSessionReady()) {
        console.log(`${LOG_PREFIX}    ⏳ Starting Claude session...`);
        const started = await startClaudeSession();
        if (!started) {
          errors.push('Failed to start Claude CLI session for verification');
          return { verified: false, evidence, errors };
        }
      }

      const prompt = `You are verifying whether a task was actually completed for MetaHuman OS.

## Desire Being Verified
**Title**: ${desire.title}
**Description**: ${desire.description}
**Original Goal**: ${operatorGoal}
**Execution Status**: ${desire.execution?.status || 'unknown'}
**Steps Claimed Completed**: ${desire.execution?.stepsCompleted || 0} / ${plan?.steps?.length || 0}

## Verification Task
${verificationPrompt}

## Instructions
1. Use your tools (Read, Bash, Glob, etc.) to check if the outcome actually occurred
2. Look for concrete evidence (files exist, content is correct, tasks were created)
3. Be thorough - don't trust self-reported success
4. Report EXACTLY what you found - exists/doesn't exist, content summary

Please verify now and report your findings.`;

      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_verification_started',
        actor: 'outcome-review',
        details: {
          desireId: desire.id,
          title: desire.title,
        },
      });

      const response = await sendPrompt(prompt, 90000); // 90 second timeout

      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_verification_completed',
        actor: 'outcome-review',
        details: {
          desireId: desire.id,
          responseLength: response.length,
        },
      });

      console.log(`${LOG_PREFIX}    ✅ Claude CLI verification completed`);

      // Parse Claude's response to determine verification status
      const responseLower = response.toLowerCase();
      const hasPositiveIndicators = responseLower.includes('exists') ||
        responseLower.includes('found') ||
        responseLower.includes('confirmed') ||
        responseLower.includes('successfully') ||
        responseLower.includes('content:') ||
        responseLower.includes('verified');
      const hasNegativeIndicators = responseLower.includes('not found') ||
        responseLower.includes('does not exist') ||
        responseLower.includes('no such file') ||
        responseLower.includes('failed') ||
        responseLower.includes('error:') ||
        responseLower.includes('could not');

      evidence.push(`Claude CLI verification: ${response.substring(0, 500)}${response.length > 500 ? '...' : ''}`);

      // Determine verification status
      const verified = hasPositiveIndicators && !hasNegativeIndicators;

      return {
        verified,
        evidence,
        errors,
        operatorResponse: { claudeResponse: response, executedVia: 'claude-cli' }
      };
    } catch (error) {
      console.log(`${LOG_PREFIX}    ❌ Claude CLI verification error: ${(error as Error).message}`);
      errors.push(`Claude CLI verification failed: ${(error as Error).message}`);
      return { verified: false, evidence, errors };
    }
  }

  // =========================================================================
  // FALLBACK: Use operator API (local skills)
  // =========================================================================
  console.log(`${LOG_PREFIX}    📡 Routing verification to operator API...`);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const response = await fetch(`${API_BASE_URL}/api/operator`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        goal: verificationPrompt,
        context: `Verifying outcome of desire: ${desire.title}\nOriginal goal: ${operatorGoal}\nExecution status: ${desire.execution?.status}`,
        autoApprove: true,
        allowMemoryWrites: false,
        mode: 'strict',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      errors.push(`Verification API error: ${response.status} - ${errorText}`);
      return { verified: false, evidence, errors };
    }

    const operatorResult = await response.json();

    if (operatorResult.success && operatorResult.result) {
      evidence.push(`Operator verification: ${operatorResult.result}`);

      if (operatorResult.scratchpad) {
        const actionSkills = operatorResult.scratchpad.filter(
          (s: { action: string }) => !['conversational_response', 'think', 'plan'].includes(s.action)
        );
        if (actionSkills.length > 0) {
          evidence.push(`Skills used: ${actionSkills.map((s: { action: string }) => s.action).join(', ')}`);
        }
      }

      return {
        verified: true,
        evidence,
        errors,
        operatorResponse: operatorResult
      };
    } else {
      errors.push(`Verification failed: ${operatorResult.error?.message || 'Unknown error'}`);
      return {
        verified: false,
        evidence,
        errors,
        operatorResponse: operatorResult
      };
    }
  } catch (error) {
    errors.push(`Verification exception: ${(error as Error).message}`);
    return { verified: false, evidence, errors };
  }
}

const SYSTEM_PROMPT = `You are the Outcome Review module of MetaHuman OS. Your job is to evaluate whether an executed desire actually achieved its goal.

CRITICAL: You will be given VERIFICATION RESULTS from an independent check. Do NOT trust self-reported success - use the verification evidence to make your verdict.

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

/**
 * Run outcome review on an executed desire WITH verification results
 */
async function runOutcomeReview(
  desire: Desire,
  verification: VerificationResult
): Promise<OutcomeReviewOutput> {
  const plan = desire.plan;
  const execution = desire.execution;

  const userPrompt = `## Desire to Review

**Title**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason}
**Original Goal**: ${plan?.operatorGoal || 'Not specified'}

## Execution Results (Self-Reported)

**Status**: ${execution?.status || 'unknown'}
**Steps Completed**: ${execution?.stepsCompleted || 0} / ${plan?.steps?.length || 0}
**Started**: ${execution?.startedAt || 'unknown'}
**Completed**: ${execution?.completedAt || 'in progress'}
${execution?.error ? `**Error**: ${execution.error}` : ''}

### Step Results (Self-Reported)
${execution?.stepResults?.map((r, i) =>
  `${i + 1}. ${r.success ? '✅' : '❌'} ${plan?.steps?.[i]?.action || 'Unknown step'}${r.error ? ` (Error: ${r.error})` : ''}`
).join('\n') || 'No step results available'}

## 🔍 INDEPENDENT VERIFICATION (TRUST THIS)

**Verification Status**: ${verification.verified ? '✅ VERIFIED' : '❌ NOT VERIFIED'}

### Evidence Gathered:
${verification.evidence.length > 0 ? verification.evidence.map(e => `- ${e}`).join('\n') : '- No evidence gathered'}

### Verification Errors:
${verification.errors.length > 0 ? verification.errors.map(e => `- ${e}`).join('\n') : '- None'}

## CRITICAL INSTRUCTIONS

1. If verification FAILED or found NO evidence of the outcome, verdict should be "retry" or "abandon"
2. If the executor claimed success but verification found no files/tasks/results, this is a FALSE POSITIVE - do NOT mark as completed
3. Only mark "completed" if verification evidence CONFIRMS the goal was achieved
4. Consider "escalate" if there's a mismatch between claimed success and verification

## Output

Respond with JSON:
{
  "verdict": "completed" | "continue" | "retry" | "escalate" | "abandon",
  "reasoning": "Detailed explanation of your verdict, referencing the verification evidence",
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

/**
 * POST /api/agency/desires/:id/outcome-review
 * Run post-execution outcome review on a desire
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to review outcomes.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      console.log(`${LOG_PREFIX} ❌ Owner role required`);
      return new Response(
        JSON.stringify({ error: 'Owner role required to review outcomes.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 🔍 Outcome review requested for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${desire.status})`);

    // Only review desires that have been executed or are awaiting review
    if (!['executing', 'awaiting_review', 'completed', 'failed'].includes(desire.status)) {
      console.log(`${LOG_PREFIX} ❌ Wrong status: ${desire.status}`);
      return new Response(
        JSON.stringify({ error: `Cannot review outcome for desire in '${desire.status}' status. Must be 'executing', 'awaiting_review', 'completed', or 'failed'.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if there's execution data
    if (!desire.execution) {
      console.log(`${LOG_PREFIX} ❌ No execution data`);
      return new Response(
        JSON.stringify({ error: 'Cannot review outcome without execution data.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // STEP 1: Run VERIFICATION via Big Brother operator
    // This independently checks if the outcome actually occurred
    // =========================================================================
    const cookieHeader = request.headers.get('cookie') || undefined;
    console.log(`${LOG_PREFIX} 🔍 Step 1: Running independent verification...`);
    const verification = await verifyOutcomeWithOperator(desire, cookieHeader);

    console.log(`${LOG_PREFIX}    Verification: ${verification.verified ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
    if (verification.evidence.length > 0) {
      console.log(`${LOG_PREFIX}    Evidence: ${verification.evidence.length} items`);
    }
    if (verification.errors.length > 0) {
      console.log(`${LOG_PREFIX}    Verification errors: ${verification.errors.join(', ')}`);
    }

    // =========================================================================
    // STEP 2: Run LLM-based outcome review WITH verification results
    // =========================================================================
    console.log(`${LOG_PREFIX} 🤖 Step 2: Running LLM outcome review with verification data...`);
    const reviewResult = await runOutcomeReview(desire, verification);

    console.log(`${LOG_PREFIX}    Verdict: ${reviewResult.verdict}`);
    console.log(`${LOG_PREFIX}    Success Score: ${reviewResult.successScore}`);
    console.log(`${LOG_PREFIX}    Notify User: ${reviewResult.notifyUser}`);

    // Create the outcome review object
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

    // Determine new status based on verdict
    const now = new Date().toISOString();
    const oldStatus = desire.status;
    let newStatus: Desire['status'] = desire.status;

    switch (reviewResult.verdict) {
      case 'completed':
        newStatus = 'completed';
        console.log(`${LOG_PREFIX} ✅ Marking as completed`);
        break;
      case 'continue':
        // For recurring desires, reset to planning for next cycle
        newStatus = 'planning';
        console.log(`${LOG_PREFIX} 🔄 Continuing - moving back to planning`);
        break;
      case 'retry':
        newStatus = 'planning';
        console.log(`${LOG_PREFIX} 🔁 Retry - moving back to planning`);
        break;
      case 'escalate':
        newStatus = 'awaiting_approval';
        console.log(`${LOG_PREFIX} ⚠️ Escalating - needs user attention`);
        break;
      case 'abandon':
        newStatus = 'abandoned';
        console.log(`${LOG_PREFIX} 🚫 Abandoning desire`);
        break;
    }

    // Update the desire
    const updatedDesire: Desire = {
      ...desire,
      outcomeReview,
      status: newStatus,
      updatedAt: now,
      // Adjust strength if specified
      strength: reviewResult.adjustedStrength ?? desire.strength,
      // Update metrics
      metrics: desire.metrics ? {
        ...desire.metrics,
        executionSuccessCount: reviewResult.verdict === 'completed'
          ? desire.metrics.executionSuccessCount + 1
          : desire.metrics.executionSuccessCount,
        executionFailCount: ['retry', 'abandon'].includes(reviewResult.verdict)
          ? desire.metrics.executionFailCount + 1
          : desire.metrics.executionFailCount,
        completionCount: reviewResult.verdict === 'completed'
          ? desire.metrics.completionCount + 1
          : desire.metrics.completionCount,
        cycleCount: ['continue', 'retry'].includes(reviewResult.verdict)
          ? desire.metrics.cycleCount + 1
          : desire.metrics.cycleCount,
        avgSuccessScore: (desire.metrics.avgSuccessScore * desire.metrics.executionAttemptCount + reviewResult.successScore)
          / (desire.metrics.executionAttemptCount + 1),
      } : undefined,
    };

    // Move desire if status changed
    if (oldStatus !== newStatus) {
      console.log(`${LOG_PREFIX} 📦 Moving ${oldStatus} → ${newStatus}`);
      await moveDesire(updatedDesire, oldStatus, newStatus, user.username);
    } else {
      await saveDesire(updatedDesire, user.username);
    }

    // Add scratchpad entry for outcome review with verification data
    await addScratchpadEntryToFolder(id!, {
      timestamp: now,
      type: 'outcome_review',
      description: `Outcome review: ${reviewResult.verdict} (score: ${(reviewResult.successScore * 100).toFixed(0)}%) - Verification: ${verification.verified ? 'VERIFIED' : 'NOT VERIFIED'}`,
      actor: 'llm',
      data: {
        verdict: reviewResult.verdict,
        reasoning: reviewResult.reasoning,
        successScore: reviewResult.successScore,
        lessonsLearned: reviewResult.lessonsLearned,
        nextAttemptSuggestions: reviewResult.nextAttemptSuggestions,
        notifyUser: reviewResult.notifyUser,
        userMessage: reviewResult.userMessage,
        newStatus,
        // Include verification results
        verification: {
          verified: verification.verified,
          evidence: verification.evidence,
          errors: verification.errors,
        },
      },
    }, user.username);

    // Audit the outcome review
    audit({
      category: 'agent',
      level: reviewResult.verdict === 'escalate' ? 'warn' : 'info',
      event: 'desire_outcome_reviewed',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        verdict: reviewResult.verdict,
        successScore: reviewResult.successScore,
        oldStatus,
        newStatus,
        notifyUser: reviewResult.notifyUser,
        // Include verification summary
        verificationPassed: verification.verified,
        verificationEvidenceCount: verification.evidence.length,
        verificationErrorCount: verification.errors.length,
      },
    });

    // Log to inner dialogue
    let dialogueText: string;
    switch (reviewResult.verdict) {
      case 'completed':
        dialogueText = `I've completed my desire "${desire.title}"! ${reviewResult.reasoning}`;
        break;
      case 'continue':
        dialogueText = `My desire "${desire.title}" is ongoing. ${reviewResult.reasoning} I'll continue pursuing it.`;
        break;
      case 'retry':
        dialogueText = `I need to retry "${desire.title}". ${reviewResult.reasoning}`;
        break;
      case 'escalate':
        dialogueText = `I need help with "${desire.title}". ${reviewResult.userMessage || reviewResult.reasoning}`;
        break;
      case 'abandon':
        dialogueText = `I'm letting go of "${desire.title}". ${reviewResult.reasoning}`;
        break;
    }

    await captureEvent(dialogueText, {
      type: 'inner_dialogue',
      source: 'outcome-reviewer',
      metadata: {
        desireId: id,
        verdict: reviewResult.verdict,
        successScore: reviewResult.successScore,
        tags: ['agency', 'outcome', 'review', 'inner'],
      },
    });

    // Build response message
    const verificationStatus = verification.verified ? '✅ Verified' : '⚠️ Not Verified';
    let message: string;
    switch (reviewResult.verdict) {
      case 'completed':
        message = `🎉 Success! "${desire.title}" has been completed. Score: ${(reviewResult.successScore * 100).toFixed(0)}% [${verificationStatus}]`;
        break;
      case 'continue':
        message = `🔄 "${desire.title}" will continue. Moving back to planning for next cycle. [${verificationStatus}]`;
        break;
      case 'retry':
        message = `🔁 "${desire.title}" needs another attempt. Moving back to planning. [${verificationStatus}]`;
        break;
      case 'escalate':
        message = `⚠️ "${desire.title}" needs your attention: ${reviewResult.userMessage || reviewResult.reasoning} [${verificationStatus}]`;
        break;
      case 'abandon':
        message = `🚫 "${desire.title}" has been abandoned. ${reviewResult.reasoning} [${verificationStatus}]`;
        break;
    }

    console.log(`${LOG_PREFIX} ✅ Outcome review complete: ${reviewResult.verdict} (verification: ${verification.verified})`);

    return new Response(JSON.stringify({
      success: true,
      desire: updatedDesire,
      outcomeReview,
      message,
      // Include verification results in response
      verification: {
        verified: verification.verified,
        evidence: verification.evidence,
        errors: verification.errors,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

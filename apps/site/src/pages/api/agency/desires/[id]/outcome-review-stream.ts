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

const LOG_PREFIX = '[API:agency/outcome-review-stream]';
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

interface StreamEvent {
  type: 'phase' | 'progress' | 'log' | 'result' | 'error' | 'done';
  phase?: string;
  message?: string;
  data?: unknown;
}

function sendSSE(controller: ReadableStreamDefaultController, event: StreamEvent) {
  const data = JSON.stringify(event);
  controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
}

/**
 * GET /api/agency/desires/:id/outcome-review-stream
 * Streaming version of outcome review with progress updates via SSE
 */
export const GET: APIRoute = async ({ params, cookies, request }) => {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Auth check
        const user = getAuthenticatedUser(cookies);
        if (!user) {
          sendSSE(controller, { type: 'error', message: 'Authentication required' });
          controller.close();
          return;
        }

        const policy = getSecurityPolicy({ cookies });
        try {
          policy.requireOwner();
        } catch {
          sendSSE(controller, { type: 'error', message: 'Owner role required' });
          controller.close();
          return;
        }

        const { id } = params;
        if (!id) {
          sendSSE(controller, { type: 'error', message: 'Desire ID is required' });
          controller.close();
          return;
        }

        sendSSE(controller, { type: 'phase', phase: 'Loading desire...' });
        sendSSE(controller, { type: 'log', message: `Loading desire: ${id}` });

        const desire = await loadDesire(id, user.username);
        if (!desire) {
          sendSSE(controller, { type: 'error', message: `Desire not found: ${id}` });
          controller.close();
          return;
        }

        sendSSE(controller, { type: 'log', message: `Found: "${desire.title}" (status: ${desire.status})` });

        // Validate status
        if (!['executing', 'awaiting_review', 'completed', 'failed'].includes(desire.status)) {
          sendSSE(controller, { type: 'error', message: `Cannot review desire in '${desire.status}' status` });
          controller.close();
          return;
        }

        if (!desire.execution) {
          sendSSE(controller, { type: 'error', message: 'No execution data available' });
          controller.close();
          return;
        }

        // =========================================================================
        // STEP 1: Verification
        // =========================================================================
        sendSSE(controller, { type: 'phase', phase: '🔍 Running verification...' });
        sendSSE(controller, { type: 'log', message: 'Checking Big Brother configuration...' });

        const operatorConfig = loadOperatorConfig();
        const bigBrotherEnabled = operatorConfig.bigBrotherMode?.enabled === true;
        const delegateAll = operatorConfig.bigBrotherMode?.delegateAll === true;

        const plan = desire.plan;
        const operatorGoal = plan?.operatorGoal || desire.description;
        const goalLower = operatorGoal.toLowerCase();

        let verificationPrompt = '';
        if (goalLower.includes('file') || goalLower.includes('write') || goalLower.includes('create')) {
          const filePaths: string[] = [];
          plan?.steps?.forEach(step => {
            if (step.inputs?.path) filePaths.push(step.inputs.path as string);
            if (step.inputs?.file_path) filePaths.push(step.inputs.file_path as string);
            const pathMatch = step.action.match(/["']([^"']+\.[a-z]+)["']/i);
            if (pathMatch) filePaths.push(pathMatch[1]);
          });
          verificationPrompt = filePaths.length > 0
            ? `VERIFICATION TASK: Check if these files exist and have content: ${filePaths.join(', ')}. Read each file to verify it exists and has appropriate content.`
            : `VERIFICATION TASK: The goal was "${operatorGoal}". Check the filesystem to see if any relevant files were created.`;
        } else if (goalLower.includes('task')) {
          verificationPrompt = `VERIFICATION TASK: Check if any tasks were created or updated related to "${operatorGoal}".`;
        } else {
          verificationPrompt = `VERIFICATION TASK: The desire "${desire.title}" claims to be completed. The goal was: "${operatorGoal}". Investigate whether the outcome actually occurred.`;
        }

        let verification: VerificationResult = { verified: false, evidence: [], errors: [] };

        if (bigBrotherEnabled && delegateAll) {
          sendSSE(controller, { type: 'log', message: '🤖 Using Claude CLI for verification' });

          if (!isClaudeSessionReady()) {
            sendSSE(controller, { type: 'log', message: '⏳ Starting Claude session...' });
            const started = await startClaudeSession();
            if (!started) {
              verification.errors.push('Failed to start Claude CLI session');
              sendSSE(controller, { type: 'log', message: '❌ Failed to start Claude session' });
            }
          }

          if (verification.errors.length === 0) {
            try {
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
4. Report EXACTLY what you found

Please verify now and report your findings.`;

              sendSSE(controller, { type: 'log', message: 'Sending prompt to Claude CLI...' });
              const response = await sendPrompt(prompt, 90000);
              sendSSE(controller, { type: 'log', message: `Claude response received (${response.length} chars)` });

              const responseLower = response.toLowerCase();
              const hasPositiveIndicators = responseLower.includes('exists') ||
                responseLower.includes('found') ||
                responseLower.includes('confirmed') ||
                responseLower.includes('successfully') ||
                responseLower.includes('verified');
              const hasNegativeIndicators = responseLower.includes('not found') ||
                responseLower.includes('does not exist') ||
                responseLower.includes('no such file') ||
                responseLower.includes('failed');

              verification.evidence.push(`Claude CLI verification: ${response.substring(0, 500)}${response.length > 500 ? '...' : ''}`);
              verification.verified = hasPositiveIndicators && !hasNegativeIndicators;

              sendSSE(controller, { type: 'log', message: verification.verified ? '✅ Verification passed' : '❌ Verification failed' });
            } catch (error) {
              verification.errors.push(`Claude CLI error: ${(error as Error).message}`);
              sendSSE(controller, { type: 'log', message: `❌ Error: ${(error as Error).message}` });
            }
          }
        } else {
          sendSSE(controller, { type: 'log', message: '📡 Using operator API for verification' });

          try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            const cookieHeader = request.headers.get('cookie');
            if (cookieHeader) headers['Cookie'] = cookieHeader;

            const response = await fetch(`${API_BASE_URL}/api/operator`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                goal: verificationPrompt,
                context: `Verifying outcome of desire: ${desire.title}`,
                autoApprove: true,
                allowMemoryWrites: false,
                mode: 'strict',
              }),
            });

            if (response.ok) {
              const operatorResult = await response.json();
              if (operatorResult.success && operatorResult.result) {
                verification.evidence.push(`Operator verification: ${operatorResult.result}`);
                verification.verified = true;
                sendSSE(controller, { type: 'log', message: '✅ Operator verification passed' });
              } else {
                verification.errors.push(`Verification failed: ${operatorResult.error?.message || 'Unknown'}`);
                sendSSE(controller, { type: 'log', message: '❌ Operator verification failed' });
              }
            } else {
              verification.errors.push(`API error: ${response.status}`);
              sendSSE(controller, { type: 'log', message: `❌ API error: ${response.status}` });
            }
          } catch (error) {
            verification.errors.push(`Exception: ${(error as Error).message}`);
            sendSSE(controller, { type: 'log', message: `❌ Error: ${(error as Error).message}` });
          }
        }

        // =========================================================================
        // STEP 2: LLM Outcome Review
        // =========================================================================
        sendSSE(controller, { type: 'phase', phase: '🤖 Analyzing results...' });
        sendSSE(controller, { type: 'log', message: 'Preparing LLM prompt for verdict assessment...' });

        const execution = desire.execution;
        const SYSTEM_PROMPT = `You are the Outcome Review module of MetaHuman OS. Your job is to evaluate whether an executed desire actually achieved its goal.

CRITICAL: You will be given VERIFICATION RESULTS from an independent check. Do NOT trust self-reported success - use the verification evidence to make your verdict.

## Verdict Options
- **completed**: The desire is fully satisfied. Archive it.
- **continue**: Keep pursuing this (for recurring desires). Reset for next cycle.
- **retry**: The execution failed or was incomplete. Try again.
- **escalate**: Something unexpected happened. Alert the user.
- **abandon**: This desire cannot be achieved. Give up gracefully.

Respond with valid JSON.`;

        const userPrompt = `## Desire to Review

**Title**: ${desire.title}
**Description**: ${desire.description}
**Original Goal**: ${plan?.operatorGoal || 'Not specified'}

## Execution Results (Self-Reported)
**Status**: ${execution?.status || 'unknown'}
**Steps Completed**: ${execution?.stepsCompleted || 0} / ${plan?.steps?.length || 0}

## 🔍 INDEPENDENT VERIFICATION
**Verification Status**: ${verification.verified ? '✅ VERIFIED' : '❌ NOT VERIFIED'}
${verification.evidence.length > 0 ? `Evidence: ${verification.evidence.join('; ')}` : ''}
${verification.errors.length > 0 ? `Errors: ${verification.errors.join('; ')}` : ''}

## Output
Respond with JSON: { "verdict": "completed"|"continue"|"retry"|"escalate"|"abandon", "reasoning": "...", "successScore": 0.0-1.0, "lessonsLearned": [], "notifyUser": false }`;

        const messages: RouterMessage[] = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ];

        sendSSE(controller, { type: 'log', message: 'Calling LLM for verdict...' });

        let reviewResult: OutcomeReviewOutput;
        try {
          const response = await callLLM({
            role: 'persona',
            messages,
            options: { temperature: 0.3, responseFormat: 'json' },
          });

          if (!response.content) throw new Error('Empty LLM response');

          const jsonMatch = response.content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('Could not parse response');

          const parsed = JSON.parse(jsonMatch[0]) as OutcomeReviewOutput;
          reviewResult = {
            verdict: parsed.verdict,
            reasoning: parsed.reasoning,
            successScore: Math.max(0, Math.min(1, parsed.successScore)),
            lessonsLearned: parsed.lessonsLearned || [],
            nextAttemptSuggestions: parsed.nextAttemptSuggestions,
            adjustedStrength: parsed.adjustedStrength,
            notifyUser: parsed.notifyUser ?? false,
            userMessage: parsed.userMessage,
          };

          sendSSE(controller, { type: 'log', message: `Verdict: ${reviewResult.verdict} (score: ${(reviewResult.successScore * 100).toFixed(0)}%)` });
        } catch (error) {
          reviewResult = {
            verdict: 'escalate',
            reasoning: `Error: ${(error as Error).message}`,
            successScore: 0,
            lessonsLearned: ['Review failed'],
            notifyUser: true,
            userMessage: 'Review failed - manual check needed',
          };
          sendSSE(controller, { type: 'log', message: `❌ LLM error: ${(error as Error).message}` });
        }

        // =========================================================================
        // STEP 3: Update Desire
        // =========================================================================
        sendSSE(controller, { type: 'phase', phase: '📝 Updating desire...' });

        const now = new Date().toISOString();
        const oldStatus = desire.status;
        let newStatus: Desire['status'] = desire.status;

        switch (reviewResult.verdict) {
          case 'completed': newStatus = 'completed'; break;
          case 'continue': newStatus = 'planning'; break;
          case 'retry': newStatus = 'planning'; break;
          case 'escalate': newStatus = 'awaiting_approval'; break;
          case 'abandon': newStatus = 'abandoned'; break;
        }

        sendSSE(controller, { type: 'log', message: `Status: ${oldStatus} → ${newStatus}` });

        const outcomeReview: DesireOutcomeReview = {
          id: `outcome-${desire.id}-${Date.now()}`,
          verdict: reviewResult.verdict,
          reasoning: reviewResult.reasoning,
          successScore: reviewResult.successScore,
          lessonsLearned: reviewResult.lessonsLearned,
          nextAttemptSuggestions: reviewResult.nextAttemptSuggestions,
          adjustedStrength: reviewResult.adjustedStrength,
          reviewedAt: now,
          notifyUser: reviewResult.notifyUser,
          userMessage: reviewResult.userMessage,
        };

        const updatedDesire: Desire = {
          ...desire,
          outcomeReview,
          status: newStatus,
          updatedAt: now,
          strength: reviewResult.adjustedStrength ?? desire.strength,
        };

        if (oldStatus !== newStatus) {
          await moveDesire(updatedDesire, oldStatus, newStatus, user.username);
        } else {
          await saveDesire(updatedDesire, user.username);
        }

        await addScratchpadEntryToFolder(id, {
          timestamp: now,
          type: 'outcome_review',
          description: `Outcome review: ${reviewResult.verdict} (score: ${(reviewResult.successScore * 100).toFixed(0)}%)`,
          actor: 'llm',
          data: { verdict: reviewResult.verdict, verification: { verified: verification.verified } },
        }, user.username);

        audit({
          category: 'agent',
          level: reviewResult.verdict === 'escalate' ? 'warn' : 'info',
          event: 'desire_outcome_reviewed',
          actor: user.username,
          details: { desireId: id, verdict: reviewResult.verdict, newStatus },
        });

        captureEvent(`Reviewed "${desire.title}": ${reviewResult.verdict}`, {
          type: 'inner_dialogue',
          metadata: { source: 'outcome-reviewer', desireId: id, verdict: reviewResult.verdict },
        });

        sendSSE(controller, { type: 'log', message: '✅ Review complete!' });

        // Send final result
        const verificationStatus = verification.verified ? '✅ Verified' : '⚠️ Not Verified';
        let message: string;
        switch (reviewResult.verdict) {
          case 'completed': message = `🎉 "${desire.title}" completed! Score: ${(reviewResult.successScore * 100).toFixed(0)}% [${verificationStatus}]`; break;
          case 'continue': message = `🔄 "${desire.title}" will continue. [${verificationStatus}]`; break;
          case 'retry': message = `🔁 "${desire.title}" needs retry. [${verificationStatus}]`; break;
          case 'escalate': message = `⚠️ "${desire.title}" needs attention. [${verificationStatus}]`; break;
          case 'abandon': message = `🚫 "${desire.title}" abandoned. [${verificationStatus}]`; break;
        }

        sendSSE(controller, {
          type: 'result',
          data: {
            success: true,
            desire: updatedDesire,
            outcomeReview,
            message,
            verification: {
              verified: verification.verified,
              evidence: verification.evidence,
              errors: verification.errors,
            },
          },
        });

        sendSSE(controller, { type: 'done' });
        controller.close();

      } catch (error) {
        console.error(`${LOG_PREFIX} Stream error:`, error);
        sendSSE(controller, { type: 'error', message: (error as Error).message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};

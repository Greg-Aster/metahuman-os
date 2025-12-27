import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  audit,
  loadDesire,
  moveDesire,
  addScratchpadEntryToFolder,
  executeDesireViaGraph,
  type Desire,
  type DesireExecutionProgress,
} from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

const LOG_PREFIX = '[API:agency/run-stream]';

/**
 * POST /api/agency/desires/:id/run-stream
 * Execute a desire's plan with SSE streaming for real-time progress.
 * Streams step-by-step execution progress to the client.
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  const encoder = new TextEncoder();

  // Helper to send SSE events
  const createSender = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    return (event: string, data: any) => {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(payload));
    };
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = createSender(controller);
      const startTime = Date.now();

      try {
        // Phase 1: Authentication
        send('phase', { phase: 'authenticating', message: 'Checking authentication...' });

        const user = getAuthenticatedUser(cookies);
        if (!user) {
          send('error', { error: 'Authentication required to execute desires.' });
          controller.close();
          return;
        }

        // Check owner role
        const policy = getSecurityPolicy({ cookies });
        try {
          policy.requireOwner();
        } catch {
          send('error', { error: 'Owner role required to execute desires.' });
          controller.close();
          return;
        }

        const { id } = params;
        if (!id) {
          send('error', { error: 'Desire ID is required' });
          controller.close();
          return;
        }

        console.log(`${LOG_PREFIX} 🚀 Stream run requested for: ${id}`);

        // Phase 2: Load desire
        send('phase', { phase: 'loading', message: 'Loading desire...' });

        const desire = await loadDesire(id, user.username);
        if (!desire) {
          send('error', { error: 'Desire not found' });
          controller.close();
          return;
        }

        // Validate status
        if (!['approved', 'executing'].includes(desire.status)) {
          send('error', { error: `Cannot run desire in '${desire.status}' status. Must be 'approved' or 'executing'.` });
          controller.close();
          return;
        }

        // Validate plan
        if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
          send('error', { error: 'Cannot run desire without a plan. Generate a plan first.' });
          controller.close();
          return;
        }

        send('desire_loaded', {
          desireId: id,
          title: desire.title,
          totalSteps: desire.plan.steps.length,
          goal: desire.plan.operatorGoal,
        });

        // Phase 3: Move to executing status if needed
        const now = new Date().toISOString();
        let executingDesire: Desire = desire;

        if (desire.status === 'approved') {
          send('phase', { phase: 'preparing', message: 'Moving to executing status...' });

          executingDesire = {
            ...desire,
            status: 'executing',
            updatedAt: now,
            execution: {
              startedAt: now,
              status: 'in_progress',
              stepsCompleted: 0,
              stepsTotal: desire.plan?.steps?.length || 1,
            },
          };
          await moveDesire(executingDesire, 'approved', 'executing', user.username);
          console.log(`${LOG_PREFIX} ⚡ Moved to executing status`);
        }

        // Phase 4: Execute with progress streaming
        send('phase', { phase: 'executing', message: 'Starting execution...' });

        console.log(`${LOG_PREFIX} 🏃 Executing via graph pipeline with streaming...`);

        // Create progress callback that streams events
        const onProgress = (progress: DesireExecutionProgress) => {
          send('progress', {
            type: progress.type,
            stepNumber: progress.stepNumber,
            totalSteps: progress.totalSteps,
            action: progress.action,
            message: progress.message,
            timestamp: progress.timestamp,
            data: progress.data,
          });
        };

        // Execute with streaming progress
        const graphResult = await executeDesireViaGraph(executingDesire, user.username, onProgress);
        const execution = graphResult.execution;

        // Audit the execution
        audit({
          category: 'agent',
          level: graphResult.success ? 'info' : 'warn',
          event: 'desire_executed',
          actor: user.username,
          details: {
            desireId: id,
            title: desire.title,
            executionStatus: execution?.status || 'failed',
            stepsCompleted: execution?.stepsCompleted || 0,
            totalSteps: desire.plan?.steps.length || 0,
            error: graphResult.error,
            triggeredBy: 'api-stream',
            durationMs: Date.now() - startTime,
          },
        });

        // Phase 5: Move to awaiting_review status
        send('phase', { phase: 'finalizing', message: 'Updating desire status...' });

        const nowFinal = new Date().toISOString();
        const newStatus: Desire['status'] = 'awaiting_review';

        const finalDesire: Desire = {
          ...executingDesire,
          status: newStatus,
          currentStage: 'outcome_review',
          execution: execution || {
            startedAt: now,
            status: 'failed',
            error: graphResult.error || 'Execution failed',
          },
          updatedAt: nowFinal,
          ...(desire.metrics && {
            metrics: {
              ...desire.metrics,
              executionAttemptCount: desire.metrics.executionAttemptCount + 1,
              lastActivityAt: nowFinal,
            },
          }),
        };

        await moveDesire(finalDesire, 'executing', newStatus, user.username);

        // Add scratchpad entry
        await addScratchpadEntryToFolder(id, {
          timestamp: nowFinal,
          type: 'execution_completed',
          description: `Execution ${execution?.status || 'failed'}: ${execution?.stepsCompleted || 0}/${desire.plan?.steps.length || 0} steps completed`,
          actor: 'user',
          data: {
            executionStatus: execution?.status,
            stepsCompleted: execution?.stepsCompleted,
            totalSteps: desire.plan?.steps.length || 0,
            error: graphResult.error,
            newStatus,
            durationMs: Date.now() - startTime,
          },
        }, user.username);

        const message = graphResult.success
          ? `✅ Execution complete! "${desire.title}" - ${execution?.stepsCompleted}/${desire.plan?.steps.length || 0} steps completed.`
          : `⚠️ Execution had issues: "${desire.title}" - ${graphResult.error || 'Unknown error'}`;

        console.log(`${LOG_PREFIX} ✅ Execution complete - awaiting outcome review`);

        // Send completion event
        send('complete', {
          success: graphResult.success,
          desire: finalDesire,
          execution,
          message,
          awaitingReview: true,
          durationMs: Date.now() - startTime,
        });

        controller.close();

      } catch (error) {
        console.error(`${LOG_PREFIX} ❌ Error:`, error);
        send('error', { error: (error as Error).message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};

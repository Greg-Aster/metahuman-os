/**
 * Task Executor for Active Operator
 *
 * Executes queued tasks by invoking the appropriate agents or handlers.
 * Maps task types to their implementations.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { systemPaths, ROOT } from '../paths.js';
import { audit } from '../audit.js';
import {
  getPendingTickets,
  startTicketReview,
  saveTicketAnalysis,
  wontFixTicket,
} from '../help-tickets/index.js';
import type { HelpTicket } from '../help-tickets/types.js';
import type {
  QueuedTask,
  TaskResult,
  TaskType,
  UserMessagePayload,
  DesireAdvancePayload,
  DesireExecutePayload,
  DesireReviewPayload,
} from './types.js';
import {
  saveCurrentTask,
  clearCurrentTask,
  recordExecutionStart,
  recordTaskResult,
} from './state-persister.js';
import { recordTaskExecution } from './cost-tracker.js';
import { runSelfHealing } from './self-healing.js';

// Path to tsx executable
const TSX_PATH = path.join(ROOT, 'node_modules', '.bin', 'tsx');

/**
 * Map of task types to their agent script names.
 */
const TASK_TO_AGENT: Record<TaskType, string | null> = {
  user_message: null, // Handled specially via chat handler
  memory_curate: 'organizer',
  training_curate: 'curator', // Prepare memories for LoRA training
  index_build: null, // Handled via buildMemoryIndex function
  reflect: 'reflector',
  curiosity: 'curiosity-service',
  inner_curiosity: 'inner-curiosity',
  dream: 'dreamer',
  desire_generate: 'desire-generator',
  desire_advance: null, // Handled specially - runs desire through planning/review/approval
  desire_execute: 'desire-executor',
  desire_review: null, // Handled specially - runs outcome reviewer graph
  psychoanalyze: 'psychoanalyzer',
  code_analyze: null, // Will be implemented in Phase 5
  help_ticket_review: null, // Handled specially - reviews user feedback tickets
};

/**
 * Run an agent as a subprocess.
 */
async function runAgentProcess(
  agentName: string,
  args: string[] = [],
  username?: string
): Promise<{ success: boolean; exitCode: number; error?: string }> {
  return new Promise((resolve) => {
    // Try subdirectory structure first (brain/agents/name/cli.ts)
    let agentPath = path.join(systemPaths.brain, 'agents', agentName, 'cli.ts');
    if (!fs.existsSync(agentPath)) {
      // Fall back to flat structure (brain/agents/name.ts)
      agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
    }

    if (!fs.existsSync(agentPath)) {
      console.warn(`[task-executor] Agent not found: ${agentPath}`);
      resolve({
        success: false,
        exitCode: 1,
        error: `Agent ${agentName} not found`,
      });
      return;
    }

    console.log(`[task-executor] Running agent: ${agentName}`);

    // Set username in environment if provided
    const env = { ...process.env };
    if (username) {
      env.MH_TRIGGER_USERNAME = username;
    }

    const child = spawn(TSX_PATH, [agentPath, ...args], {
      stdio: 'pipe',
      cwd: ROOT,
      env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      console.error(`[task-executor] Failed to start ${agentName}: ${err.message}`);
      resolve({
        success: false,
        exitCode: 1,
        error: err.message,
      });
    });

    child.on('close', (code) => {
      const exitCode = code ?? 0;
      if (exitCode !== 0) {
        console.error(`[task-executor] ${agentName} exited with code ${exitCode}`);
        if (stderr) console.error(`[task-executor] stderr: ${stderr.slice(0, 500)}`);
      } else {
        console.log(`[task-executor] ${agentName} completed successfully`);
        // Log stdout so user can see agent output (desires generated, etc.)
        if (stdout && stdout.trim()) {
          const lines = stdout.trim().split('\n');
          for (const line of lines.slice(-10)) { // Last 10 lines
            console.log(`[${agentName}] ${line}`);
          }
        }
      }
      resolve({
        success: exitCode === 0,
        exitCode,
        error: exitCode !== 0 ? (stderr || `Exit code ${exitCode}`) : undefined,
      });
    });
  });
}

/**
 * Handle index_build task by calling buildMemoryIndex.
 */
async function executeIndexBuild(username: string): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[task-executor] Building vector index for ${username}...`);
    // Dynamic import to avoid circular dependency
    const { buildMemoryIndex } = await import('../vector-index.js');
    await buildMemoryIndex({ username });
    console.log(`[task-executor] Index build complete for ${username}`);
    return { success: true };
  } catch (error) {
    console.error(`[task-executor] Index build failed: ${(error as Error).message}`);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Handle user_message task.
 * This is typically handled by the chat handler directly, but we provide
 * a fallback implementation here.
 */
async function executeUserMessage(
  payload: UserMessagePayload,
  username: string
): Promise<{ success: boolean; error?: string }> {
  // User messages should be processed through the normal chat pipeline.
  // This executor is called if the message was queued and needs processing.
  // For now, we'll mark it as needing to be handled by the chat system.
  console.log(`[task-executor] User message should be processed by chat handler`);

  // The actual processing happens in persona-chat.ts when it dequeues
  // We just acknowledge here
  return { success: true };
}

/**
 * Handle desire_advance task.
 * Processes pending desires through the planning/review/approval pipeline.
 * - Runs desire-planner to generate execution plan
 * - Runs desire-reviewer to check alignment and safety
 * - Gets verdict and either auto-approves or queues for user approval
 * - Posts approval request to inner dialogue if user approval needed
 */
async function executeDesireAdvance(
  payload: DesireAdvancePayload | undefined,
  username: string
): Promise<{ success: boolean; error?: string; data?: any }> {
  console.log('[task-executor] Running desire_advance pipeline for user:', username);

  // Import appendReflectionToBuffer at the top of this function scope
  const { appendReflectionToBuffer } = await import('../conversation-buffer.js');

  // Output to Inner Dialogue that we're starting
  appendReflectionToBuffer(username,
    `⚙️ **Running desire_advance task...**`,
    { dialogueSource: 'agency-system', displayColor: '#6b7280', type: 'task_start' }
  );

  try {
    // Dynamic imports to avoid circular dependencies
    const { listDesiresByStatus, loadDesire, moveDesire } = await import('../agency/storage.js');
    const { loadDecisionRules } = await import('../identity.js');
    const { canAutoApprove, loadConfig } = await import('../agency/config.js');
    const { appendReflectionToBuffer } = await import('../conversation-buffer.js');

    // Get pending AND nascent desires that need processing
    // (both status types count toward pendingReadyToAdvance in system-state.ts)
    const [pendingDesires, nascentDesires] = await Promise.all([
      listDesiresByStatus('pending', username),
      listDesiresByStatus('nascent', username),
    ]);
    const allPendingDesires = [...pendingDesires, ...nascentDesires];
    const config = await loadConfig(username);
    const activationThreshold = config.thresholds.activation;

    // DIAGNOSTIC: Log what we found
    console.log(`[task-executor] Found ${pendingDesires.length} pending + ${nascentDesires.length} nascent = ${allPendingDesires.length} total`);
    console.log(`[task-executor] Activation threshold: ${activationThreshold}`);
    for (const d of allPendingDesires) {
      const status = d.strength >= activationThreshold ? '✓ READY' : '○ building';
      console.log(`[task-executor]   ${status} "${d.title}" (strength: ${(d.strength * 100).toFixed(0)}%, status: ${d.status})`);
    }

    // Filter to desires that have crossed activation threshold
    const readyDesires = allPendingDesires.filter(d => d.strength >= activationThreshold);

    if (readyDesires.length === 0) {
      console.log('[task-executor] No pending desires ready for advancement');

      // Output detailed status to inner dialogue
      const totalDesires = allPendingDesires.length;
      if (totalDesires > 0) {
        const sortedByStrength = [...allPendingDesires].sort((a, b) => b.strength - a.strength);
        const top3 = sortedByStrength.slice(0, 3);
        const desireList = top3.map(d =>
          `  • "${d.title}" (${(d.strength * 100).toFixed(0)}%)`
        ).join('\n');

        appendReflectionToBuffer(username,
          `💭 **Agency Status**: ${totalDesires} desire(s) building strength toward ${(activationThreshold * 100).toFixed(0)}% threshold:\n${desireList}\n\n_Desires grow through reinforcement from related experiences._`,
          { dialogueSource: 'agency-system', displayColor: '#6b7280', type: 'desire_status' }
        );
      } else {
        appendReflectionToBuffer(username,
          `💭 **Agency Status**: No desires in the pipeline. The desire generator will create new ones based on goals, tasks, and experiences.`,
          { dialogueSource: 'agency-system', displayColor: '#6b7280', type: 'desire_status' }
        );
      }

      return { success: true, data: { processed: 0, reason: 'No pending desires above activation threshold' } };
    }

    console.log(`[task-executor] Found ${readyDesires.length} desire(s) ready for advancement:`, readyDesires.map(d => d.title));

    let processed = 0;
    let autoApproved = 0;
    let awaitingApproval = 0;

    // Get current trust level
    let currentTrustLevel = 'supervised_auto';
    try {
      const rules = loadDecisionRules();
      currentTrustLevel = rules.trustLevel;
    } catch {
      console.warn('[task-executor] Could not load decision rules, using default trust level');
    }

    for (const desire of readyDesires.slice(0, 3)) { // Process max 3 at a time
      console.log(`[task-executor] Processing desire: ${desire.title} (strength: ${desire.strength.toFixed(2)})`);

      // Remember the original status for moveDesire (could be 'pending' or 'nascent')
      const originalStatus = desire.status;

      // Step 1: Generate plan if missing
      if (!desire.plan) {
        console.log('[task-executor] Moving desire to planning status and generating plan...');

        // Output to Inner Dialogue so user knows what's happening
        appendReflectionToBuffer(username,
          `📋 **Planning desire:** "${desire.title}"\n\nGenerating execution plan...`,
          { dialogueSource: 'agency-system', displayColor: '#3b82f6', type: 'desire_planning_start' }
        );

        // Move desire to 'planning' status so desire-planner can find it
        const now = new Date().toISOString();
        desire.status = 'planning';
        desire.updatedAt = now;
        await moveDesire(desire, originalStatus, 'planning', username);

        // Run desire-planner (it will find desires in 'planning' status)
        const planResult = await runAgentProcess('desire-planner', [], username);
        if (!planResult.success) {
          console.error(`[task-executor] Plan generation failed for ${desire.id}`);
          console.error(`[task-executor] Error: ${planResult.error}`);

          // Output failure to Inner Dialogue
          appendReflectionToBuffer(username,
            `❌ **Plan generation failed:** "${desire.title}"\n\nError: ${planResult.error || 'Unknown error'}\n\nDesire returned to ${originalStatus} status.`,
            { dialogueSource: 'agency-system', displayColor: '#ef4444', type: 'desire_planning_failed' }
          );

          // Move back to original status on failure
          desire.status = originalStatus;
          await moveDesire(desire, 'planning', originalStatus, username);
          continue;
        }

        // Reload desire to get the plan
        const updatedDesire = await loadDesire(desire.id, username);
        if (!updatedDesire?.plan) {
          console.error(`[task-executor] No plan generated for ${desire.id}`);

          // Output to Inner Dialogue
          appendReflectionToBuffer(username,
            `⚠️ **No plan generated:** "${desire.title}"\n\nThe desire-planner did not produce a plan. Desire returned to ${originalStatus} status.`,
            { dialogueSource: 'agency-system', displayColor: '#f59e0b', type: 'desire_no_plan' }
          );

          // Move back to original status if no plan
          desire.status = originalStatus;
          await moveDesire(desire, 'planning', originalStatus, username);
          continue;
        }
        Object.assign(desire, updatedDesire);

        // Output success to Inner Dialogue with actual plan steps
        const planSteps = updatedDesire.plan?.steps || [];
        const stepsText = planSteps.length > 0
          ? planSteps.map((s: any, i: number) => `${i + 1}. ${s.action}${s.skill ? ` (${s.skill})` : ''}`).join('\n')
          : 'No steps defined';
        const operatorGoal = updatedDesire.plan?.operatorGoal || 'No goal specified';

        appendReflectionToBuffer(username,
          `✅ **Plan generated:** "${desire.title}"\n\n**Goal:** ${operatorGoal}\n\n**Steps:**\n${stepsText}\n\n**Risk:** ${updatedDesire.plan?.estimatedRisk || 'unknown'}`,
          { dialogueSource: 'agency-system', displayColor: '#22c55e', type: 'plan_generated', desireId: desire.id, desireTitle: desire.title }
        );
      }

      // After planning, the desire is now in 'planning' status (or was already there)
      // Use the current status as the source for subsequent moves
      const currentStatus = desire.status; // 'planning' if we just moved it, or the status it was in

      // Step 2: Check if can auto-approve based on trust and risk
      const risk = desire.plan?.estimatedRisk || 'medium';
      const approvalCheck = await canAutoApprove(risk, desire.strength, currentTrustLevel, username, desire);

      if (approvalCheck.autoApprove) {
        // Auto-approve and move to approved
        console.log(`[task-executor] ✅ Auto-approving desire: ${desire.title}`);
        const now = new Date().toISOString();
        desire.status = 'approved';
        desire.updatedAt = now;
        await moveDesire(desire, currentStatus, 'approved', username);
        autoApproved++;

        // Post to inner dialogue
        appendReflectionToBuffer(username,
          `🚀 Auto-approved desire: "${desire.title}"\n` +
          `Reason: ${approvalCheck.reason}\n` +
          `This will be executed automatically.`,
          { dialogueSource: 'agency-system', displayColor: '#22c55e' }
        );
      } else {
        // Queue for user approval
        console.log(`[task-executor] 📋 Queuing for approval: ${desire.title}`);
        const now = new Date().toISOString();
        desire.status = 'awaiting_approval';
        desire.updatedAt = now;
        await moveDesire(desire, currentStatus, 'awaiting_approval', username);
        awaitingApproval++;

        // Post approval request to inner dialogue with desire ID for inline approve/reject buttons
        appendReflectionToBuffer(username,
          `⚠️ Approval Required: "${desire.title}"\n\n` +
          `Description: ${desire.description}\n` +
          `Risk Level: ${risk}\n` +
          `Strength: ${(desire.strength * 100).toFixed(0)}%\n\n` +
          `Reason for manual approval: ${approvalCheck.reason}`,
          {
            dialogueSource: 'agency-system',
            displayColor: '#f59e0b',
            type: 'approval_request',
            desireId: desire.id,
            desireTitle: desire.title,
            desireRisk: risk,
          }
        );
      }

      processed++;
    }

    console.log(`[task-executor] Desire advance complete: ${processed} processed, ${autoApproved} auto-approved, ${awaitingApproval} awaiting approval`);

    return {
      success: true,
      data: {
        processed,
        autoApproved,
        awaitingApproval,
        trustLevel: currentTrustLevel,
      },
    };
  } catch (err) {
    console.error('[task-executor] Error in desire_advance:', err);
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Handle desire_execute task.
 * If a specific desireId is provided, pass it to the executor.
 * Otherwise, the executor will process all approved desires.
 */
async function executeDesire(
  payload: DesireExecutePayload | undefined,
  username: string
): Promise<{ success: boolean; error?: string }> {
  // Only pass desireId as arg if it's actually provided
  const args = payload?.desireId ? [payload.desireId] : [];
  const result = await runAgentProcess('desire-executor', args, username);
  return {
    success: result.success,
    error: result.error,
  };
}

/**
 * Handle desire_review task.
 * Reviews execution outcomes to determine: retry, escalate, complete, or abandon.
 * Runs the outcome-reviewer cognitive graph for each desire in awaiting_review status.
 */
async function executeDesireReview(
  payload: DesireReviewPayload | undefined,
  username: string
): Promise<{ success: boolean; error?: string; data?: any }> {
  console.log('[task-executor] Running desire outcome review for user:', username);

  try {
    const { appendReflectionToBuffer } = await import('../conversation-buffer.js');
    const { reviewOutcomeViaGraph } = await import('../agency/executor.js');
    const { listDesiresFromFolders, saveDesireManifest, moveDesire } = await import('../agency/storage.js');

    // Get desires awaiting review
    const allDesires = await listDesiresFromFolders(username);
    let desiresNeedingReview = allDesires.filter(d => d.status === 'awaiting_review');

    // If specific desireId provided, filter to just that one
    if (payload?.desireId) {
      desiresNeedingReview = desiresNeedingReview.filter(d => d.id === payload.desireId);
    }

    if (desiresNeedingReview.length === 0) {
      console.log('[task-executor] No desires awaiting review');
      return { success: true, data: { processed: 0, reason: 'No desires awaiting review' } };
    }

    console.log(`[task-executor] Found ${desiresNeedingReview.length} desire(s) awaiting review`);

    // Output to Inner Dialogue
    appendReflectionToBuffer(username,
      `🔍 **Reviewing execution outcomes:** ${desiresNeedingReview.length} desire(s) need review`,
      { dialogueSource: 'agency-system', displayColor: '#8b5cf6', type: 'outcome_review_start' }
    );

    let processed = 0;
    let retried = 0;
    let escalated = 0;
    let completed = 0;
    let abandoned = 0;

    for (const desire of desiresNeedingReview) {
      console.log(`[task-executor] Reviewing outcome for: ${desire.title}`);

      try {
        const result = await reviewOutcomeViaGraph(desire, username);

        if (result.success && result.verdict) {
          const verdict = result.verdict;
          const now = new Date().toISOString();

          // Update desire based on verdict
          switch (verdict) {
            case 'completed':
            case 'continue':
              // Mark as completed
              desire.status = 'completed';
              desire.completedAt = now;
              desire.updatedAt = now;
              desire.outcomeReview = result.outcomeReview;
              await saveDesireManifest(desire, username);
              await moveDesire(desire, 'awaiting_review', 'completed', username);
              completed++;
              appendReflectionToBuffer(username,
                `✅ **"${desire.title}"** completed successfully`,
                { dialogueSource: 'agency-system', displayColor: '#22c55e', type: 'desire_completed' }
              );
              break;

            case 'retry':
              // Send back to planning for another attempt
              desire.status = 'planning';
              desire.currentStage = 'planning';
              desire.updatedAt = now;
              desire.outcomeReview = result.outcomeReview;
              if (desire.stageIterations) {
                desire.stageIterations.planReview = (desire.stageIterations.planReview || 0) + 1;
              }
              await saveDesireManifest(desire, username);
              retried++;
              appendReflectionToBuffer(username,
                `🔄 **"${desire.title}"** - retrying with new plan (attempt ${desire.stageIterations?.planReview || 1})`,
                { dialogueSource: 'agency-system', displayColor: '#f59e0b', type: 'desire_retry' }
              );
              break;

            case 'escalate':
              // Move to awaiting_approval for user intervention
              desire.status = 'awaiting_approval';
              desire.updatedAt = now;
              desire.outcomeReview = result.outcomeReview;
              await saveDesireManifest(desire, username);
              escalated++;
              appendReflectionToBuffer(username,
                `⚠️ **"${desire.title}"** - needs your help. ${result.outcomeReview?.lessonsLearned || 'Review required.'}`,
                { dialogueSource: 'agency-system', displayColor: '#ef4444', type: 'desire_escalated' }
              );
              break;

            case 'abandon':
              // Mark as abandoned
              desire.status = 'abandoned';
              desire.completedAt = now;
              desire.updatedAt = now;
              desire.outcomeReview = result.outcomeReview;
              await saveDesireManifest(desire, username);
              await moveDesire(desire, 'awaiting_review', 'abandoned', username);
              abandoned++;
              appendReflectionToBuffer(username,
                `🚫 **"${desire.title}"** - abandoned. ${result.outcomeReview?.lessonsLearned || 'Not achievable.'}`,
                { dialogueSource: 'agency-system', displayColor: '#6b7280', type: 'desire_abandoned' }
              );
              break;
          }

          processed++;
        } else {
          console.error(`[task-executor] Failed to review desire ${desire.id}:`, result.error);
        }
      } catch (reviewError) {
        console.error(`[task-executor] Error reviewing desire ${desire.id}:`, reviewError);
      }
    }

    // Summary to Inner Dialogue
    appendReflectionToBuffer(username,
      `✅ **Outcome review complete:**\n` +
      `• ${processed} desire(s) processed\n` +
      `• ${completed} completed\n` +
      `• ${retried} sent for retry\n` +
      `• ${escalated} escalated to user\n` +
      `• ${abandoned} abandoned`,
      { dialogueSource: 'agency-system', displayColor: '#22c55e', type: 'outcome_review_complete' }
    );

    return {
      success: true,
      data: { processed, completed, retried, escalated, abandoned },
    };
  } catch (err) {
    console.error('[task-executor] Error in desire review:', err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Handle help_ticket_review task.
 * Reviews user feedback tickets, analyzes issues, and proposes fixes.
 * Integrates with System Coder desire system for code changes.
 */
async function executeHelpTicketReview(
  username: string
): Promise<{ success: boolean; error?: string; data?: any }> {
  console.log('[task-executor] Running help ticket review for user:', username);

  try {
    const { appendReflectionToBuffer } = await import('../conversation-buffer.js');
    const { callLLMPrompt } = await import('../model-router.js');

    // Get pending tickets
    const tickets = getPendingTickets(username);

    if (tickets.length === 0) {
      console.log('[task-executor] No pending help tickets to review');
      return { success: true, data: { processed: 0, reason: 'No pending tickets' } };
    }

    // Output to Inner Dialogue
    appendReflectionToBuffer(username,
      `🎫 **Reviewing help tickets:** ${tickets.length} ticket(s) need attention`,
      { dialogueSource: 'help-ticket-system', displayColor: '#f59e0b', type: 'ticket_review_start' }
    );

    let processed = 0;
    let needsFix = 0;
    let needsTraining = 0;
    let wontFix = 0;

    // Process up to 3 tickets at a time
    for (const ticket of tickets.slice(0, 3)) {
      console.log(`[task-executor] Reviewing ticket: ${ticket.id}`);

      // Mark as reviewing
      startTicketReview(username, ticket.id);

      // Build context for LLM analysis
      const analysisPrompt = buildTicketAnalysisPrompt(ticket);

      try {
        // Use the coder role for technical analysis
        const analysisResponse = await callLLMPrompt(
          'coder',
          analysisPrompt,
          { temperature: 0.3, maxTokens: 1000 }
        );

        // Parse the analysis response
        const analysis = parseTicketAnalysis(analysisResponse);

        // Save the analysis
        saveTicketAnalysis(username, ticket.id, analysis);

        // Track outcomes
        if (analysis.requiresCodeChange) {
          needsFix++;

          // Create a desire for System Coder to fix the issue
          await createFixDesire(username, ticket, analysis);

          appendReflectionToBuffer(username,
            `🔧 **Ticket ${ticket.id.slice(-8)}:** Requires code fix\n` +
            `Issue: ${analysis.summary}\n` +
            `Suggestion: ${analysis.suggestedFix || 'Investigate further'}`,
            { dialogueSource: 'help-ticket-system', displayColor: '#ef4444', type: 'ticket_needs_fix' }
          );
        } else if (analysis.requiresTrainingChange) {
          needsTraining++;

          appendReflectionToBuffer(username,
            `📚 **Ticket ${ticket.id.slice(-8)}:** Needs training adjustment\n` +
            `Issue: ${analysis.summary}\n` +
            `The response style or behavior needs refinement.`,
            { dialogueSource: 'help-ticket-system', displayColor: '#8b5cf6', type: 'ticket_needs_training' }
          );
        } else if (analysis.isNotActionable) {
          wontFix++;
          wontFixTicket(username, ticket.id, analysis.notActionableReason || 'Not actionable');

          appendReflectionToBuffer(username,
            `📝 **Ticket ${ticket.id.slice(-8)}:** Closed (not actionable)\n` +
            `Reason: ${analysis.notActionableReason || 'No clear fix available'}`,
            { dialogueSource: 'help-ticket-system', displayColor: '#6b7280', type: 'ticket_wont_fix' }
          );
        }

        processed++;
      } catch (analysisError) {
        console.error(`[task-executor] Failed to analyze ticket ${ticket.id}:`, analysisError);
        // Continue with next ticket
      }
    }

    // Summary to Inner Dialogue
    appendReflectionToBuffer(username,
      `✅ **Ticket review complete:**\n` +
      `• ${processed} ticket(s) processed\n` +
      `• ${needsFix} need code fixes\n` +
      `• ${needsTraining} need training adjustments\n` +
      `• ${wontFix} closed as not actionable`,
      { dialogueSource: 'help-ticket-system', displayColor: '#22c55e', type: 'ticket_review_complete' }
    );

    return {
      success: true,
      data: { processed, needsFix, needsTraining, wontFix, remaining: tickets.length - processed },
    };
  } catch (err) {
    console.error('[task-executor] Error in help ticket review:', err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Build an analysis prompt for a help ticket.
 */
function buildTicketAnalysisPrompt(ticket: HelpTicket): string {
  const parts = [
    'Analyze this user feedback ticket and determine what action is needed.',
    '',
    '## Ticket Information',
    `- ID: ${ticket.id}`,
    `- Created: ${ticket.createdAt}`,
    `- Target Type: ${ticket.feedbackTargetType}`,
    ticket.feedbackTargetId ? `- Target ID: ${ticket.feedbackTargetId}` : '',
    ticket.feedbackComment ? `- User Comment: "${ticket.feedbackComment}"` : '- No user comment provided',
    '',
    '## Analysis Required',
    'Determine:',
    '1. What went wrong (summary)',
    '2. Category: response_quality, memory_issue, personality_drift, task_failure, system_error, performance, or other',
    '3. Priority: low, medium, high, or critical',
    '4. Does this require a CODE change? (bugs, missing features, errors)',
    '5. Does this require a TRAINING change? (tone, personality, response style)',
    '6. Is this NOT actionable? (vague feedback, user error, external issues)',
    '7. If actionable, what specific fix would you suggest?',
    '',
    '## Response Format',
    'Respond in this exact format:',
    'SUMMARY: <one sentence summary of the issue>',
    'CATEGORY: <category>',
    'PRIORITY: <priority>',
    'REQUIRES_CODE_CHANGE: <yes/no>',
    'REQUIRES_TRAINING_CHANGE: <yes/no>',
    'NOT_ACTIONABLE: <yes/no>',
    'NOT_ACTIONABLE_REASON: <reason if not actionable, otherwise "N/A">',
    'SUGGESTED_FIX: <specific fix suggestion or "N/A">',
  ];

  return parts.filter(Boolean).join('\n');
}

/**
 * Parse the LLM analysis response into structured data.
 */
function parseTicketAnalysis(response: string): NonNullable<HelpTicket['llmAnalysis']> {
  const lines = response.split('\n');
  const getValue = (prefix: string): string => {
    const line = lines.find(l => l.toUpperCase().startsWith(prefix.toUpperCase()));
    return line ? line.substring(prefix.length).trim() : '';
  };

  const requiresCodeChange = getValue('REQUIRES_CODE_CHANGE:').toLowerCase() === 'yes';
  const requiresTrainingChange = getValue('REQUIRES_TRAINING_CHANGE:').toLowerCase() === 'yes';
  const isNotActionable = getValue('NOT_ACTIONABLE:').toLowerCase() === 'yes';
  const categoryRaw = getValue('CATEGORY:').toLowerCase();
  const priorityRaw = getValue('PRIORITY:').toLowerCase();

  // Map to valid category
  const validCategories = ['response_quality', 'memory_issue', 'personality_drift', 'task_failure', 'system_error', 'performance', 'other'] as const;
  const suggestedCategory = validCategories.find(c => categoryRaw.includes(c.replace('_', ' ')) || categoryRaw.includes(c)) || 'other';

  // Map to valid priority
  const validPriorities = ['low', 'medium', 'high', 'critical'] as const;
  const suggestedPriority = validPriorities.find(p => priorityRaw === p) || 'medium';

  return {
    summary: getValue('SUMMARY:') || 'Unable to determine issue',
    suggestedCategory,
    suggestedPriority,
    requiresCodeChange,
    requiresTrainingChange,
    isNotActionable,
    notActionableReason: isNotActionable ? getValue('NOT_ACTIONABLE_REASON:') : undefined,
    suggestedFix: requiresCodeChange ? getValue('SUGGESTED_FIX:') : undefined,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Create a desire for System Coder to fix an issue identified in a help ticket.
 */
async function createFixDesire(
  username: string,
  ticket: HelpTicket,
  analysis: NonNullable<HelpTicket['llmAnalysis']>
): Promise<void> {
  try {
    const { saveDesire, createDesireFolder } = await import('../agency/storage.js');
    const { generateId } = await import('../paths.js');

    const now = new Date().toISOString();
    const desireId = generateId('desire');

    // Create the desire folder first
    await createDesireFolder(desireId, username);

    // Build proper Desire object
    const desire = {
      id: desireId,
      title: `Fix: ${analysis.summary.slice(0, 50)}${analysis.summary.length > 50 ? '...' : ''}`,
      description: `User reported issue via negative feedback.\n\n` +
        `**Ticket:** ${ticket.id}\n` +
        `**Category:** ${analysis.suggestedCategory}\n` +
        `**Issue:** ${analysis.summary}\n` +
        `**Suggested Fix:** ${analysis.suggestedFix || 'Investigate and propose solution'}\n\n` +
        (ticket.feedbackComment ? `**User Comment:** "${ticket.feedbackComment}"` : ''),
      reason: `User submitted negative feedback indicating a problem that needs to be fixed. Ticket ID: ${ticket.id}`,
      source: 'help_ticket' as const,
      sourceId: ticket.id,
      sourceData: {
        ticketId: ticket.id,
        category: analysis.suggestedCategory,
        priority: analysis.suggestedPriority,
        suggestedFix: analysis.suggestedFix,
      },
      strength: 0.5, // Start with moderate strength
      status: 'pending' as const,
      relatedMemories: ticket.feedbackTargetId ? [ticket.feedbackTargetId] : [],
      createdAt: now,
      updatedAt: now,
      metrics: {
        cycleCount: 0,
        completionCount: 0,
        currentCycle: 0,
        totalActiveTimeMs: 0,
        totalIdleTimeMs: 0,
        avgCycleTimeMs: 0,
        lastActivityAt: now,
        peakStrength: 0.5,
        troughStrength: 0.5,
        reinforcementCount: 0,
        decayCount: 0,
        netReinforcement: 0,
      },
    };

    await saveDesire(desire as any, username);
    console.log(`[task-executor] Created fix desire for ticket ${ticket.id}: ${desireId}`);
  } catch (err) {
    console.error(`[task-executor] Failed to create fix desire for ticket ${ticket.id}:`, err);
  }
}

/**
 * Execute a queued task.
 */
export async function executeTask(task: QueuedTask): Promise<TaskResult> {
  const startTime = Date.now();
  const username = task.username || 'anonymous';

  // Save current task for crash recovery
  saveCurrentTask(task);
  recordExecutionStart(task);

  audit({
    category: 'agent',
    level: 'info',
    event: 'active_operator_task_started',
    actor: 'active-operator',
    details: {
      taskId: task.id,
      taskType: task.type,
      priority: task.priority,
      username,
    },
  });

  let success = false;
  let error: string | undefined;
  let data: unknown;

  try {
    switch (task.type) {
      case 'user_message':
        const msgResult = await executeUserMessage(task.payload as UserMessagePayload, username);
        success = msgResult.success;
        error = msgResult.error;
        break;

      case 'index_build':
        const indexResult = await executeIndexBuild(username);
        success = indexResult.success;
        error = indexResult.error;
        break;

      case 'desire_advance':
        const advanceResult = await executeDesireAdvance(task.payload as DesireAdvancePayload, username);
        success = advanceResult.success;
        error = advanceResult.error;
        data = advanceResult.data;
        break;

      case 'desire_execute':
        const desireResult = await executeDesire(task.payload as DesireExecutePayload, username);
        success = desireResult.success;
        error = desireResult.error;
        break;

      case 'desire_review':
        // Review execution outcomes (retry/escalate/complete/abandon)
        const reviewResult = await executeDesireReview(task.payload as DesireReviewPayload, username);
        success = reviewResult.success;
        error = reviewResult.error;
        data = reviewResult.data;
        break;

      case 'code_analyze':
        // Self-healing code analysis
        console.log('[task-executor] Running self-healing code analysis');
        try {
          const healingResult = await runSelfHealing(username, 5);
          success = true;
          data = {
            errorsFound: healingResult.errorsFound,
            proposalsCreated: healingResult.proposalsCreated,
            proposals: healingResult.proposals.map((p) => ({
              id: p.id,
              file: p.error.file,
              line: p.error.line,
              confidence: p.confidence,
            })),
          };
        } catch (err) {
          success = false;
          error = (err as Error).message;
        }
        break;

      case 'help_ticket_review':
        // Review user feedback tickets and propose fixes
        const ticketResult = await executeHelpTicketReview(username);
        success = ticketResult.success;
        error = ticketResult.error;
        data = ticketResult.data;
        break;

      default:
        // Standard agent execution
        const agentName = TASK_TO_AGENT[task.type];
        if (agentName) {
          const agentResult = await runAgentProcess(agentName, [], username);
          success = agentResult.success;
          error = agentResult.error;
        } else {
          error = `No handler for task type: ${task.type}`;
          success = false;
        }
    }
  } catch (err) {
    success = false;
    error = (err as Error).message;
    console.error(`[task-executor] Error executing ${task.type}:`, err);
  }

  const durationMs = Date.now() - startTime;

  // Clear current task
  clearCurrentTask();

  // Build result
  const result: TaskResult = {
    taskId: task.id,
    success,
    completedAt: new Date().toISOString(),
    durationMs,
    error,
    data,
  };

  // Record result
  recordTaskResult(result);
  recordTaskExecution(task.type, result);

  audit({
    category: 'agent',
    level: success ? 'info' : 'warn',
    event: 'active_operator_task_completed',
    actor: 'active-operator',
    details: {
      taskId: task.id,
      taskType: task.type,
      success,
      durationMs,
      error,
      username,
    },
  });

  return result;
}

/**
 * Check if a task type is executable.
 */
export function isTaskExecutable(taskType: TaskType): boolean {
  if (taskType === 'user_message') return true;
  if (taskType === 'index_build') return true;
  if (taskType === 'code_analyze') return true;
  if (taskType === 'help_ticket_review') return true;

  const agentName = TASK_TO_AGENT[taskType];
  if (!agentName) return false;

  const agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
  return fs.existsSync(agentPath);
}

/**
 * Get list of available task types.
 */
export function getAvailableTaskTypes(): TaskType[] {
  const types: TaskType[] = [];

  for (const [taskType, agentName] of Object.entries(TASK_TO_AGENT)) {
    if (isTaskExecutable(taskType as TaskType)) {
      types.push(taskType as TaskType);
    }
  }

  return types;
}

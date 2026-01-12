/**
 * Big Brother Reviewer Node
 *
 * Cognitive graph node that triggers Big Brother reviews based on:
 * 1. Periodic intervals (every N cycles)
 * 2. Error conditions (consecutive failures)
 * 3. Stuck conditions (no progress for N cycles)
 *
 * When triggered, escalates to Big Brother (Claude Code or other backend)
 * for review and can:
 * - Write suggestions to scratchpad
 * - Trigger self-healing via coder agent
 * - Modify configuration
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { loadScratchpad, addScratchpadEntry } from '../../active-operator/state-persister.js';
import { recordBigBrotherReview } from '../../active-operator/lizard-brain-logger.js';
import { escalateToBigBrother } from '../../big-brother.js';
import { loadOperatorConfig } from '../../config.js';
import { runSelfHealing } from '../../active-operator/self-healing.js';

/**
 * Big Brother reviewer configuration.
 */
export interface BigBrotherReviewerConfig {
  /** Enable the reviewer */
  enabled: boolean;
  /** Trigger review every N cycles */
  periodicReviewInterval: number;
  /** Trigger on consecutive errors */
  triggerOnErrors: boolean;
  /** Number of consecutive errors to trigger */
  errorThreshold: number;
  /** Trigger when no progress detected */
  triggerOnStuck: boolean;
  /** Cycles without task execution to trigger */
  stuckThreshold: number;
  /** Include full scratchpad in review context */
  includeScratchpad: boolean;
  /** Include recent log entries */
  includeRecentLogs: boolean;
  /** Number of log entries to include */
  recentLogCount: number;
  /** Allow Big Brother to modify scratchpad */
  allowScratchpadModification: boolean;
  /** Allow Big Brother to modify config */
  allowConfigModification: boolean;
  /** Allow Big Brother to trigger coder agent */
  allowCoderAgentTrigger: boolean;
}

const DEFAULT_CONFIG: BigBrotherReviewerConfig = {
  enabled: true,
  periodicReviewInterval: 50,
  triggerOnErrors: true,
  errorThreshold: 3,
  triggerOnStuck: true,
  stuckThreshold: 10,
  includeScratchpad: true,
  includeRecentLogs: true,
  recentLogCount: 20,
  allowScratchpadModification: true,
  allowConfigModification: true,
  allowCoderAgentTrigger: true,
};

/**
 * Analyze scratchpad for error patterns.
 */
function analyzeForErrors(scratchpad: ReturnType<typeof loadScratchpad>, threshold: number): {
  hasErrors: boolean;
  errorCount: number;
  recentErrors: string[];
} {
  const recentEntries = scratchpad.entries.slice(-20);
  const errors: string[] = [];

  for (const entry of recentEntries) {
    if (entry.type === 'observation' && entry.content.includes('FAILED')) {
      errors.push(entry.content);
    }
  }

  // Count consecutive recent errors
  let consecutiveErrors = 0;
  for (let i = recentEntries.length - 1; i >= 0; i--) {
    const entry = recentEntries[i];
    if (entry.type === 'observation' && entry.content.includes('FAILED')) {
      consecutiveErrors++;
    } else if (entry.type === 'observation' && entry.content.includes('completed')) {
      break; // Stop at first success
    }
  }

  return {
    hasErrors: consecutiveErrors >= threshold,
    errorCount: consecutiveErrors,
    recentErrors: errors.slice(-5),
  };
}

/**
 * Check if system is stuck (no executions in N cycles).
 */
function checkForStuck(scratchpad: ReturnType<typeof loadScratchpad>, threshold: number): {
  isStuck: boolean;
  cyclesWithoutExecution: number;
} {
  const recentEntries = scratchpad.entries.slice(-threshold * 2);
  let cyclesWithoutExecution = 0;

  // Count recent entries without successful task execution
  for (let i = recentEntries.length - 1; i >= 0; i--) {
    const entry = recentEntries[i];
    if (entry.type === 'decision') {
      cyclesWithoutExecution++;
    }
    if (entry.type === 'observation' && entry.content.includes('completed')) {
      break; // Found a successful execution
    }
  }

  return {
    isStuck: cyclesWithoutExecution >= threshold,
    cyclesWithoutExecution,
  };
}

/**
 * Build context for Big Brother review.
 */
function buildReviewContext(
  scratchpad: ReturnType<typeof loadScratchpad>,
  config: BigBrotherReviewerConfig,
  triggerReason: string
): string {
  const lines: string[] = [
    `# Lizard Brain Review Request`,
    ``,
    `## Trigger Reason: ${triggerReason}`,
    ``,
    `## Current Cycle: ${scratchpad.cycleNumber}`,
    ``,
  ];

  if (scratchpad.lastDecision) {
    lines.push(`## Last Decision`);
    lines.push(`- Task: ${scratchpad.lastDecision.task}`);
    lines.push(`- Reasoning: ${scratchpad.lastDecision.reasoning}`);
    lines.push(``);
  }

  if (scratchpad.lastResult) {
    lines.push(`## Last Result`);
    lines.push(`- Success: ${scratchpad.lastResult.success}`);
    lines.push(`- Duration: ${scratchpad.lastResult.durationMs}ms`);
    if (scratchpad.lastResult.error) {
      lines.push(`- Error: ${scratchpad.lastResult.error}`);
    }
    lines.push(``);
  }

  if (config.includeScratchpad) {
    const recentEntries = scratchpad.entries.slice(-config.recentLogCount);
    lines.push(`## Recent Activity (last ${recentEntries.length} entries)`);
    for (const entry of recentEntries) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      lines.push(`[${time}] ${entry.type.toUpperCase()}: ${entry.content}`);
    }
    lines.push(``);
  }

  if (scratchpad.activitySummary) {
    lines.push(`## Activity Summary`);
    lines.push(scratchpad.activitySummary);
    lines.push(``);
  }

  return lines.join('\n');
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const username = context.userId || context.username || 'anonymous';
  const config: BigBrotherReviewerConfig = {
    ...DEFAULT_CONFIG,
    ...properties,
  };

  // Check if reviewer is enabled
  if (!config.enabled) {
    return { triggered: false, reason: 'Reviewer disabled' };
  }

  // Load current scratchpad state
  const scratchpad = loadScratchpad();
  const cycleNumber = scratchpad.cycleNumber;

  // Determine if review should be triggered
  let shouldTrigger = false;
  let triggerReason: 'periodic' | 'error_detected' | 'stuck_detected' | null = null;

  // Check periodic trigger
  if (config.periodicReviewInterval > 0 && cycleNumber % config.periodicReviewInterval === 0 && cycleNumber > 0) {
    shouldTrigger = true;
    triggerReason = 'periodic';
    console.log(`[BigBrotherReviewer] Periodic review triggered at cycle ${cycleNumber}`);
  }

  // Check error trigger
  if (!shouldTrigger && config.triggerOnErrors) {
    const errorAnalysis = analyzeForErrors(scratchpad, config.errorThreshold);
    if (errorAnalysis.hasErrors) {
      shouldTrigger = true;
      triggerReason = 'error_detected';
      console.log(`[BigBrotherReviewer] Error trigger: ${errorAnalysis.errorCount} consecutive errors`);
    }
  }

  // Check stuck trigger
  if (!shouldTrigger && config.triggerOnStuck) {
    const stuckAnalysis = checkForStuck(scratchpad, config.stuckThreshold);
    if (stuckAnalysis.isStuck) {
      shouldTrigger = true;
      triggerReason = 'stuck_detected';
      console.log(`[BigBrotherReviewer] Stuck trigger: ${stuckAnalysis.cyclesWithoutExecution} cycles without execution`);
    }
  }

  if (!shouldTrigger || !triggerReason) {
    return { triggered: false, reason: 'No review needed' };
  }

  // Build review context
  const reviewContext = buildReviewContext(scratchpad, config, triggerReason);

  // Load operator config for Big Brother - skip cache to respect current settings
  const operatorConfig = loadOperatorConfig(username, true);

  // Check if Big Brother is enabled
  if (!operatorConfig.bigBrotherMode?.enabled) {
    console.log('[BigBrotherReviewer] Big Brother mode is disabled, skipping review');
    return { triggered: true, reason: triggerReason, skipped: true, skipReason: 'Big Brother mode disabled' };
  }

  console.log(`[BigBrotherReviewer] Escalating to Big Brother for ${triggerReason} review`);

  try {
    // Escalate to Big Brother
    const result = await escalateToBigBrother(
      {
        goal: 'Review Lizard Brain autonomous operation and suggest improvements',
        stuckReason: triggerReason,
        errorType: triggerReason === 'error_detected' ? 'repeated_failures' : undefined,
        scratchpad: scratchpad.entries.slice(-config.recentLogCount),
        context: {
          cycleNumber,
          triggerReason,
          reviewContext,
        },
        suggestions: [
          'Analyze recent decisions and their outcomes',
          'Identify patterns causing failures or stuck states',
          'Suggest configuration changes if needed',
          'Recommend specific tasks to prioritize',
        ],
      },
      operatorConfig
    );

    // Process Big Brother response
    const suggestions: string[] = [];
    let scratchpadInstructions: string | undefined;

    if (result.success) {
      // Extract suggestions from reasoning
      if (result.reasoning) {
        suggestions.push(result.reasoning);
      }
      if (result.alternativeApproach) {
        suggestions.push(`Alternative approach: ${result.alternativeApproach}`);
      }

      // Write to scratchpad if allowed
      if (config.allowScratchpadModification && result.reasoning) {
        addScratchpadEntry('thought', `[Big Brother Review] ${result.reasoning}`);
        scratchpadInstructions = result.reasoning;

        if (result.alternativeApproach) {
          addScratchpadEntry('thought', `[Big Brother Suggestion] ${result.alternativeApproach}`);
        }
      }

      // Trigger self-healing if errors detected and allowed
      if (triggerReason === 'error_detected' && config.allowCoderAgentTrigger) {
        console.log('[BigBrotherReviewer] Triggering self-healing due to errors');
        try {
          const healingResult = await runSelfHealing(username, 5);
          if (healingResult.errorsFound > 0) {
            suggestions.push(`Self-healing found ${healingResult.errorsFound} errors, created ${healingResult.proposalsCreated} fix proposals`);
          }
        } catch (healingError) {
          console.warn('[BigBrotherReviewer] Self-healing failed:', healingError);
        }
      }
    }

    // Log the review
    await recordBigBrotherReview(username, {
      triggeredAt: new Date().toISOString(),
      reason: triggerReason,
      result: result.success ? 'success' : 'failed',
      suggestions,
      scratchpadInstructions,
    });

    audit({
      category: 'system',
      level: 'info',
      event: 'lizard_brain_big_brother_review',
      actor: 'active-operator',
      details: {
        username,
        cycleNumber,
        triggerReason,
        success: result.success,
        suggestionsCount: suggestions.length,
      },
    });

    return {
      triggered: true,
      reason: triggerReason,
      success: result.success,
      suggestions,
      reasoning: result.reasoning,
    };

  } catch (error) {
    console.error('[BigBrotherReviewer] Error during review:', error);

    audit({
      category: 'system',
      level: 'error',
      event: 'lizard_brain_big_brother_review_failed',
      actor: 'active-operator',
      details: {
        username,
        cycleNumber,
        triggerReason,
        error: (error as Error).message,
      },
    });

    return {
      triggered: true,
      reason: triggerReason,
      success: false,
      error: (error as Error).message,
    };
  }
};

export const BigBrotherReviewerNode: NodeDefinition = defineNode({
  id: 'big_brother_reviewer',
  name: 'Big Brother Reviewer',
  category: 'active-operator',
  inputs: [
    { name: 'executed', type: 'boolean', description: 'Whether a task was executed' },
    { name: 'success', type: 'boolean', description: 'Whether execution succeeded' },
    { name: 'reasoning', type: 'string', description: 'Decision reasoning' },
  ],
  outputs: [
    { name: 'triggered', type: 'boolean', description: 'Whether review was triggered' },
    { name: 'reason', type: 'string', description: 'Trigger reason if triggered' },
    { name: 'success', type: 'boolean', description: 'Whether review succeeded' },
    { name: 'suggestions', type: 'array', description: 'Suggestions from Big Brother' },
  ],
  properties: {
    enabled: {
      type: 'boolean',
      default: true,
      label: 'Enable Reviewer',
      description: 'Enable Big Brother reviewer',
    },
    periodicReviewInterval: {
      type: 'number',
      default: 50,
      label: 'Periodic Interval',
      description: 'Review every N cycles (0 to disable)',
    },
    triggerOnErrors: {
      type: 'boolean',
      default: true,
      label: 'Trigger on Errors',
      description: 'Trigger review on consecutive errors',
    },
    errorThreshold: {
      type: 'number',
      default: 3,
      label: 'Error Threshold',
      description: 'Number of consecutive errors to trigger',
    },
    triggerOnStuck: {
      type: 'boolean',
      default: true,
      label: 'Trigger on Stuck',
      description: 'Trigger review when no progress detected',
    },
    stuckThreshold: {
      type: 'number',
      default: 10,
      label: 'Stuck Threshold',
      description: 'Cycles without execution to trigger',
    },
    allowScratchpadModification: {
      type: 'boolean',
      default: true,
      label: 'Allow Scratchpad Modification',
      description: 'Allow Big Brother to write to scratchpad',
    },
    allowCoderAgentTrigger: {
      type: 'boolean',
      default: true,
      label: 'Allow Coder Agent Trigger',
      description: 'Allow Big Brother to trigger self-healing',
    },
  },
  description: 'Triggers Big Brother reviews based on periodic intervals, errors, or stuck conditions',
  execute,
});

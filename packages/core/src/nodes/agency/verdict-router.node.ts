/**
 * Verdict Router Node
 *
 * Routes outcome review results to appropriate handlers based on verdict.
 * Supports multi-output routing for different verdict types.
 *
 * For long-running goals, handles milestone advancement:
 * - When milestoneAdvance=true, advances to next milestone and loops back to planning
 * - Only routes to terminal when completionCriteriaMet=true (goal truly achieved)
 *
 * Inputs:
 *   - outcomeReview: OutcomeReview object with verdict
 *
 * Outputs:
 *   - output0: For completed/continue/abandon verdicts (terminal states)
 *   - output1: For retry verdict OR milestone advancement (loop back to planner)
 *   - output2: For escalate verdict (requires user attention)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesireOutcomeReview, OutcomeVerdict } from '../../agency/types.js';
import { advanceDesireMilestone } from '../../agency/storage.js';

interface VerdictRouterInput {
  outcomeReview?: DesireOutcomeReview & {
    milestoneAdvance?: boolean;
    completionCriteriaMet?: boolean;
  };
  verdict?: OutcomeVerdict;
  desire?: Desire;
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const slot0 = inputs[0] as VerdictRouterInput | undefined;

  const outcomeReview = slot0?.outcomeReview;
  const verdict = outcomeReview?.verdict || slot0?.verdict;
  let desire = slot0?.desire;
  const username = context.userId;

  if (!verdict) {
    console.log('[verdict-router] No verdict provided, defaulting to escalate');
    return {
      output0: null,
      output1: null,
      output2: { desire, outcomeReview, reason: 'No verdict available' },
      selectedRoute: 2,
      verdict: 'escalate',
    };
  }

  // Check for milestone advancement in long-running goals
  const milestoneAdvance = outcomeReview?.milestoneAdvance;
  const completionCriteriaMet = outcomeReview?.completionCriteriaMet;
  const isLongRunning = desire?.goalType === 'long_running';

  // Handle milestone advancement for long-running goals
  if (verdict === 'continue' && isLongRunning && milestoneAdvance && !completionCriteriaMet) {
    console.log('[verdict-router] Long-running goal: advancing milestone');

    // Advance to next milestone
    if (desire?.id && username) {
      try {
        const updatedDesire = await advanceDesireMilestone(desire.id, username);
        desire = updatedDesire; // Use updated desire with advanced milestone

        const progress = updatedDesire.goalProgress;
        console.log(
          `[verdict-router] Advanced to milestone ${(progress?.currentMilestone || 0) + 1}/${progress?.totalMilestones || 0} ` +
          `(${progress?.progressPercent || 0}% complete)`
        );
      } catch (err) {
        console.error('[verdict-router] Failed to advance milestone:', err);
        // Still route to planning, let it handle the error
      }
    }

    // Route to output1 (loop back to planner for next milestone)
    console.log('[verdict-router] Verdict: continue (milestone advance) → Route 1 (replan)');
    return {
      output0: null,
      output1: { desire, outcomeReview, verdict, milestoneAdvanced: true },
      output2: null,
      selectedRoute: 1,
      verdict,
      milestoneAdvanced: true,
    };
  }

  // Route configuration from properties or defaults
  const routes = (properties?.routes as Record<string, number>) || {
    completed: 0,
    continue: 0,
    retry: 1,
    escalate: 2,
    abandon: 0,
  };

  const selectedRoute = routes[verdict] ?? 2; // Default to escalate if unknown

  console.log(`[verdict-router] Verdict: ${verdict} → Route ${selectedRoute}`);

  // Build outputs - only populate the selected route
  const output0 = selectedRoute === 0 ? { desire, outcomeReview, verdict } : null;
  const output1 = selectedRoute === 1 ? { desire, outcomeReview, verdict } : null;
  const output2 = selectedRoute === 2 ? { desire, outcomeReview, verdict } : null;

  return {
    output0,
    output1,
    output2,
    selectedRoute,
    verdict,
  };
};

export const VerdictRouterNode: NodeDefinition = defineNode({
  id: 'verdict_router',
  name: 'Verdict Router',
  category: 'agency',
  description: 'Routes outcome review results to appropriate handlers based on verdict. For long-running goals, handles milestone advancement by routing back to planner.',
  inputs: [
    { name: 'outcomeReview', type: 'object', description: 'Outcome review with verdict (includes milestoneAdvance/completionCriteriaMet for long-running goals)' },
  ],
  outputs: [
    { name: 'output0', type: 'object', description: 'Terminal verdicts (completed/abandon, or continue when goal truly finished)' },
    { name: 'output1', type: 'object', description: 'Retry verdict OR milestone advancement (loop back to planner)' },
    { name: 'output2', type: 'object', description: 'Escalate verdict (requires user attention)' },
    { name: 'selectedRoute', type: 'number', description: 'Which output was selected (0, 1, or 2)' },
    { name: 'verdict', type: 'string', description: 'The verdict that was routed' },
    { name: 'milestoneAdvanced', type: 'boolean', optional: true, description: 'True if a milestone was advanced (for long-running goals)' },
  ],
  properties: {
    routes: {
      completed: 0,
      continue: 0,
      retry: 1,
      escalate: 2,
      abandon: 0,
    },
  },
  propertySchemas: {
    routes: {
      type: 'json',
      default: {
        completed: 0,
        continue: 0,
        retry: 1,
        escalate: 2,
        abandon: 0,
      },
      label: 'Verdict Routes',
      description: 'Map of verdict to output slot (0, 1, or 2)',
    },
  },
  execute,
});

export default VerdictRouterNode;

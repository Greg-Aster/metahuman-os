/**
 * Verdict Router Node
 *
 * Routes outcome review results to appropriate handlers based on verdict.
 * Supports multi-output routing for different verdict types.
 *
 * Inputs:
 *   - outcomeReview: OutcomeReview object with verdict
 *
 * Outputs:
 *   - output0: For completed/continue/abandon verdicts (terminal states)
 *   - output1: For retry verdict (loop back to planner)
 *   - output2: For escalate verdict (requires user attention)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { DesireOutcomeReview, OutcomeVerdict } from '../../agency/types.js';

interface VerdictRouterInput {
  outcomeReview?: DesireOutcomeReview;
  verdict?: OutcomeVerdict;
  desire?: unknown;
}

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const slot0 = inputs[0] as VerdictRouterInput | undefined;

  const outcomeReview = slot0?.outcomeReview;
  const verdict = outcomeReview?.verdict || slot0?.verdict;
  const desire = slot0?.desire;

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
  description: 'Routes outcome review results to appropriate handlers based on verdict',
  inputs: [
    { name: 'outcomeReview', type: 'object', description: 'Outcome review with verdict' },
  ],
  outputs: [
    { name: 'output0', type: 'object', description: 'Terminal verdicts (completed/continue/abandon)' },
    { name: 'output1', type: 'object', description: 'Retry verdict (loop back to planner)' },
    { name: 'output2', type: 'object', description: 'Escalate verdict (requires user attention)' },
    { name: 'selectedRoute', type: 'number', description: 'Which output was selected (0, 1, or 2)' },
    { name: 'verdict', type: 'string', description: 'The verdict that was routed' },
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

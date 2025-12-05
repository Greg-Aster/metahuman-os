/**
 * Desire Enricher Node
 *
 * Merges user critique/instructions OR outcome review lessons into a desire object.
 * This enables the workflow to accept user input and combine it with the loaded desire,
 * or to incorporate lessons learned from a failed execution attempt for retry planning.
 *
 * Inputs:
 *   - desire: Desire object from desire_loader
 *   - userInput: User critique/instructions (from user_input node or context)
 *
 * Outputs:
 *   - desire: Enriched Desire object with userCritique populated
 *   - hasCritique: boolean - whether critique was added
 *   - hasLessons: boolean - whether outcome lessons were incorporated
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire } from '../../agency/types.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Inputs from graph:
  // slot 0: {desire, found} from desire_loader
  // slot 1: {message, ...} from user_input OR direct string
  const slot0 = inputs[0] as { desire?: Desire; found?: boolean } | undefined;
  const slot1 = inputs[1] as { message?: string } | string | undefined;

  const desire = slot0?.desire;
  const enrichFromOutcome = properties?.enrichFromOutcome === true;

  if (!desire) {
    return {
      desire: null,
      hasCritique: false,
      hasLessons: false,
      error: 'No desire provided',
    };
  }

  // Extract critique from:
  // 1. Input slot (from user_input node or direct string)
  // 2. Context (from API call)
  // 3. Existing desire.userCritique
  let critique: string | undefined;

  if (typeof slot1 === 'string') {
    critique = slot1.trim();
  } else if (slot1?.message) {
    critique = slot1.message.trim();
  } else if (context.userCritique) {
    critique = (context.userCritique as string).trim();
  } else if (context.userMessage) {
    // If userMessage looks like a critique (not a desire creation), use it
    const msg = (context.userMessage as string).trim();
    if (msg && !msg.toLowerCase().startsWith('i want') && !msg.toLowerCase().startsWith('create')) {
      critique = msg;
    }
  }

  // Use existing critique if no new one provided
  if (!critique && desire.userCritique) {
    critique = desire.userCritique;
  }

  // Extract lessons learned from outcome review (for retry loop)
  let lessonsLearned: string | undefined;
  let hasLessons = false;

  if (enrichFromOutcome && desire.outcomeReview) {
    const review = desire.outcomeReview;
    const lessons: string[] = [];

    // Add reasoning from outcome review
    if (review.reasoning) {
      lessons.push(`Previous attempt result: ${review.reasoning}`);
    }

    // Add lessons learned
    if (review.lessonsLearned && review.lessonsLearned.length > 0) {
      lessons.push(`Lessons learned: ${review.lessonsLearned.join('; ')}`);
    }

    // Add suggestions for next attempt
    if (review.nextAttemptSuggestions && review.nextAttemptSuggestions.length > 0) {
      lessons.push(`Suggestions: ${review.nextAttemptSuggestions.join('; ')}`);
    }

    // Add success score context
    if (review.successScore !== undefined) {
      lessons.push(`Previous success score: ${(review.successScore * 100).toFixed(0)}%`);
    }

    if (lessons.length > 0) {
      lessonsLearned = lessons.join('\n');
      hasLessons = true;
    }
  }

  // Combine critique and lessons for the enriched desire
  let combinedCritique = critique;
  if (lessonsLearned) {
    if (combinedCritique) {
      combinedCritique = `${combinedCritique}\n\n--- Lessons from previous attempt ---\n${lessonsLearned}`;
    } else {
      combinedCritique = `--- Lessons from previous attempt ---\n${lessonsLearned}`;
    }
  }

  // Return enriched desire
  const enrichedDesire: Desire = {
    ...desire,
    userCritique: combinedCritique || desire.userCritique,
    critiqueAt: combinedCritique && combinedCritique !== desire.userCritique
      ? new Date().toISOString()
      : desire.critiqueAt,
  };

  console.log(`[desire-enricher] Enriched desire "${desire.title}"`);
  console.log(`[desire-enricher]    Has critique: ${!!critique}`);
  console.log(`[desire-enricher]    Has lessons: ${hasLessons}`);
  if (enrichedDesire.userCritique) {
    console.log(`[desire-enricher]    Combined: "${enrichedDesire.userCritique.substring(0, 100)}..."`);
  }

  return {
    desire: enrichedDesire,
    found: true,
    hasCritique: !!critique,
    hasLessons,
    isNewCritique: combinedCritique !== desire.userCritique,
  };
};

export const DesireEnricherNode: NodeDefinition = defineNode({
  id: 'desire_enricher',
  name: 'Enrich Desire',
  category: 'agency',
  description: 'Merges user critique/instructions or outcome review lessons into a desire for planning',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire from desire_loader' },
    { name: 'userInput', type: 'any', optional: true, description: 'User critique/instructions' },
  ],
  outputs: [
    { name: 'desire', type: 'object', description: 'Enriched desire with userCritique' },
    { name: 'found', type: 'boolean', description: 'Whether desire was found' },
    { name: 'hasCritique', type: 'boolean', description: 'Whether user critique is present' },
    { name: 'hasLessons', type: 'boolean', description: 'Whether outcome lessons were incorporated' },
    { name: 'isNewCritique', type: 'boolean', description: 'Whether new critique was added' },
  ],
  properties: {
    enrichFromOutcome: false,
  },
  propertySchemas: {
    enrichFromOutcome: {
      type: 'boolean',
      default: false,
      label: 'Enrich from Outcome',
      description: 'Include lessons learned from outcome review in critique (for retry loop)',
    },
  },
  execute,
});

export default DesireEnricherNode;

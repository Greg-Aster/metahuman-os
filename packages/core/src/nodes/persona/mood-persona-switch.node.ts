import { audit } from '../../audit.js';
import { saveMoodState } from '../../mood-settings.js';
import { setActivePersonaFacet } from '../../persona-facets.js';
import { defineNode, type NodeDefinition } from '../types.js';

export const MoodPersonaSwitchNode: NodeDefinition = defineNode({
  id: 'mood_persona_switch',
  name: 'Mood Persona Switch',
  category: 'persona',
  inputs: [
    { name: 'decision', type: 'decision', description: 'Decision from Mood Persona Classifier' },
    { name: 'reviewContext', type: 'object', description: 'Safety settings and current persona state' },
  ],
  outputs: [
    { name: 'changed', type: 'boolean', description: 'Whether the active persona changed' },
    { name: 'activeFacet', type: 'string', description: 'Resulting active facet' },
    { name: 'result', type: 'object', description: 'Auditable mood review result' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates confidence and override policy, then changes the existing per-user activeFacet owner.',
  execute: async (inputs, context) => {
    const decision = inputs.decision || inputs[0];
    const review = inputs.reviewContext || inputs[1];
    const username = context.username || context.userId || review?.username;
    if (!username || !decision || !review) throw new Error('Mood Persona Switch requires user, decision, and review context');
    const now = new Date().toISOString();
    const confidence = Number(decision.confidence || 0);
    const forcedBaseline = decision.forcedBaseline === true || review.forceBaseline === true;
    let skippedReason = decision.skipped ? decision.reason : undefined;
    if (!skippedReason && !review.eligible) skippedReason = review.ineligibleReason || 'Mood review is not eligible.';
    if (!skippedReason && !forcedBaseline && confidence < review.settings.minimumConfidence) {
      skippedReason = `Confidence ${confidence.toFixed(2)} is below ${review.settings.minimumConfidence.toFixed(2)}.`;
    }
    const candidateIds = new Set((review.candidates || []).map((candidate: any) => candidate.id));
    if (!skippedReason && !candidateIds.has(decision.selectedFacet)) skippedReason = 'Selected facet is unavailable or disabled.';

    let activeFacet = review.activeFacet;
    let changed = false;
    let previousFacet = review.activeFacet;
    if (!skippedReason) {
      const change = setActivePersonaFacet(
        username,
        decision.selectedFacet,
        'mood',
        forcedBaseline ? 'Mood idle cooldown' : decision.reason,
      );
      changed = change.changed;
      previousFacet = change.previousFacet;
      activeFacet = change.activeFacet;
    }
    const result = {
      changed,
      skipped: Boolean(skippedReason),
      skippedReason,
      previousFacet,
      activeFacet,
      selectedFacet: decision.selectedFacet,
      detectedMood: decision.detectedMood,
      confidence,
      reason: decision.reason,
      forcedBaseline,
      reviewedAt: now,
    };
    saveMoodState(username, {
      activeFacet,
      previousFacet,
      detectedMood: decision.detectedMood,
      confidence,
      reason: skippedReason || decision.reason,
      lastReviewedAt: now,
      lastChangedAt: changed ? now : undefined,
      lastTrigger: forcedBaseline ? 'idle-reset' : 'message-count',
    });
    audit({
      level: 'info',
      category: 'decision',
      event: changed ? 'mood_persona_changed' : 'mood_persona_reviewed',
      actor: 'mood',
      details: { username, ...result },
    });
    return { changed, activeFacet, result };
  },
});

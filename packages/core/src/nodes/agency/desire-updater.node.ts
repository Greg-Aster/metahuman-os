/**
 * Desire Updater Node
 *
 * Updates a desire's status and associated data.
 *
 * Inputs:
 *   - desire: Desire object
 *   - newStatus: DesireStatus
 *   - plan?: DesirePlan (optional)
 *   - review?: DesireReview (optional)
 *   - rejection?: { reason: string, rejectedBy: string } (optional)
 *
 * Outputs:
 *   - desire: Updated Desire object
 *   - success: boolean
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesireStatus, DesirePlan, DesireReview } from '../../agency/types.js';
import {
  saveDesireManifest,
  savePlanToFolder,
  saveOutcomeReviewToFolder,
  addScratchpadEntryToFolder,
} from '../../agency/storage.js';
import { audit } from '../../audit.js';

interface RejectionInput {
  reason: string;
  rejectedBy: 'system' | 'user' | 'review';
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Inputs come via NAMED handles from graph links (not positional indices!)
  // The graph executor maps edge.targetHandle -> inputs[handle]
  //
  // In planner graph (desire-planner.json):
  //   inputs.desire = {desire, found} from desire_loader (edge e-1-slot_0-7-desire)
  //   inputs.newStatus = {valid, plan, errors, warnings} from plan_validator (edge e-6-slot_0-7-newStatus)
  //
  // In reviewer graph (desire-reviewer.json):
  //   inputs.desire = {desire, found} from desire_loader
  //   inputs.review = {verdict, review, ...} from verdict node
  //
  // IMPORTANT: Graph executor uses named properties, not array indices!
  // inputs[0], inputs[1] etc. will be undefined - always use named properties.

  // Try named properties first, then fall back to positional for legacy compatibility
  const loaderOutput = (inputs.desire || inputs.slot_0 || inputs[0]) as { desire?: Desire; found?: boolean } | undefined;
  const validatorOutput = (inputs.newStatus || inputs.slot_1 || inputs[1]) as { valid?: boolean; plan?: DesirePlan } | undefined;
  const reviewerOutput = (inputs.review || inputs.slot_2 || inputs[2]) as { review?: DesireReview; verdict?: string } | undefined;

  // Extract desire from loader output OR from context (desire-planner agent passes desire in context)
  const contextDesire = (context as { desire?: Desire }).desire;
  const desire = loaderOutput?.desire || contextDesire;

  // Extract plan from validator output (planner graph) or from desire itself
  const plan = validatorOutput?.plan || desire?.plan;

  // Extract review from reviewer output or named input
  const review = reviewerOutput?.review || (inputs.review as DesireReview | undefined);
  const rejection = inputs.rejection as RejectionInput | undefined;

  // Status can come from:
  // 1. properties?.newStatus (set in the graph node definition)
  // 2. inputs.status (explicit status input)
  // 3. NOT from inputs.newStatus - that's used for validator output in current graphs
  // Note: inputs.newStatus is an object {valid, plan, ...} from plan_validator, not a status string
  const statusInput = typeof inputs.status === 'string' ? inputs.status : undefined;
  const newStatus = (properties?.newStatus || statusInput) as DesireStatus | undefined;
  const username = context.userId;

  if (!desire) {
    return {
      desire: null,
      success: false,
      error: 'No desire provided',
    };
  }

  try {
    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire = { ...desire };

    // Update status if provided
    if (newStatus && newStatus !== oldStatus) {
      updatedDesire.status = newStatus;
      updatedDesire.updatedAt = now;

      // Set completion time for terminal states
      if (['completed', 'rejected', 'abandoned', 'failed'].includes(newStatus)) {
        updatedDesire.completedAt = now;
      }

      // Add scratchpad entry for status change
      await addScratchpadEntryToFolder(updatedDesire.id, {
        type: 'status_change',
        timestamp: now,
        description: `Status changed from ${oldStatus} to ${newStatus}`,
        actor: 'system',
        data: {
          from: oldStatus,
          to: newStatus,
        },
      }, username);
    }

    // Attach plan if provided
    if (plan) {
      // If there's an existing plan, move it to history
      if (updatedDesire.plan) {
        if (!updatedDesire.planHistory) {
          updatedDesire.planHistory = [];
        }
        // Only add to history if not already there (avoid duplicates)
        const existingIds = updatedDesire.planHistory.map(p => p.id);
        if (!existingIds.includes(updatedDesire.plan.id)) {
          updatedDesire.planHistory.push(updatedDesire.plan);
        }
      }

      // Set the new plan
      updatedDesire.plan = plan;
      updatedDesire.updatedAt = now;

      // Clear the critique since it's been addressed by this new plan
      if (updatedDesire.userCritique) {
        updatedDesire.userCritique = undefined;
        updatedDesire.critiqueAt = undefined;
      }

      // Save plan to folder
      await savePlanToFolder(updatedDesire.id, plan, username);
      await addScratchpadEntryToFolder(updatedDesire.id, {
        type: 'plan_generated',
        timestamp: now,
        description: `Plan v${plan.version} generated with ${plan.steps?.length || 0} steps`,
        actor: 'llm',
        agentName: 'desire-planner',
        data: {
          planId: plan.id,
          version: plan.version,
          stepCount: plan.steps?.length || 0,
        },
      }, username);
    }

    // Attach review if provided
    if (review) {
      updatedDesire.review = review;
      updatedDesire.updatedAt = now;

      // Save review to folder
      // For outcome reviews, use the outcome review folder function
      if ('verdict' in review) {
        await saveOutcomeReviewToFolder(updatedDesire.id, review as unknown as import('../../agency/types.js').DesireOutcomeReview, username);
      }
      await addScratchpadEntryToFolder(updatedDesire.id, {
        type: 'review_completed',
        timestamp: now,
        description: `Review completed with verdict: ${(review as { verdict?: string }).verdict || 'N/A'}`,
        actor: 'llm',
        agentName: 'outcome-reviewer',
        data: {
          reviewId: review.id,
          verdict: (review as { verdict?: string }).verdict,
        },
      }, username);
    }

    // Add rejection to history if provided
    if (rejection) {
      if (!updatedDesire.rejectionHistory) {
        updatedDesire.rejectionHistory = [];
      }
      updatedDesire.rejectionHistory.push({
        rejectedAt: now,
        rejectedBy: rejection.rejectedBy,
        reason: rejection.reason,
        canRetry: rejection.rejectedBy === 'review', // Can retry if just review rejection
      });
      updatedDesire.updatedAt = now;

      // Add scratchpad entry for rejection
      await addScratchpadEntryToFolder(updatedDesire.id, {
        type: 'rejected',
        timestamp: now,
        description: `Rejected by ${rejection.rejectedBy}: ${rejection.reason}`,
        actor: rejection.rejectedBy === 'user' ? 'user' : 'system',
        data: {
          rejectedBy: rejection.rejectedBy,
          reason: rejection.reason,
        },
      }, username);
    }

    // Save desire manifest to folder
    await saveDesireManifest(updatedDesire, username);

    // Audit the update
    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_updated',
      actor: 'desire-updater',
      details: {
        desireId: updatedDesire.id,
        title: updatedDesire.title,
        oldStatus,
        newStatus: updatedDesire.status,
        hasPlan: !!plan,
        hasReview: !!review,
        hasRejection: !!rejection,
        username,
      },
    });

    return {
      desire: updatedDesire,
      success: true,
    };
  } catch (error) {
    return {
      desire: null,
      success: false,
      error: `Failed to update desire: ${(error as Error).message}`,
    };
  }
};

export const DesireUpdaterNode: NodeDefinition = defineNode({
  id: 'desire_updater',
  name: 'Update Desire',
  category: 'agency',
  description: 'Updates a desire status and associated data',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire to update' },
    { name: 'newStatus', type: 'string', optional: true, description: 'New status to set' },
    { name: 'plan', type: 'object', optional: true, description: 'Plan to attach' },
    { name: 'review', type: 'object', optional: true, description: 'Review to attach' },
    { name: 'rejection', type: 'object', optional: true, description: 'Rejection info' },
  ],
  outputs: [
    { name: 'desire', type: 'object', description: 'Updated desire' },
    { name: 'success', type: 'boolean', description: 'Whether update succeeded' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
  ],
  properties: {},
  execute,
});

export default DesireUpdaterNode;

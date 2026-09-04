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
import type {
  Desire,
  DesireStatus,
  DesirePlan,
  DesireReview,
  DesireGoalType,
  DesireMilestone,
  DesireGoalProgress,
  DesireOutcomeReview,
} from '../../agency/types.js';
import { statusToStage } from '../../agency/types.js';
import {
  saveDesireManifest,
  loadDesireFromFolder,
  savePlanToFolder,
  saveDesireReviewToFolder,
  addScratchpadEntryToFolder,
} from '../../agency/storage.js';
import { audit } from '../../audit.js';
import { applyDesireOutcomeReview } from '../../agency/desire-outcome-transition.js';

interface RejectionInput {
  reason: string;
  rejectedBy: 'system' | 'user' | 'review';
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const desireInput = inputs.desire as Desire | { desire?: Desire } | undefined;
  const desire = desireInput && 'desire' in desireInput
    ? desireInput.desire
    : desireInput as Desire | undefined;
  const plan = inputs.plan as DesirePlan | undefined;
  const review = inputs.review as DesireReview | undefined;
  const outcomeReview = (inputs.outcomeReview
    || (inputs.review as DesireOutcomeReview | undefined)) as DesireOutcomeReview | undefined;
  const rejection = inputs.rejection as RejectionInput | undefined;

  // Status can come from:
  // 1. properties?.newStatus (set in the graph node definition)
  // 2. inputs.newStatus (explicit status input)
  const statusInput = typeof inputs.newStatus === 'string' ? inputs.newStatus : undefined;
  const newStatus = (properties?.newStatus || statusInput) as DesireStatus | undefined;
  const username = typeof context.username === 'string' ? context.username.trim() : '';

  if (!desire) {
    return {
      desire: null,
      success: false,
      error: 'No desire provided',
    };
  }
  if (!username) {
    throw new Error('Desire update requires an authenticated profile username');
  }
  if (inputs.valid === false) {
    return {
      desire: null,
      success: false,
      error: 'Refusing to persist an invalid desire plan',
    };
  }

  if (properties?.applyOutcomePolicy === true) {
    if (!outcomeReview) {
      throw new Error('Outcome transition requires a validated outcomeReview input');
    }
    if (!username) {
      throw new Error('Outcome transition requires a user context');
    }
    const applied = await applyDesireOutcomeReview(desire, outcomeReview, username);
    return {
      desire: applied.desire,
      outcomeReview: applied.review,
      verdict: applied.review.verdict,
      action: applied.action,
      summary: applied.summary,
      success: true,
    };
  }

  try {
    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire = { ...desire };

    // Update status if provided
    if (newStatus && newStatus !== oldStatus) {
      updatedDesire.status = newStatus;
      updatedDesire.currentStage = statusToStage(newStatus);
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

      // Apply long-running goal fields from plan generator output
      if (inputs.goalType) {
        updatedDesire.goalType = inputs.goalType as DesireGoalType;
      }
      if (inputs.completionCriteria) {
        updatedDesire.completionCriteria = inputs.completionCriteria as string;
      }
      if (Array.isArray(inputs.milestones) && inputs.milestones.length > 0) {
        updatedDesire.milestones = inputs.milestones as DesireMilestone[];
      }
      if (inputs.goalProgress) {
        updatedDesire.goalProgress = inputs.goalProgress as DesireGoalProgress;
      }

      // Save plan to folder
      await savePlanToFolder(updatedDesire.id, plan, username);

      // Log milestone info for long-running goals
      const milestoneInfo = updatedDesire.goalType === 'long_running' && updatedDesire.milestones
        ? `, ${updatedDesire.milestones.length} milestones`
        : '';

      await addScratchpadEntryToFolder(updatedDesire.id, {
        type: 'plan_generated',
        timestamp: now,
        description: `Plan v${plan.version} generated with ${plan.steps?.length || 0} steps${milestoneInfo}. Goal type: ${updatedDesire.goalType || 'one_time'}`,
        actor: 'llm',
        agentName: 'desire-planner',
        data: {
          planId: plan.id,
          version: plan.version,
          stepCount: plan.steps?.length || 0,
          goalType: updatedDesire.goalType,
          completionCriteria: updatedDesire.completionCriteria,
          milestoneCount: updatedDesire.milestones?.length,
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
        await saveDesireReviewToFolder(updatedDesire.id, review as unknown as import('../../agency/types.js').DesireOutcomeReview, username);
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

    // Scratchpad writes update the manifest summary as they persist their
    // individual entry files. Preserve that canonical summary when attaching
    // the plan and lifecycle state in the final manifest write.
    const currentManifest = await loadDesireFromFolder(updatedDesire.id, username);
    if (currentManifest?.scratchpad) updatedDesire.scratchpad = currentManifest.scratchpad;

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
    { name: 'valid', type: 'boolean', optional: true, description: 'Whether the supplied plan passed validation' },
    { name: 'goalType', type: 'string', optional: true, description: 'Validated desire goal type' },
    { name: 'completionCriteria', type: 'string', optional: true, description: 'Validated completion criteria' },
    { name: 'milestones', type: 'array', optional: true, description: 'Validated long-running milestones' },
    { name: 'goalProgress', type: 'object', optional: true, description: 'Validated long-running goal progress' },
    { name: 'review', type: 'object', optional: true, description: 'Review to attach' },
    { name: 'outcomeReview', type: 'object', optional: true, description: 'Validated execution outcome review' },
    { name: 'rejection', type: 'object', optional: true, description: 'Rejection info' },
  ],
  outputs: [
    { name: 'desire', type: 'object', description: 'Updated desire' },
    { name: 'outcomeReview', type: 'object', optional: true, description: 'Applied outcome review' },
    { name: 'verdict', type: 'string', optional: true, description: 'Applied outcome verdict' },
    { name: 'action', type: 'string', optional: true, description: 'Canonical transition action' },
    { name: 'summary', type: 'string', optional: true, description: 'Human-readable transition summary' },
    { name: 'success', type: 'boolean', description: 'Whether update succeeded' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
  ],
  properties: {
    applyOutcomePolicy: false,
    newStatus: '',
  },
  propertySchemas: {
    newStatus: {
      type: 'select',
      default: '',
      label: 'New Status',
      description: 'Optional explicit lifecycle status applied with this update',
      options: [
        '', 'nascent', 'pending', 'evaluating', 'planning', 'questioning',
        'reviewing', 'awaiting_approval', 'approved', 'executing',
        'awaiting_review', 'completed', 'rejected', 'abandoned', 'failed',
      ],
    },
    applyOutcomePolicy: {
      type: 'boolean',
      default: false,
      label: 'Apply Outcome Policy',
      description: 'Apply the canonical Agency outcome transition to a validated outcome review',
    },
  },
  execute,
});

export default DesireUpdaterNode;

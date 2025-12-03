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
import { saveDesire, moveDesire, savePlan, saveReview } from '../../agency/storage.js';
import { audit } from '../../audit.js';

interface RejectionInput {
  reason: string;
  rejectedBy: 'system' | 'user' | 'review';
}

const execute: NodeExecutor = async (inputs, context, _properties) => {
  const desire = inputs.desire as Desire | undefined;
  const newStatus = inputs.newStatus as DesireStatus | undefined;
  const plan = inputs.plan as DesirePlan | undefined;
  const review = inputs.review as DesireReview | undefined;
  const rejection = inputs.rejection as RejectionInput | undefined;
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
    }

    // Attach plan if provided
    if (plan) {
      updatedDesire.plan = plan;
      updatedDesire.updatedAt = now;

      // Save plan separately
      await savePlan(plan, username);
    }

    // Attach review if provided
    if (review) {
      updatedDesire.review = review;
      updatedDesire.updatedAt = now;

      // Save review separately
      await saveReview(review, username);
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
    }

    // Move or save based on status change
    if (newStatus && newStatus !== oldStatus) {
      await moveDesire(updatedDesire, oldStatus, newStatus, username);
    } else {
      await saveDesire(updatedDesire, username);
    }

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

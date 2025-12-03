/**
 * Approval Queue Node
 *
 * Adds a desire to the approval queue for user review.
 *
 * Inputs:
 *   - desire: Desire object (with plan attached)
 *   - review: DesireReview object
 *
 * Outputs:
 *   - approvalId: string
 *   - queued: boolean
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesireReview } from '../../agency/types.js';
import { queueForApproval, type SkillManifest } from '../../skills.js';
import { audit } from '../../audit.js';

const execute: NodeExecutor = async (inputs, context, _properties) => {
  const desire = inputs.desire as Desire | undefined;
  const review = inputs.review as DesireReview | undefined;
  const username = context.userId;

  if (!desire || !desire.plan) {
    return {
      approvalId: null,
      queued: false,
      error: 'Desire or plan missing',
    };
  }

  try {
    // Build skill manifest for the approval queue
    const manifest: SkillManifest = {
      id: 'desire_execute',
      name: `Desire: ${desire.title}`,
      description: desire.description,
      category: 'agent',
      risk: desire.plan.estimatedRisk as 'low' | 'medium' | 'high',
      cost: 'cheap',
      minTrustLevel: 'supervised_auto',
      requiresApproval: true,
      inputs: {},
      outputs: {},
    };

    // Queue as a desire approval (extends skill approval queue)
    const approvalId = await queueForApproval(
      'desire_execute',
      {
        desireId: desire.id,
        reason: desire.reason,
        plan: desire.plan,
        review: review,
      },
      manifest
    );

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_queued_for_approval',
      actor: 'approval-queue',
      details: {
        desireId: desire.id,
        title: desire.title,
        approvalId,
        risk: desire.plan.estimatedRisk,
        username,
      },
    });

    return {
      approvalId,
      queued: true,
    };
  } catch (error) {
    return {
      approvalId: null,
      queued: false,
      error: `Failed to queue for approval: ${(error as Error).message}`,
    };
  }
};

export const ApprovalQueueNode: NodeDefinition = defineNode({
  id: 'approval_queue',
  name: 'Queue for Approval',
  category: 'agency',
  description: 'Adds a desire to the approval queue for user review',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire with plan attached' },
    { name: 'review', type: 'object', optional: true, description: 'Review object' },
  ],
  outputs: [
    { name: 'approvalId', type: 'string', description: 'ID in approval queue' },
    { name: 'queued', type: 'boolean', description: 'Whether queuing succeeded' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
  ],
  properties: {},
  execute,
});

export default ApprovalQueueNode;

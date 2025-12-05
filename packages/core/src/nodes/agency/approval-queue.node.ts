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
import { saveDesireManifest, addScratchpadEntryToFolder } from '../../agency/storage.js';

const execute: NodeExecutor = async (inputs, context, _properties) => {
  // Inputs come via slot positions from graph links:
  // slot 0: {desire, found} from desire_loader
  // slot 1: {verdict, review, autoApprove, reasoning} from verdict node
  const slot0 = inputs[0] as { desire?: Desire; found?: boolean } | undefined;
  const slot1 = inputs[1] as { review?: DesireReview; verdict?: string } | undefined;

  // Extract desire from slot 0 (desire_loader output) or context
  const desire = slot0?.desire || (context as { desire?: Desire }).desire || (inputs.desire as Desire | undefined);
  // Extract review from slot 1 (verdict output) or named input
  const review = slot1?.review || (inputs.review as DesireReview | undefined);
  const username = context.userId;

  console.log('[approval-queue] Input slot 0:', JSON.stringify(slot0)?.substring(0, 200));
  console.log('[approval-queue] Input slot 1:', JSON.stringify(slot1)?.substring(0, 200));
  console.log('[approval-queue] Desire found:', !!desire);
  console.log('[approval-queue] Desire has plan:', !!desire?.plan);

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

    // Update desire status to 'awaiting_approval'
    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire: Desire = {
      ...desire,
      status: 'awaiting_approval',
      updatedAt: now,
    };

    // Save updated desire to folder
    await saveDesireManifest(updatedDesire, username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(desire.id, {
      type: 'approval_requested',
      timestamp: now,
      description: `Queued for approval (approvalId: ${approvalId})`,
      actor: 'system',
      data: {
        approvalId,
        oldStatus,
        risk: desire.plan.estimatedRisk,
      },
    }, username);

    console.log('[approval-queue] Desire status updated to awaiting_approval');

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

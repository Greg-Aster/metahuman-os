/**
 * Scratchpad Writer Node
 *
 * Records events to a desire's scratchpad for auditing and debugging.
 * Scratchpad entries track the lifecycle of desire execution.
 *
 * Inputs:
 *   - desire: Desire object (or object with desireId)
 *   - data: Data to record (execution result, operator response, etc.)
 *
 * Outputs:
 *   - success: boolean
 *   - entryId: string (the created scratchpad entry filename)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, DesireScratchpadEntry, DesireScratchpadEntryType } from '../../agency/types.js';
import { addScratchpadEntryToFolder } from '../../agency/storage.js';
import { audit } from '../../audit.js';

/**
 * Create a scratchpad entry from input data
 */
function createScratchpadEntry(
  entryType: DesireScratchpadEntryType,
  data: unknown,
  properties?: { includeOperatorResponse?: boolean }
): DesireScratchpadEntry {
  const now = new Date().toISOString();

  // Build description based on data type
  let description: string;
  let entryData: Record<string, unknown> = {};

  if (typeof data === 'string') {
    description = data;
  } else if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;

    // Extract common fields into data
    if (d.success !== undefined) {
      entryData.success = d.success;
    }
    if (d.error) {
      entryData.error = d.error;
    }

    // Handle operator response
    if (properties?.includeOperatorResponse && d.operatorResponse) {
      const opResp = d.operatorResponse as Record<string, unknown>;
      entryData.operatorReasoning = opResp.reasoning;
      entryData.operatorActions = opResp.actions;
      if (opResp.scratchpad) {
        entryData.operatorScratchpad = opResp.scratchpad;
      }
    }

    // Handle execution results
    if (d.execution) {
      const exec = d.execution as Record<string, unknown>;
      entryData.stepsCompleted = exec.stepsCompleted;
      entryData.stepsTotal = exec.stepsTotal;
      entryData.executionStatus = exec.status;
    }

    // Handle outcome review
    if (d.outcomeReview) {
      const review = d.outcomeReview as Record<string, unknown>;
      entryData.verdict = review.verdict;
      entryData.successScore = review.successScore;
      entryData.lessonsLearned = review.lessonsLearned;
    }

    // Build description from available data
    if (d.result) {
      description = typeof d.result === 'string' ? d.result : JSON.stringify(d.result, null, 2);
    } else if (d.description) {
      description = String(d.description);
    } else if (d.content) {
      description = String(d.content);
    } else if (d.reasoning) {
      description = String(d.reasoning);
    } else {
      description = JSON.stringify(d, null, 2);
    }
  } else {
    description = String(data);
  }

  return {
    type: entryType,
    timestamp: now,
    description,
    actor: 'agent',
    agentName: 'scratchpad-writer-node',
    data: Object.keys(entryData).length > 0 ? entryData : undefined,
  };
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Inputs from graph:
  // slot 0: desire or object with desireId
  // slot 1: data to record (execution result, operator response, etc.)
  const slot0 = inputs[0] as { desire?: Desire; desireId?: string } | Desire | undefined;
  const slot1 = inputs[1] as unknown;

  // Extract desire ID
  let desireId: string | undefined;
  if (slot0) {
    if ('desireId' in slot0) {
      desireId = slot0.desireId;
    } else if ('desire' in slot0 && slot0.desire) {
      desireId = slot0.desire.id;
    } else if ('id' in slot0) {
      desireId = (slot0 as Desire).id;
    }
  }

  if (!desireId) {
    return {
      success: false,
      error: 'No desire ID provided',
    };
  }

  // Get entry type from properties
  const entryType = (properties?.eventType || 'execution') as DesireScratchpadEntryType;
  const includeOperatorResponse = properties?.includeOperatorResponse ?? true;

  // Create the scratchpad entry
  const entry = createScratchpadEntry(
    entryType,
    slot1 || slot0,
    { includeOperatorResponse }
  );

  const username = context.userId;

  try {
    console.log(`[scratchpad-writer] 📝 Recording ${entryType} to desire ${desireId}`);

    // Write to folder-based storage
    await addScratchpadEntryToFolder(desireId, entry, username);

    // Audit the write
    audit({
      category: 'agent',
      level: 'info',
      event: 'scratchpad_entry_added',
      actor: 'scratchpad-writer-node',
      details: {
        desireId,
        entryType,
        descriptionLength: entry.description.length,
        hasData: !!entry.data,
      },
    });

    console.log(`[scratchpad-writer]    ✅ Entry recorded`);

    return {
      success: true,
      entryId: `${entryType}-${Date.now()}`,
      entryType,
      desireId,
    };
  } catch (error) {
    console.error(`[scratchpad-writer] ❌ Error:`, error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const ScratchpadWriterNode: NodeDefinition = defineNode({
  id: 'scratchpad_writer',
  name: 'Scratchpad Writer',
  category: 'cognitive',
  description: 'Records events to a desire scratchpad for auditing',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire object or object with desireId' },
    { name: 'data', type: 'any', description: 'Data to record (execution result, response, etc.)' },
  ],
  outputs: [
    { name: 'success', type: 'boolean', description: 'Whether write succeeded' },
    { name: 'entryId', type: 'string', optional: true, description: 'Created entry ID' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
  ],
  properties: {
    eventType: 'execution',
    includeOperatorResponse: true,
  },
  propertySchemas: {
    eventType: {
      type: 'select',
      default: 'execution',
      label: 'Event Type',
      description: 'Type of scratchpad entry',
      options: [
        'execution',
        'step_result',
        'operator_thought',
        'operator_action',
        'outcome_review',
        'user_feedback',
        'error',
        'note',
      ],
    },
    includeOperatorResponse: {
      type: 'boolean',
      default: true,
      label: 'Include Operator Response',
      description: 'Whether to include operator reasoning/actions in data',
    },
  },
  execute,
});

export default ScratchpadWriterNode;

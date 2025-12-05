/**
 * Desire Loader Node
 *
 * Loads a desire by ID from agency storage.
 *
 * Inputs:
 *   - desireId: string - The ID of the desire to load
 *
 * Outputs:
 *   - desire: Desire object or null if not found
 *   - found: boolean
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import {
  loadDesireFromFolder,
  listDesiresFromFolders,
} from '../../agency/storage.js';
import type { DesireStatus } from '../../agency/types.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Check if desire is already provided in context (e.g., from planner passing to reviewer)
  // This allows the reviewer graph to receive the desire WITH the plan attached
  // before it's persisted to storage
  if (context.desire) {
    return {
      desire: context.desire,
      found: true,
    };
  }

  // Extract inputs from slot 0 or direct properties
  const slot0 = inputs[0] as { desireId?: string; status?: DesireStatus } | string | undefined;

  let desireId: string | undefined;
  let filterStatus: DesireStatus | undefined;

  if (typeof slot0 === 'string') {
    desireId = slot0;
  } else if (slot0?.desireId) {
    desireId = slot0.desireId;
  } else {
    desireId = context.desireId as string | undefined;
  }

  // Check for status filter (load desires by status)
  filterStatus = (properties?.filterStatus as DesireStatus) ||
    (typeof slot0 !== 'string' ? slot0?.status : undefined);

  const username = context.username as string | undefined;

  // If filtering by status, return list of desires
  if (filterStatus && !desireId) {
    console.log(`[desire-loader] Loading desires with status: ${filterStatus}`);

    // Load all desires from folders and filter by status
    const allDesires = await listDesiresFromFolders(username);
    const desires = allDesires.filter(d => d.status === filterStatus);

    return {
      desire: desires[0] || null,
      desires,
      found: desires.length > 0,
      count: desires.length,
    };
  }

  // Single desire load by ID
  if (!desireId) {
    return {
      desire: null,
      found: false,
      error: 'No desireId provided',
    };
  }

  console.log(`[desire-loader] Loading desire: ${desireId}`);

  // Load desire from folder
  const desire = await loadDesireFromFolder(desireId, username);

  return {
    desire,
    found: desire !== null,
  };
};

export const DesireLoaderNode: NodeDefinition = defineNode({
  id: 'desire_loader',
  name: 'Load Desire',
  category: 'agency',
  description: 'Loads desire(s) by ID or status from folder-based agency storage',
  inputs: [
    { name: 'desireId', type: 'string', optional: true, description: 'ID of the desire to load' },
    { name: 'status', type: 'string', optional: true, description: 'Filter by status (returns list)' },
  ],
  outputs: [
    { name: 'desire', type: 'object', description: 'The loaded Desire object (first if filtered)' },
    { name: 'desires', type: 'array', optional: true, description: 'List of desires if filtered by status' },
    { name: 'found', type: 'boolean', description: 'Whether desire(s) were found' },
    { name: 'count', type: 'number', optional: true, description: 'Count of desires found' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
  ],
  properties: {
    filterStatus: '',
  },
  propertySchemas: {
    filterStatus: {
      type: 'select',
      default: '',
      label: 'Filter by Status',
      description: 'Load all desires with this status',
      options: [
        { value: '', label: 'None (load by ID)' },
        { value: 'nascent', label: 'Nascent' },
        { value: 'pending', label: 'Pending' },
        { value: 'planning', label: 'Planning' },
        { value: 'reviewing', label: 'Reviewing' },
        { value: 'approved', label: 'Approved' },
        { value: 'executing', label: 'Executing' },
        { value: 'completed', label: 'Completed' },
      ],
    },
  },
  execute,
});

export default DesireLoaderNode;

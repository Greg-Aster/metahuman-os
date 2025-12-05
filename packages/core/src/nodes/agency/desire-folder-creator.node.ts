/**
 * Desire Folder Creator Node
 *
 * Creates the folder structure for a new desire including:
 * - Main desire folder: agency/desires/<desire-id>/
 * - scratchpad.json: Initial metadata and stage tracking
 * - desire.json: Core desire data (manifest)
 *
 * Inputs:
 *   - desire: Desire object with id, title, description
 *
 * Outputs:
 *   - desire: Updated desire with folderPath
 *   - folderPath: Path to created folder
 *   - success: boolean
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire } from '../../agency/types.js';
import { initializeDesireMetrics, initializeScratchpadSummary } from '../../agency/types.js';
import { createDesireFolder, saveDesireManifest } from '../../agency/storage.js';
import { audit } from '../../audit.js';

interface DesireInput {
  id: string;
  title: string;
  description: string;
  reason?: string;
  source?: string;
  risk?: string;
  [key: string]: unknown;
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const slot0 = inputs[0] as { desire?: DesireInput } | DesireInput | undefined;

  // Extract desire from input
  const desireInput = (slot0 as { desire?: DesireInput })?.desire || slot0 as DesireInput;

  if (!desireInput?.id || !desireInput?.title) {
    return {
      desire: null,
      folderPath: null,
      success: false,
      error: 'Desire must have id and title',
    };
  }

  const username = context.username || 'anonymous';
  const createScratchpad = properties?.createScratchpad !== false;
  const createManifest = properties?.createManifest !== false;

  console.log(`[desire-folder-creator] Creating folder for desire: ${desireInput.id}`);

  try {
    // Create folder structure
    const folderPath = await createDesireFolder(desireInput.id, username);

    // Build initial scratchpad using helper
    const now = new Date().toISOString();
    const scratchpad = initializeScratchpadSummary();

    // Build full desire object using helper for metrics
    const desire: Desire = {
      id: desireInput.id,
      title: desireInput.title,
      description: desireInput.description || '',
      reason: desireInput.reason || '',
      status: 'nascent',
      source: (desireInput.source as Desire['source']) || 'persona_goal',
      strength: 0.5,
      baseWeight: 1.0,
      threshold: 0.7,
      decayRate: 0.03,
      lastReviewedAt: now,
      reinforcements: 0,
      runCount: 0,
      risk: (desireInput.risk as Desire['risk']) || 'medium',
      requiredTrustLevel: 'supervised_auto',
      createdAt: now,
      updatedAt: now,
      folderPath,
      scratchpad,
      metrics: initializeDesireMetrics(),
    };

    // Save manifest
    if (createManifest) {
      await saveDesireManifest(desire, username);
    }

    // Log creation
    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_folder_created',
      actor: 'desire-folder-creator',
      details: {
        desireId: desire.id,
        title: desire.title,
        folderPath,
        username,
      },
    });

    console.log(`[desire-folder-creator] ✅ Created folder at: ${folderPath}`);

    return {
      desire,
      folderPath,
      success: true,
      scratchpad,
    };
  } catch (error) {
    console.error(`[desire-folder-creator] ❌ Error:`, error);
    return {
      desire: desireInput,
      folderPath: null,
      success: false,
      error: (error as Error).message,
    };
  }
};

export const DesireFolderCreatorNode: NodeDefinition = defineNode({
  id: 'desire_folder_creator',
  name: 'Create Desire Folder',
  category: 'agency',
  description: 'Creates folder structure and initial scratchpad for a new desire',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire data to create folder for' },
  ],
  outputs: [
    { name: 'desire', type: 'object', description: 'Desire with folderPath populated' },
    { name: 'folderPath', type: 'string', description: 'Path to created folder' },
    { name: 'success', type: 'boolean', description: 'Whether folder was created' },
    { name: 'scratchpad', type: 'object', description: 'Initial scratchpad data' },
    { name: 'error', type: 'string', optional: true, description: 'Error message if failed' },
  ],
  properties: {
    createScratchpad: true,
    createManifest: true,
  },
  propertySchemas: {
    createScratchpad: {
      type: 'boolean',
      default: true,
      label: 'Create Scratchpad',
      description: 'Initialize scratchpad.json in folder',
    },
    createManifest: {
      type: 'boolean',
      default: true,
      label: 'Create Manifest',
      description: 'Save desire.json manifest file',
    },
  },
  execute,
});

export default DesireFolderCreatorNode;

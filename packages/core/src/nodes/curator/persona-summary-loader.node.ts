/**
 * Persona Summary Loader Node
 * Loads and formats persona data for curator context
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getProfilePaths } from '../../paths.js';

const execute: NodeExecutor = async (_inputs, context, _properties) => {
  if (!context.userId) {
    throw new Error('Curator requires a userId to load persona context');
  }

  const profilePaths = getProfilePaths(context.userId);
  const personaCorePath = path.join(profilePaths.persona, 'core.json');
  if (!fs.existsSync(personaCorePath)) {
    throw new Error(`Curator persona context is missing for user ${context.userId}`);
  }

  let personaData: any;
  try {
    personaData = JSON.parse(fs.readFileSync(personaCorePath, 'utf-8'));
  } catch (error) {
    throw new Error(`Curator persona context is invalid for user ${context.userId}: ${(error as Error).message}`);
  }

  if (!personaData || typeof personaData !== 'object' || Array.isArray(personaData)) {
    throw new Error(`Curator persona context must be an object for user ${context.userId}`);
  }

  const personaSummary = `
Name: ${personaData.identity?.name || context.userId}
Role: ${personaData.identity?.role || 'User'}
Communication Style: ${personaData.personality?.communicationStyle || 'Natural and conversational'}
Core Values: ${personaData.coreValues?.join(', ') || 'Not specified'}
Interests: ${personaData.interests?.join(', ') || 'Various topics'}
`.trim();

  return {
    personaSummary,
  };
};

export const PersonaSummaryLoaderNode: NodeDefinition = defineNode({
  id: 'persona_summary_loader',
  name: 'Persona Summary Loader',
  category: 'curator',
  inputs: [],
  outputs: [
    { name: 'personaSummary', type: 'string', description: 'Formatted persona summary' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Loads and formats persona data for curator context',
  execute,
});

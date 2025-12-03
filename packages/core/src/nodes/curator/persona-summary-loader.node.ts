/**
 * Persona Summary Loader Node
 * Loads and formats persona data for curator context
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getProfilePaths } from '../../index.js';

const execute: NodeExecutor = async (_inputs, context, _properties) => {
  if (!context.userId) {
    return {
      personaSummary: 'User: unknown',
    };
  }

  const profilePaths = getProfilePaths(context.userId);
  const personaCorePath = path.join(profilePaths.persona, 'core.json');
  let personaSummary = `User: ${context.userId}`;

  try {
    if (fs.existsSync(personaCorePath)) {
      const personaData = JSON.parse(fs.readFileSync(personaCorePath, 'utf-8'));
      personaSummary = `
Name: ${personaData.identity?.name || context.userId}
Role: ${personaData.identity?.role || 'User'}
Communication Style: ${personaData.personality?.communicationStyle || 'Natural and conversational'}
Core Values: ${personaData.coreValues?.join(', ') || 'Not specified'}
Interests: ${personaData.interests?.join(', ') || 'Various topics'}
`.trim();
    }
  } catch (error) {
    console.warn('[PersonaSummaryLoader] Could not load persona, using minimal summary');
  }

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

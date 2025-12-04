/**
 * Persona Formatter Node
 * Formats persona data for LLM prompts
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const persona = inputs.persona ?? inputs[0];
  const includeValues = properties?.includeValues ?? true;
  const includeGoals = properties?.includeGoals ?? true;
  const includePersonality = properties?.includePersonality ?? true;

  if (!persona) {
    return {
      formatted: '',
      error: 'No persona provided',
    };
  }

  const sections: string[] = [];

  // Format identity
  if (persona.identity) {
    const id = persona.identity;
    sections.push(`## Identity\n- Name: ${id.name || 'Unknown'}\n- Role: ${id.role || 'AI Assistant'}`);
  }

  // Format personality
  if (includePersonality && persona.personality) {
    const traits = persona.personality.traits;
    if (traits && Object.keys(traits).length > 0) {
      const traitList = Object.entries(traits)
        .map(([trait, value]) => `- ${trait}: ${value}`)
        .join('\n');
      sections.push(`## Personality Traits\n${traitList}`);
    }
  }

  // Format values
  if (includeValues && persona.values) {
    const core = persona.values.core;
    if (Array.isArray(core) && core.length > 0) {
      const valueList = core.map((v: { name?: string; description?: string }) =>
        `- ${v.name || 'Value'}: ${v.description || ''}`
      ).join('\n');
      sections.push(`## Core Values\n${valueList}`);
    }
  }

  // Format goals
  if (includeGoals && persona.goals) {
    const allGoals: string[] = [];

    if (persona.goals.shortTerm?.length > 0) {
      const short = persona.goals.shortTerm
        .filter((g: { status?: string }) => g.status === 'active')
        .map((g: { goal?: string }) => `- [short] ${g.goal || 'Unknown goal'}`)
        .slice(0, 3);
      allGoals.push(...short);
    }

    if (persona.goals.midTerm?.length > 0) {
      const mid = persona.goals.midTerm
        .filter((g: { status?: string }) => g.status === 'active')
        .map((g: { goal?: string }) => `- [mid] ${g.goal || 'Unknown goal'}`)
        .slice(0, 2);
      allGoals.push(...mid);
    }

    if (persona.goals.longTerm?.length > 0) {
      const long = persona.goals.longTerm
        .filter((g: { status?: string }) => g.status === 'active')
        .map((g: { goal?: string }) => `- [long] ${g.goal || 'Unknown goal'}`)
        .slice(0, 2);
      allGoals.push(...long);
    }

    if (allGoals.length > 0) {
      sections.push(`## Active Goals\n${allGoals.join('\n')}`);
    }
  }

  return {
    formatted: sections.join('\n\n'),
    sectionCount: sections.length,
  };
};

export const PersonaFormatterNode: NodeDefinition = defineNode({
  id: 'persona_formatter',
  name: 'Persona Formatter',
  category: 'cognitive',
  inputs: [
    { name: 'persona', type: 'object', description: 'Persona object to format' },
  ],
  outputs: [
    { name: 'formatted', type: 'string', description: 'Formatted persona text' },
    { name: 'sectionCount', type: 'number', description: 'Number of sections' },
  ],
  properties: {
    includeValues: true,
    includeGoals: true,
    includePersonality: true,
  },
  propertySchemas: {
    includeValues: {
      type: 'toggle',
      default: true,
      label: 'Include Values',
    },
    includeGoals: {
      type: 'toggle',
      default: true,
      label: 'Include Goals',
    },
    includePersonality: {
      type: 'toggle',
      default: true,
      label: 'Include Personality',
    },
  },
  description: 'Formats persona data for LLM prompts',
  execute,
});

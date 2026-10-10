/**
 * Persona Loader Node
 * Loads persona core configuration
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getActiveFacet, loadPersonaWithFacet } from '../../identity.js';
import { PersonaFormatterNode } from '../cognitive/persona-formatter.node.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  const persona = loadPersonaWithFacet();
  const activeFacet = getActiveFacet();

  // Inactive persona is an explicit operating mode, not a load failure.
  if (persona === null) {
    return {
      success: true,
      persona: null,
      identity: null,
      personality: null,
      values: null,
      goals: null,
      activeFacet,
      inactive: true,
      formatted: '', taskFormatted: '', conversationFormatted: '',
    };
  }

  const routing = inputs.routingAnalysis;
  const routed = Array.isArray(routing?.taskContext) && Array.isArray(routing?.conversationContext);
  const sections = (entries: string[]) => [...new Set(entries.filter(entry => entry.startsWith('persona.')).map(entry => entry.slice(8)))];
  const format = async (selected?: string[]) => properties?.formatContext === true
    ? (await PersonaFormatterNode.execute({ persona, ...(selected ? { sections: selected } : {}) }, context, properties)).formatted
    : '';
  const taskFormatted = routed ? await format(sections(routing.taskContext)) : '';
  const conversationFormatted = routed ? await format(sections(routing.conversationContext)) : '';
  const formatted = routed ? await format(sections([...routing.taskContext, ...routing.conversationContext])) : await format();

  return {
    success: true,
    persona,
    identity: persona.identity,
    personality: persona.personality,
    values: persona.values,
    goals: persona.goals,
    activeFacet,
    inactive: false,
    formatted, taskFormatted, conversationFormatted,
  };
};

export const PersonaLoaderNode: NodeDefinition = defineNode({
  id: 'persona_loader',
  name: 'Persona Loader',
  category: 'persona',
  inputs: [{ name: 'routingAnalysis', type: 'object', optional: true, description: 'Intent-selected persona sections for task and conversation' }],
  outputs: [
    { name: 'persona', type: 'object', description: 'Full persona object (null if inactive)' },
    { name: 'formatted', type: 'string', description: 'Selected persona sections formatted for model context, when enabled' },
    { name: 'taskFormatted', type: 'string', description: 'Persona sections selected for task decisions' },
    { name: 'conversationFormatted', type: 'string', description: 'Persona sections selected for conversation' },
    { name: 'identity', type: 'object', description: 'Identity data' },
    { name: 'personality', type: 'object', description: 'Personality traits' },
    { name: 'values', type: 'object', description: 'Core values' },
    { name: 'goals', type: 'object', description: 'Goals' },
    { name: 'activeFacet', type: 'string', description: 'Active facet' },
    { name: 'inactive', type: 'boolean', description: 'True if persona is inactive (LoRA-only mode)' },
    { name: 'success', type: 'boolean', description: 'Whether persona loading completed' },
  ],
  properties: { formatContext: false, includeIdentity: true, includeBackground: true, includeValues: true, includeGoals: true, includePersonality: true },
  propertySchemas: {
    includeIdentity: { type: 'toggle', default: true, label: 'Include Identity' },
    includeBackground: { type: 'toggle', default: true, label: 'Include Background' },
    formatContext: { type: 'toggle', default: false, label: 'Format Model Context', description: 'Produce formatted persona text as well as the full persona object' },
    includeValues: { type: 'toggle', default: true, label: 'Include Values' },
    includeGoals: { type: 'toggle', default: true, label: 'Include Goals' },
    includePersonality: { type: 'toggle', default: true, label: 'Include Personality' },
  },
  description: 'Loads persona core configuration',
  execute,
});

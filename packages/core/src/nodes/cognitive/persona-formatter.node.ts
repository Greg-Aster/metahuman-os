/**
 * Persona Formatter Node
 * Formats persona data for LLM prompts
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { PersonaCore } from '../../identity.js';
import {
  getActivePersonaGoals,
  getPersonaBackground,
  getPersonaTraitDescriptions,
  getPersonaValueDescriptions,
} from '../../persona-summary.js';

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const rawPersona = Object.prototype.hasOwnProperty.call(inputs, 'persona')
    ? inputs.persona
    : inputs[0];
  const selected = Array.isArray(inputs.sections) ? inputs.sections : null;
  const include = (section: string) => selected ? selected.includes(section) : (properties?.[`include${section[0].toUpperCase()}${section.slice(1)}`] ?? true);

  // Null persona means inactive/LoRA-only mode - return empty string (no error)
  if (rawPersona === null) {
    return {
      formatted: '',
      sectionCount: 0,
      inactive: true,
    };
  }
  if (!rawPersona || typeof rawPersona !== 'object' || Array.isArray(rawPersona)) {
    throw new Error('Persona Formatter requires the canonical persona object');
  }
  const persona = rawPersona as PersonaCore;
  const name = nonEmptyString(persona.identity?.name);
  if (!name) throw new Error('Persona Formatter requires persona.identity.name');

  const sections: string[] = [];

  // Format identity
  const role = nonEmptyString(persona.identity?.role);
  const purpose = nonEmptyString(persona.identity?.purpose);
  if (include('identity')) sections.push(`## Identity\n- Name: ${name}${role ? `\n- Role: ${role}` : ''}${purpose ? `\n- Purpose: ${purpose}` : ''}`);
  const background = getPersonaBackground(persona);
  if (include('background') && background) sections.push(`## Background\n${background}`);

  // Format personality
  if (include('personality')) {
    const style = persona.personality?.communicationStyle;
    const writing = persona.writingStyle as Record<string, unknown> | undefined;
    const descriptions = Object.entries({
      Tone: style?.tone?.join(', '),
      Humor: style?.humor,
      Formality: style?.formality,
      Verbosity: style?.verbosity,
      Emphasis: style?.emphasis,
      Vocabulary: style?.vocabularyLevel,
      Pronouns: style?.preferredPronouns,
      Narrative: persona.personality?.narrativeStyle,
      Writing: writing?.structure,
    }).flatMap(([label, value]) => {
      const text = nonEmptyString(value);
      return text ? [`- ${label}: ${text}`] : [];
    });
    if (descriptions.length > 0) sections.push(`## Personality\n${descriptions.join('\n')}`);
    const traits = getPersonaTraitDescriptions(persona);
    if (traits.length > 0) sections.push(`## Personality Traits\n${traits.map(trait => `- ${trait}`).join('\n')}`);
  }

  // Format values
  if (include('values')) {
    const values = getPersonaValueDescriptions(persona);
    if (values.length > 0) sections.push(`## Core Values\n${values.map(value => `- ${value}`).join('\n')}`);
  }

  // Format goals
  if (include('goals')) {
    const goals = getActivePersonaGoals(persona).slice(0, 7);
    if (goals.length > 0) sections.push(`## Active Goals\n${goals.map(goal => `- ${goal}`).join('\n')}`);
  }

  return {
    formatted: sections.join('\n\n'),
    sectionCount: sections.length,
    inactive: false,
  };
};

export const PersonaFormatterNode: NodeDefinition = defineNode({
  id: 'persona_formatter',
  name: 'Persona Formatter',
  category: 'persona',
  inputs: [
    { name: 'persona', type: 'object', description: 'Persona object to format' },
    { name: 'sections', type: 'array', optional: true, description: 'Selected persona section names; overrides static section switches' },
  ],
  outputs: [
    { name: 'formatted', type: 'string', description: 'Formatted persona text (empty if inactive)' },
    { name: 'sectionCount', type: 'number', description: 'Number of sections' },
    { name: 'inactive', type: 'boolean', description: 'True if persona is inactive (LoRA-only mode)' },
  ],
  properties: {
    includeIdentity: true, includeBackground: true,
    includeValues: true,
    includeGoals: true,
    includePersonality: true,
  },
  propertySchemas: {
    includeIdentity: { type: 'toggle', default: true, label: 'Include Identity' },
    includeBackground: { type: 'toggle', default: true, label: 'Include Background' },
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

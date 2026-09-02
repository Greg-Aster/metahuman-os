import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { loadPersonaWithFacet, type PersonaCore } from '../../identity.js';
import {
  getActivePersonaGoals,
  getPersonaBackground,
  getPersonaName,
  getPersonaTraitDescriptions,
  getPersonaValueNames,
} from '../../persona-summary.js';

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function summaryLine(label: string, values: string[]): string | null {
  return values.length > 0 ? `${label}: ${values.join(', ')}` : null;
}

/** Format the canonical active persona into the bounded context Curator needs. */
export function buildCuratorPersonaSummary(persona: PersonaCore): string {
  const identity = persona.identity;
  const role = nonEmptyString(identity?.role);
  const purpose = nonEmptyString(identity?.purpose);
  const background = getPersonaBackground(persona);
  const lines = [
    `Name: ${getPersonaName(persona)}`,
    role ? `Role: ${role}` : null,
    purpose ? `Purpose: ${purpose}` : null,
    summaryLine('Core Values', getPersonaValueNames(persona)),
    summaryLine('Personality Traits', getPersonaTraitDescriptions(persona)),
    summaryLine('Active Goals', getActivePersonaGoals(persona)),
    background ? `Background: ${background}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

const execute: NodeExecutor = async (_inputs, context, _properties) => {
  if (!context.userId) {
    throw new Error('Curator requires a userId to load persona context');
  }

  const persona = loadPersonaWithFacet();
  if (!persona) {
    throw new Error(`Curator requires an active persona context for user ${context.userId}`);
  }

  const personaSummary = buildCuratorPersonaSummary(persona);
  if (!personaSummary) {
    throw new Error(`Curator persona context is empty for user ${context.userId}`);
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

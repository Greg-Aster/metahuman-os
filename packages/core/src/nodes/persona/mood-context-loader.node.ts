import fs from 'node:fs';
import {
  isPersonaSummaryGloballyEnabled,
  loadMoodSettings,
} from '../../mood-settings.js';
import {
  loadPersonaFacetConfig,
  personaFacetResolvedPath,
  type PersonaFacetDefinition,
} from '../../persona-facets.js';
import { loadPersistedBuffer, type ConversationMessage } from '../../conversation-buffer.js';
import { defineNode, type NodeDefinition } from '../types.js';

interface MoodPersonaCandidate {
  id: string;
  name: string;
  description: string;
  usageHints: string[];
  personaSummary: Record<string, unknown>;
}

function clipMessages(messages: ConversationMessage[], limit: number, maxChars: number): Array<Record<string, unknown>> {
  const selected = messages
    .filter(message => !message.meta?.summaryMarker && typeof message.content === 'string' && message.content.trim())
    .slice(-limit)
    .map(message => ({
      role: message.role,
      content: message.content.slice(0, 2_000),
      timestamp: message.timestamp,
      type: message.meta?.type,
    }));
  while (JSON.stringify(selected).length > maxChars && selected.length > 1) selected.shift();
  return selected;
}

function personaSummary(username: string, facet: PersonaFacetDefinition): Record<string, unknown> {
  const filePath = personaFacetResolvedPath(username, facet);
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const persona = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any>;
    return {
      identity: persona.identity ? {
        name: persona.identity.name,
        role: persona.identity.role,
        purpose: persona.identity.purpose,
      } : undefined,
      communicationStyle: persona.personality?.communicationStyle,
      traits: persona.personality?.traits ?? persona.traits,
      currentFocus: persona.context?.currentFocus,
    };
  } catch {
    return {};
  }
}

export const MoodContextLoaderNode: NodeDefinition = defineNode({
  id: 'mood_context_loader',
  name: 'Mood Context Loader',
  category: 'persona',
  inputs: [],
  outputs: [
    { name: 'reviewContext', type: 'object', description: 'Mood evidence, eligible personas, and safety settings' },
    { name: 'eligible', type: 'boolean', description: 'Whether Mood may perform a persona review' },
    { name: 'activeFacet', type: 'string', description: 'Current active persona facet' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Loads the configured per-user conversation and inner-dialog buffers plus enabled persona facets.',
  execute: async (_inputs, context) => {
    const username = context.username || context.userId;
    if (!username) throw new Error('Mood Context Loader requires a user context');
    const settings = loadMoodSettings(username);
    const facets = loadPersonaFacetConfig(username);
    const activeFacet = facets.activeFacet;
    const personaSummaryEnabled = isPersonaSummaryGloballyEnabled();
    const personaDisabled = activeFacet === 'inactive' || !personaSummaryEnabled;
    const candidates: MoodPersonaCandidate[] = Object.entries(facets.facets)
      .filter(([id, facet]) => id !== 'inactive' && facet.enabled && Boolean(facet.personaFile))
      .map(([id, facet]) => ({
        id,
        name: facet.name || id,
        description: facet.description || '',
        usageHints: Array.isArray(facet.usageHints) ? facet.usageHints : [],
        personaSummary: personaSummary(username, facet),
      }));
    const baselineAvailable = candidates.some(candidate => candidate.id === settings.baselineFacet);
    const maxPerSource = Math.max(1_000, Math.floor(settings.maxContextChars / (settings.bufferSource === 'both' ? 2 : 1)));
    const conversation = settings.bufferSource === 'inner'
      ? []
      : clipMessages(loadPersistedBuffer('conversation').messages, settings.maxMessagesPerBuffer, maxPerSource);
    const inner = settings.bufferSource === 'conversation'
      ? []
      : clipMessages(loadPersistedBuffer('inner').messages, settings.maxMessagesPerBuffer, maxPerSource);
    const eligible = candidates.length > 0
      && baselineAvailable
      && (!personaDisabled || settings.overridePersonaDisabled);
    const reviewContext = {
      username,
      activeFacet,
      personaDisabled,
      personaSummaryEnabled,
      forceBaseline: context.forceBaseline === true,
      trigger: context.triggerData || {},
      settings,
      candidates,
      buffers: { conversation, inner },
      eligible,
      ineligibleReason: !baselineAvailable
        ? `Baseline facet is unavailable or disabled: ${settings.baselineFacet}`
        : personaDisabled && !settings.overridePersonaDisabled
          ? 'Persona is disabled and the Mood override is off.'
          : candidates.length === 0
            ? 'No enabled persona facets are available.'
            : undefined,
    };
    return { reviewContext, eligible, activeFacet };
  },
});

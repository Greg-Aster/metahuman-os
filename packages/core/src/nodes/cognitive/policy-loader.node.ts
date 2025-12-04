/**
 * Policy Loader Node
 * Loads and formats policies (decision rules, hard rules) for LLM prompts
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (_inputs, _context, properties) => {
  const include = properties?.include ?? ['decision-rules', 'hard-rules'];

  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();

    const sections: string[] = [];

    // Format hard rules
    if (include.includes('hard-rules') && rules.hardRules?.length > 0) {
      const hardRulesList = rules.hardRules
        .map((rule: string) => `- ${rule}`)
        .join('\n');
      sections.push(`## Hard Rules (Must Follow)\n${hardRulesList}`);
    }

    // Format decision rules / soft preferences
    if (include.includes('decision-rules') && rules.softPreferences?.length > 0) {
      const prefsList = rules.softPreferences
        .map((pref: string) => `- ${pref}`)
        .join('\n');
      sections.push(`## Preferences (Should Follow)\n${prefsList}`);
    }

    // Include trust level context
    if (rules.trustLevel) {
      sections.push(`## Current Trust Level: ${rules.trustLevel}`);
    }

    return {
      formatted: sections.join('\n\n'),
      rules,
      trustLevel: rules.trustLevel,
      hardRuleCount: rules.hardRules?.length ?? 0,
      preferenceCount: rules.softPreferences?.length ?? 0,
    };
  } catch (error) {
    console.error('[PolicyLoader] Error:', error);
    return {
      formatted: '',
      rules: null,
      error: (error as Error).message,
    };
  }
};

export const PolicyLoaderNode: NodeDefinition = defineNode({
  id: 'policy_loader',
  name: 'Policy Loader',
  category: 'cognitive',
  inputs: [],
  outputs: [
    { name: 'formatted', type: 'string', description: 'Formatted policies text' },
    { name: 'rules', type: 'object', description: 'Raw decision rules object' },
    { name: 'trustLevel', type: 'string', description: 'Current trust level' },
  ],
  properties: {
    include: ['decision-rules', 'hard-rules'],
  },
  propertySchemas: {
    include: {
      type: 'multiselect',
      default: ['decision-rules', 'hard-rules'],
      label: 'Include Policies',
      options: ['decision-rules', 'hard-rules', 'soft-preferences'],
    },
  },
  description: 'Loads and formats policies for LLM prompts',
  execute,
});

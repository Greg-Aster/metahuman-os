/**
 * Conversational Response Node
 *
 * Generates conversational response using the conversational_response skill
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';

const execute: NodeExecutor = async (inputs, context) => {
  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const result = await executeSkill('conversational_response', inputs[0] || {}, trustLevel);

    return {
      success: result.success,
      ...result.outputs,
      error: result.error,
    };
  } catch (error) {
    console.error('[Skill:conversational_response] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const ConversationalResponseNode: NodeDefinition = defineNode({
  id: 'skill_conversational_response',
  name: 'Conversational Response',
  category: 'skill',
  inputs: [
    { name: 'message', type: 'string' },
    { name: 'context', type: 'context', optional: true },
    { name: 'style', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'response', type: 'string' },
  ],
  properties: {
    style: 'default',
  },
  propertySchemas: {
    style: {
      type: 'select',
      default: 'default',
      label: 'Response Style',
      description: 'Style of conversational response',
      options: ['default', 'strict', 'summary'],
    },
  },
  description: 'Generates conversational response (terminal skill)',
  execute,
});

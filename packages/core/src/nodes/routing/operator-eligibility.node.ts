/**
 * Operator Eligibility Node
 *
 * Determines if message should use operator or simple chat
 * Uses heuristic detection of action-oriented messages
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const OperatorEligibilityNode: NodeDefinition = defineNode({
  id: 'operator_eligibility',
  name: 'Operator Eligibility',
  category: 'router',
  inputs: [
    { name: 'cognitiveMode', type: 'cognitiveMode', optional: true },
    { name: 'isAuthenticated', type: 'boolean', optional: true },
    { name: 'message', type: 'string', description: 'User message to analyze' },
  ],
  outputs: [
    { name: 'useOperator', type: 'boolean', description: 'Should use operator pipeline' },
    { name: 'message', type: 'string', description: 'Passthrough message' },
    { name: 'intent', type: 'string', description: 'Detected intent (action/conversation)' },
  ],
  properties: {
    actionWords: ['create', 'write', 'update', 'delete', 'run', 'execute', 'search', 'find', 'list', 'show', 'get'],
  },
  propertySchemas: {
    actionWords: {
      type: 'json',
      default: ['create', 'write', 'update', 'delete', 'run', 'execute', 'search', 'find', 'list', 'show', 'get'],
      label: 'Action Words',
      description: 'Words that indicate action intent',
    },
  },
  description: 'Determines if operator should be used based on message content',

  execute: async (inputs, context, properties) => {
    // Extract message string from inputs
    let message = '';
    if (typeof inputs[2] === 'object' && inputs[2]?.message) {
      message = inputs[2].message;
    } else if (typeof inputs[0] === 'string') {
      message = inputs[0];
    } else if (context.userMessage) {
      message = context.userMessage;
    }

    // Heuristic: action words indicate operator usage
    const actionWords = properties?.actionWords || ['create', 'write', 'update', 'delete', 'run', 'execute', 'search', 'find', 'list', 'show', 'get'];
    const hasActionIntent = actionWords.some((word: string) =>
      message.toLowerCase().includes(word)
    );
    const effectiveDecision = typeof context.useOperator === 'boolean' ? context.useOperator : hasActionIntent;

    // Write useOperator to context for downstream nodes
    context.useOperator = effectiveDecision;

    return {
      useOperator: effectiveDecision,
      message,
      intent: effectiveDecision ? 'action' : 'conversation',
    };
  },
});

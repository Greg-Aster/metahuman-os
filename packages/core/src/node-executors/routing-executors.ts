/**
 * Routing Node Executors
 * Handles cognitive mode routing and operator eligibility decisions
 */

import type { NodeExecutor } from './types.js';

/**
 * Cognitive Mode Router Node
 * Routes execution based on cognitive mode
 */
export const cognitiveModeRouterExecutor: NodeExecutor = async (inputs, context) => {
  const cognitiveMode = inputs[0] || context.cognitiveMode || 'dual';
  const message = inputs[1] || context.userMessage || '';

  // Output routing decision
  return {
    mode: cognitiveMode,
    message,
    routeToOperator: cognitiveMode === 'dual', // Dual mode always uses operator
    routeToChat: cognitiveMode === 'emulation', // Emulation uses chat only
  };
};

/**
 * Operator Eligibility Node
 * Determines if message should use operator or simple chat
 */
export const operatorEligibilityExecutor: NodeExecutor = async (inputs, context) => {
  // Extract message string from inputs (could be string or object with .message property)
  let message = '';
  if (typeof inputs[2] === 'object' && inputs[2]?.message) {
    message = inputs[2].message;
  } else if (typeof inputs[0] === 'string') {
    message = inputs[0];
  } else if (context.userMessage) {
    message = context.userMessage;
  }

  // Heuristic: action words indicate operator usage
  const actionWords = ['create', 'write', 'update', 'delete', 'run', 'execute', 'search', 'find', 'list', 'show', 'get'];
  const hasActionIntent = actionWords.some(word =>
    message.toLowerCase().includes(word)
  );
  const effectiveDecision = typeof context.useOperator === 'boolean' ? context.useOperator : hasActionIntent;

  return {
    useOperator: effectiveDecision,
    message,
    intent: effectiveDecision ? 'action' : 'conversation',
  };
};

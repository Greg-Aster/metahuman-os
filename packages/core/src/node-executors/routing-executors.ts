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

  // CRITICAL: Write useOperator to context so react_planner can access it
  context.useOperator = effectiveDecision;

  return {
    useOperator: effectiveDecision,
    message,
    intent: effectiveDecision ? 'action' : 'conversation',
  };
};

/**
 * Smart Router Node
 * Routes queries based on orchestrator complexity analysis
 * Simple queries skip operator overhead and go directly to response synthesis
 *
 * Enhanced to pass through memory hints from orchestrator for tier-aware memory routing:
 * - needsMemory: Whether memory search is needed
 * - memoryTier: Which tier to search (hot, warm, cold, facts, all)
 * - memoryQuery: Refined search query from orchestrator
 */
export const smartRouterExecutor: NodeExecutor = async (inputs, context) => {
  const orchestratorAnalysis = inputs[0] || {};

  // Extract complexity and metadata from orchestrator analysis
  const complexity = orchestratorAnalysis.complexity || 0.5;
  const needsMemory = orchestratorAnalysis.needsMemory || false;
  const simpleThreshold = 0.3; // Can be overridden by node properties

  // Extract memory routing hints from orchestrator
  const memoryHints = {
    needsMemory,
    memoryTier: orchestratorAnalysis.memoryTier || 'hot',
    memoryQuery: orchestratorAnalysis.memoryQuery || '',
  };

  // Determine routing decision
  const isSimple = complexity < simpleThreshold && !needsMemory;

  // Route based on complexity
  if (isSimple) {
    // Simple path: Goes directly to response synthesizer
    return {
      complexPath: null,
      simplePath: orchestratorAnalysis,
      routingDecision: 'simple',
      complexity,
      skippedOperator: true,
      memoryHints,
      routeToMemory: false,
    };
  } else {
    // Complex path: Goes through operator pipeline
    // If needsMemory, this signals downstream to route through memory_router
    return {
      complexPath: orchestratorAnalysis,
      simplePath: null,
      routingDecision: 'complex',
      complexity,
      skippedOperator: false,
      memoryHints,
      routeToMemory: needsMemory,
    };
  }
};

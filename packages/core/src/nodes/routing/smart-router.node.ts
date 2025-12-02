/**
 * Smart Router Node
 *
 * Routes queries based on orchestrator complexity analysis
 * Simple queries skip operator overhead and go directly to response synthesis
 *
 * Enhanced to pass through memory hints from orchestrator for tier-aware memory routing:
 * - needsMemory: Whether memory search is needed
 * - memoryTier: Which tier to search (hot, warm, cold, facts, all)
 * - memoryQuery: Refined search query from orchestrator
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const SmartRouterNode: NodeDefinition = defineNode({
  id: 'smart_router',
  name: 'Smart Router',
  category: 'router',
  inputs: [
    { name: 'orchestratorAnalysis', type: 'object', description: 'Analysis from orchestrator LLM' },
  ],
  outputs: [
    { name: 'complexPath', type: 'object', description: 'Output for complex queries (to operator)' },
    { name: 'simplePath', type: 'object', description: 'Output for simple queries (direct to response)' },
    { name: 'routingDecision', type: 'string', description: 'Decision made (simple/complex)' },
    { name: 'memoryHints', type: 'object', description: 'Memory routing hints from orchestrator' },
  ],
  properties: {
    routeOnComplexity: true,
    simpleThreshold: 0.3,
  },
  propertySchemas: {
    routeOnComplexity: {
      type: 'boolean',
      default: true,
      label: 'Route on Complexity',
      description: 'Enable complexity-based routing',
    },
    simpleThreshold: {
      type: 'slider',
      default: 0.3,
      label: 'Simple Threshold',
      description: 'Complexity threshold below which queries are considered simple',
      min: 0,
      max: 1,
      step: 0.1,
    },
  },
  description: 'Routes queries based on complexity analysis - simple queries skip operator overhead',

  execute: async (inputs, context, properties) => {
    const orchestratorAnalysis = inputs[0] || {};

    // Extract complexity and metadata from orchestrator analysis
    const complexity = orchestratorAnalysis.complexity || 0.5;
    const needsMemory = orchestratorAnalysis.needsMemory || false;
    const simpleThreshold = properties?.simpleThreshold || 0.3;

    // Extract memory routing hints from orchestrator
    const memoryHints = {
      needsMemory,
      memoryTier: orchestratorAnalysis.memoryTier || 'hot',
      memoryQuery: orchestratorAnalysis.memoryQuery || '',
    };

    // Determine routing decision
    const isSimple = complexity < simpleThreshold && !needsMemory;

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
  },
});

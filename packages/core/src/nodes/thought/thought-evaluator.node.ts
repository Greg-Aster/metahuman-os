/**
 * Thought Evaluator Node
 * Decides if the train of thought should continue or conclude
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const generatorOutput = inputs.thoughtData || {};
  const currentThought = generatorOutput.thought || '';
  const currentKeywords = Array.isArray(generatorOutput.keywords) ? generatorOutput.keywords : [];
  const parsedConfidence = Number(generatorOutput.confidence);
  const confidence = Number.isFinite(parsedConfidence) ? parsedConfidence : 0.5;
  const thoughts = Array.isArray(generatorOutput.thoughts) ? generatorOutput.thoughts : [];
  const seedMemory = generatorOutput.seedMemory || '';

  // Use thoughts length as iteration count
  const iteration = thoughts.length;
  const maxIterations = Number(properties?.maxIterations ?? 4);
  const minConfidence = Number(properties?.minConfidence ?? 0.4);
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 5) {
    throw new Error('Thought Evaluator maxIterations must be an integer from 1 to 5');
  }
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new Error('Thought Evaluator minConfidence must be between 0 and 1');
  }

  // Decision logic
  let shouldContinue = true;
  let reason = '';
  const nextSearchTerms = currentKeywords.slice(0, 3);

  // Check iteration limit
  if (iteration >= maxIterations) {
    shouldContinue = false;
    reason = `Reached maximum iterations (${maxIterations})`;
  }
  // Check confidence threshold
  else if (confidence < minConfidence) {
    shouldContinue = false;
    reason = `Confidence (${confidence.toFixed(2)}) below threshold (${minConfidence})`;
  }
  // Check for empty thought
  else if (!currentThought || currentThought.length < 10) {
    shouldContinue = false;
    reason = 'Generated thought too short or empty';
  }
  // Check for no keywords to explore
  else if (currentKeywords.length === 0) {
    shouldContinue = false;
    reason = 'No keywords extracted for further exploration';
  }
  // Check for repetition (simple substring check)
  else {
    const previousThoughts = thoughts.slice(0, -1);
    const isRepetitive = previousThoughts.some((prev: string) => {
      if (!prev) return false;
      const prevLower = prev.toLowerCase();
      const currentLower = currentThought.toLowerCase();
      return prevLower.includes(currentLower.substring(0, 50)) ||
             currentLower.includes(prevLower.substring(0, 50));
    });

    if (isRepetitive) {
      shouldContinue = false;
      reason = 'Thought appears repetitive of previous reasoning';
    } else {
      reason = `Continuing exploration (confidence: ${confidence.toFixed(2)}, keywords: ${nextSearchTerms.join(', ')})`;
    }
  }

  audit({
    level: 'info',
    category: 'decision',
    event: 'thought_evaluated',
    actor: 'train-of-thought',
    details: {
      iteration,
      shouldContinue,
      reason,
      confidence,
      nextSearchTerms,
      thoughtCount: thoughts.length,
    },
  });

  const evaluation = {
    isComplete: !shouldContinue,
    reason,
    nextSearchTerms,
    iteration,
    confidence,
    thoughts,
    seedMemory,
    seenMemoryIds: Array.isArray(generatorOutput.seenMemoryIds)
      ? generatorOutput.seenMemoryIds
      : [],
  };
  return { evaluation, ...evaluation };
};

export const ThoughtEvaluatorNode: NodeDefinition = defineNode({
  id: 'thought_evaluator',
  name: 'Thought Evaluator',
  category: 'thought',
  inputs: [
    { name: 'thoughtData', type: 'object', description: 'Output from thought_generator' },
  ],
  outputs: [
    { name: 'evaluation', type: 'object', description: 'Continuation decision and accumulated thought state' },
    { name: 'isComplete', type: 'boolean', description: 'True if should exit loop' },
    { name: 'reason', type: 'string', description: 'Evaluation reason' },
    { name: 'nextSearchTerms', type: 'array', description: 'Keywords for next search' },
    { name: 'thoughts', type: 'array', description: 'Pass-through thoughts' },
  ],
  properties: {
    minConfidence: 0.4,
    maxIterations: 4,
  },
  propertySchemas: {
    minConfidence: {
      type: 'number',
      default: 0.4,
      label: 'Min Confidence',
      description: 'Minimum confidence to continue',
    },
    maxIterations: {
      type: 'number',
      default: 4,
      label: 'Max Iterations',
      description: 'Hard limit on iterations',
      min: 1,
      max: 5,
    },
  },
  description: 'Decides if the train of thought should continue or conclude',
  execute,
});

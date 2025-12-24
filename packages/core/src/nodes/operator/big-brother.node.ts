/**
 * Big Brother Node
 *
 * @deprecated Use ToolExecutorNode instead. Big Brother is being replaced by the
 * unified tool executor system that supports multiple backends (Open Interpreter,
 * local skills, Claude Code, Qwen Code, Aider, Gemini CLI) via user configuration.
 *
 * See: packages/core/src/nodes/operator/tool-executor.node.ts
 * Config: etc/tool-executor.json
 *
 * This node is kept for backward compatibility but will be removed in a future version.
 *
 * Escalates stuck states to Claude CLI for expert analysis and recovery suggestions
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, _properties) => {
  try {
    const goal = inputs[0] || inputs.goal || '';
    const scratchpad = inputs[1] || inputs.scratchpad || [];
    const errorType = inputs[2] || inputs.errorType || null;
    const contextData = inputs[3] || inputs.context || {};

    console.log(`[BigBrother] Escalating stuck state for goal: "${goal.substring(0, 50)}..."`);

    const { getUserContext } = await import('../../context.js');
    const userContext = getUserContext();

    // Big Brother requires authenticated user (all configs are user-specific)
    if (!userContext?.username) {
      console.warn('[BigBrother] No authenticated user context, skipping escalation');
      return {
        suggestions: [],
        reasoning: 'No authenticated user context available',
        alternativeApproach: undefined,
        success: false,
      };
    }

    const { loadOperatorConfig } = await import('../../config.js');
    const { escalateToBigBrother } = await import('../../big-brother.js');
    const operatorConfig = loadOperatorConfig(userContext.username);

    const request = {
      goal,
      stuckReason: 'Detected repeated failures or lack of progress',
      errorType: errorType as any,
      scratchpad,
      context: contextData,
      suggestions: ['Review the approach', 'Try alternative methods', 'Break down the problem'],
    };

    const response = await escalateToBigBrother(request, operatorConfig);

    return {
      suggestions: response.suggestions,
      reasoning: response.reasoning,
      alternativeApproach: response.alternativeApproach,
      success: response.success,
    };
  } catch (error) {
    console.error('[BigBrother] Error:', error);
    return {
      suggestions: ['Manual intervention required'],
      reasoning: 'Escalation failed',
      success: false,
      error: (error as Error).message,
    };
  }
};

export const BigBrotherNode: NodeDefinition = defineNode({
  id: 'big_brother',
  name: 'Big Brother',
  category: 'operator',
  inputs: [
    { name: 'goal', type: 'string', description: 'The goal the operator is trying to achieve' },
    { name: 'scratchpad', type: 'array', description: 'Full scratchpad with actions and observations' },
    { name: 'errorType', type: 'string', optional: true, description: 'Type of error' },
    { name: 'context', type: 'object', optional: true, description: 'Additional context about the stuck state' },
  ],
  outputs: [
    { name: 'suggestions', type: 'array', description: 'Array of actionable recovery suggestions' },
    { name: 'reasoning', type: 'string', description: 'Root cause analysis and reasoning' },
    { name: 'alternativeApproach', type: 'string', description: 'Suggested alternative strategy' },
    { name: 'success', type: 'boolean', description: 'Whether escalation succeeded' },
  ],
  properties: {
    provider: 'claude-code',
    maxRetries: 1,
    autoApplySuggestions: false,
  },
  description: 'Escalates stuck states to Claude CLI for expert analysis and recovery guidance',
  execute,
});

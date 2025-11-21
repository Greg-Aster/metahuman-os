/**
 * Thought Node Executors
 * Handles train of thought reasoning: generation, evaluation, aggregation, and agent triggering
 */

import { callLLM } from '../model-router.js';
import { loadPersonaCore } from '../identity.js';
import { searchMemory } from '../memory.js';
import { audit } from '../audit.js';
import type { NodeExecutor } from './types.js';

/**
 * Thought Generator Node
 * Generates a single reasoning step from memory context
 *
 * Inputs:
 *   [0] - Memory context (string or object with content)
 *   [1] - Previous thoughts (optional, from scratchpad)
 *
 * Properties:
 *   - systemPrompt: Custom system prompt (optional)
 *   - temperature: LLM temperature (default: 0.75)
 *   - extractKeywords: Whether to extract keywords from thought (default: true)
 *
 * Outputs:
 *   - thought: The generated reasoning step
 *   - keywords: Extracted keywords for next search
 *   - confidence: Self-assessed confidence (0-1)
 */
export const thoughtGeneratorExecutor: NodeExecutor = async (inputs, context, properties) => {
  // Input[0]: Memory context OR scratchpad from loop
  // Input[1]: Seed text from text_input
  const input0 = inputs[0] || {};

  // Get memory context - could be from scratchpad (loop) or direct seed
  const memoryContext = input0?.seedMemory || input0?.text || inputs[1]?.text ||
                        (typeof input0 === 'string' ? input0 : '') ||
                        context.seedMemory || '';

  // Get accumulated thoughts from scratchpad
  const previousThoughts = input0?.thoughts || context.scratchpad?.thoughts || [];
  const temperature = properties?.temperature || 0.75;
  const extractKeywords = properties?.extractKeywords !== false;

  if (!memoryContext) {
    return {
      thought: '',
      thoughts: previousThoughts,
      keywords: [],
      confidence: 0,
      error: 'No memory context provided',
    };
  }

  try {
    const persona = loadPersonaCore();
    const thoughtHistory = previousThoughts.length > 0
      ? `\nPrevious thoughts in this chain:\n${previousThoughts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}\n`
      : '';

    const systemPrompt = properties?.systemPrompt || `You are ${persona.identity.name}, engaging in deep introspection and reasoning.

Your task is to generate a thoughtful reflection based on a memory or observation. Think deeply about connections, implications, and what this might mean.
${thoughtHistory}
After your thought, provide:
1. A confidence score (0.0-1.0) for how insightful this thought is
2. 2-4 keywords or concepts that could lead to related thoughts

Respond in this format:
THOUGHT: [Your reflection - 1-3 sentences of genuine insight]
CONFIDENCE: [0.0-1.0]
KEYWORDS: [comma-separated keywords]`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Reflect on this memory/context:\n\n${memoryContext}` },
    ];

    const response = await callLLM({
      role: 'persona',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 512,
        temperature,
        repeatPenalty: 1.2,
      },
    });

    // Parse the response
    const content = response.content || '';
    const thoughtMatch = content.match(/THOUGHT:\s*(.+?)(?=\nCONFIDENCE:|$)/s);
    const confidenceMatch = content.match(/CONFIDENCE:\s*([\d.]+)/);
    const keywordsMatch = content.match(/KEYWORDS:\s*(.+?)$/s);

    const thought = thoughtMatch?.[1]?.trim() || content.split('\n')[0] || '';
    const confidence = parseFloat(confidenceMatch?.[1] || '0.5');
    const keywordsRaw = keywordsMatch?.[1]?.trim() || '';
    const keywords = extractKeywords && keywordsRaw
      ? keywordsRaw.split(',').map(k => k.trim()).filter(k => k.length > 0)
      : [];

    audit({
      level: 'info',
      category: 'decision',
      event: 'thought_generated',
      actor: 'train-of-thought',
      details: {
        thoughtPreview: thought.substring(0, 100),
        confidence,
        keywordCount: keywords.length,
        iterationIndex: previousThoughts.length,
      },
    });

    // Accumulate thoughts
    const thoughts = thought ? [...previousThoughts, thought] : previousThoughts;

    return {
      thought,
      thoughts, // Accumulated array for passing through loop
      keywords,
      confidence,
      seedMemory: memoryContext, // Preserve for next iteration
      raw: content,
    };
  } catch (error) {
    console.error('[ThoughtGenerator] Error:', error);
    return {
      thought: '',
      thoughts: previousThoughts,
      keywords: [],
      confidence: 0,
      seedMemory: memoryContext,
      error: (error as Error).message,
    };
  }
};

/**
 * Thought Evaluator Node
 * Decides if the train of thought should continue or conclude
 *
 * Inputs:
 *   [0] - Current thought (from thought_generator)
 *   [1] - Iteration info (from iteration_counter)
 *   [2] - Scratchpad history (from scratchpad_updater)
 *
 * Properties:
 *   - minConfidence: Minimum confidence to continue (default: 0.4)
 *   - maxIterations: Hard limit (default: 7)
 *   - repetitionThreshold: Stop if thought is too similar to previous (default: 0.8)
 *
 * Outputs:
 *   - shouldContinue: boolean
 *   - reason: Why we're continuing or stopping
 *   - nextSearchTerms: Keywords to use for next memory search
 */
export const thoughtEvaluatorExecutor: NodeExecutor = async (inputs, context, properties) => {
  const generatorOutput = inputs[0] || {};
  const currentThought = generatorOutput.thought || '';
  const currentKeywords = generatorOutput.keywords || [];
  const confidence = generatorOutput.confidence || 0.5;
  const thoughts = generatorOutput.thoughts || []; // Accumulated thoughts array
  const seedMemory = generatorOutput.seedMemory || '';

  // Use thoughts length as iteration count
  const iteration = thoughts.length;
  const maxIterations = properties?.maxIterations || 7;

  const minConfidence = properties?.minConfidence || 0.4;

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
    const previousThoughts = thoughts.slice(0, -1); // All but current
    const isRepetitive = previousThoughts.some((prev: string) => {
      if (!prev) return false;
      const prevLower = prev.toLowerCase();
      const currentLower = currentThought.toLowerCase();
      // Check if significant overlap
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

  // Only output shouldExit for the conditional_router
  // Don't output shouldContinue as the router will pick it up and invert our logic
  return {
    isComplete: !shouldContinue, // Use isComplete instead (true = exit loop)
    reason,
    nextSearchTerms,
    iteration,
    confidence,
    thoughts, // Pass through for aggregator
    seedMemory, // Pass through for next iteration
  };
};

/**
 * Thought Aggregator Node
 * Combines all thoughts into a coherent reasoning chain
 *
 * Inputs:
 *   [0] - Scratchpad with all thoughts
 *
 * Properties:
 *   - summaryStyle: 'narrative' | 'bullets' | 'insight' (default: 'narrative')
 *   - maxLength: Maximum output length in words (default: 200)
 *
 * Outputs:
 *   - consolidatedChain: Full chain of reasoning
 *   - insight: Key insight extracted
 *   - summary: Brief summary
 *   - thoughtCount: Number of thoughts in chain
 */
export const thoughtAggregatorExecutor: NodeExecutor = async (inputs, context, properties) => {
  // Read thoughts from evaluator output or scratchpad
  const input0 = inputs[0] || {};
  const thoughts = input0.thoughts || input0.scratchpad?.thoughts || context.scratchpad?.thoughts || [];
  const summaryStyle = properties?.summaryStyle || 'narrative';
  const maxLength = properties?.maxLength || 200;

  if (thoughts.length === 0) {
    return {
      consolidatedChain: '',
      insight: '',
      summary: 'No thoughts generated in this chain.',
      thoughtCount: 0,
    };
  }

  try {
    const persona = loadPersonaCore();

    // Build the chain representation
    const chainText = thoughts.map((t: string, i: number) => `Step ${i + 1}: ${t}`).join('\n\n');

    const systemPrompt = `You are ${persona.identity.name}, synthesizing a train of thought into a coherent insight.

Given the following chain of reasoning, create:
1. A consolidated narrative that weaves these thoughts together
2. A single key insight or conclusion
3. A brief 1-sentence summary

Keep the total response under ${maxLength} words.
Style: ${summaryStyle}

Respond in this format:
NARRATIVE: [Woven narrative of the reasoning chain]
INSIGHT: [Single key insight]
SUMMARY: [1-sentence summary]`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Train of thought (${thoughts.length} steps):\n\n${chainText}` },
    ];

    const response = await callLLM({
      role: 'persona',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 800,
        temperature: 0.6,
      },
    });

    const content = response.content || '';
    const narrativeMatch = content.match(/NARRATIVE:\s*(.+?)(?=\nINSIGHT:|$)/s);
    const insightMatch = content.match(/INSIGHT:\s*(.+?)(?=\nSUMMARY:|$)/s);
    const summaryMatch = content.match(/SUMMARY:\s*(.+?)$/s);

    const consolidatedChain = narrativeMatch?.[1]?.trim() || chainText;
    const insight = insightMatch?.[1]?.trim() || thoughts[thoughts.length - 1] || '';
    const summary = summaryMatch?.[1]?.trim() || `Explored ${thoughts.length} connected thoughts.`;

    audit({
      level: 'info',
      category: 'decision',
      event: 'thought_chain_aggregated',
      actor: 'train-of-thought',
      details: {
        thoughtCount: thoughts.length,
        insightPreview: insight.substring(0, 100),
      },
    });

    return {
      consolidatedChain,
      insight,
      summary,
      thoughtCount: thoughts.length,
      raw: content,
    };
  } catch (error) {
    console.error('[ThoughtAggregator] Error:', error);
    return {
      consolidatedChain: thoughts.join('\n\n'),
      insight: thoughts[thoughts.length - 1] || '',
      summary: `Chain of ${thoughts.length} thoughts (aggregation failed).`,
      thoughtCount: thoughts.length,
      error: (error as Error).message,
    };
  }
};

/**
 * Agent Trigger Node
 * Allows one workflow to spawn another agent/workflow
 *
 * Inputs:
 *   [0] - Input data to pass to the agent
 *
 * Properties:
 *   - agentName: Name of agent to trigger (required)
 *   - waitForCompletion: Whether to wait for result (default: true)
 *   - timeout: Timeout in ms (default: 30000)
 *
 * Outputs:
 *   - triggered: boolean
 *   - agentName: Name of triggered agent
 *   - result: Agent result (if waitForCompletion)
 *   - error: Error message if failed
 */
export const agentTriggerExecutor: NodeExecutor = async (inputs, context, properties) => {
  const agentName = properties?.agentName;
  const inputData = inputs[0] || {};
  const waitForCompletion = properties?.waitForCompletion !== false;
  const timeout = properties?.timeout || 30000;

  if (!agentName) {
    return {
      triggered: false,
      error: 'No agent name specified',
    };
  }

  try {
    // For now, we support triggering cognitive graphs by name
    // Full agent spawning would require the agent runner infrastructure

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_triggered',
      actor: 'agent-trigger-node',
      details: {
        agentName,
        waitForCompletion,
        inputKeys: Object.keys(inputData),
      },
    });

    // This is a placeholder - actual implementation would:
    // 1. Look up the agent's cognitive graph
    // 2. Execute it with inputData as context
    // 3. Return the result

    // For the train-of-thought use case, we'll pass through the context
    // and let the calling workflow handle the graph execution
    return {
      triggered: true,
      agentName,
      inputData,
      waitForCompletion,
      timeout,
      note: 'Agent trigger queued - graph execution handled by caller',
    };
  } catch (error) {
    console.error('[AgentTrigger] Error:', error);
    return {
      triggered: false,
      agentName,
      error: (error as Error).message,
    };
  }
};

/**
 * Memory Search (Loop-Aware) Node
 * Searches for memories based on keywords from thought chain
 * Designed to work inside loops, avoiding already-seen memories
 *
 * Inputs:
 *   [0] - Search terms (from thought_evaluator.nextSearchTerms)
 *   [1] - Already seen memory IDs (from scratchpad)
 *
 * Properties:
 *   - maxResults: Maximum memories to return (default: 3)
 *   - excludeSeen: Whether to exclude already-seen memories (default: true)
 *
 * Outputs:
 *   - memories: Array of memory objects
 *   - memoryIds: Array of memory IDs (for tracking)
 *   - searchTermsUsed: Which terms yielded results
 */
export const loopMemorySearchExecutor: NodeExecutor = async (inputs, context, properties) => {
  const searchTerms = inputs[0]?.nextSearchTerms || inputs[0] || [];
  const seenIds = new Set(inputs[1]?.seenMemoryIds || context.seenMemoryIds || []);
  const maxResults = properties?.maxResults || 3;
  const excludeSeen = properties?.excludeSeen !== false;

  if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
    return {
      memories: [],
      memoryIds: [],
      searchTermsUsed: [],
    };
  }

  try {
    const results: any[] = [];
    const searchTermsUsed: string[] = [];
    const newMemoryIds: string[] = [];

    for (const term of searchTerms) {
      if (results.length >= maxResults) break;

      const found = searchMemory(term);
      for (const memoryPath of found) {
        if (results.length >= maxResults) break;

        // Extract ID from path
        const memoryId = memoryPath.split('/').pop()?.replace('.json', '') || memoryPath;

        if (excludeSeen && seenIds.has(memoryId)) continue;

        results.push({
          id: memoryId,
          path: memoryPath,
          searchTerm: term,
        });
        newMemoryIds.push(memoryId);

        if (!searchTermsUsed.includes(term)) {
          searchTermsUsed.push(term);
        }
      }
    }

    return {
      memories: results,
      memoryIds: newMemoryIds,
      searchTermsUsed,
      totalFound: results.length,
    };
  } catch (error) {
    console.error('[LoopMemorySearch] Error:', error);
    return {
      memories: [],
      memoryIds: [],
      searchTermsUsed: [],
      error: (error as Error).message,
    };
  }
};

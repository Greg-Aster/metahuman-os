/**
 * Scratchpad Node Executors
 * Handles ReAct scratchpad initialization, updates, iteration counting, completion checking, and formatting
 */

import type { NodeExecutor } from './types.js';

/**
 * Scratchpad Initializer Node
 * Creates or resets the scratchpad for ReAct iteration
 */
export const scratchpadInitializerExecutor: NodeExecutor = async (inputs, context) => {
  return {
    scratchpad: [],
    iteration: 0,
    maxIterations: context.maxIterations || 10,
    isComplete: false,
  };
};

/**
 * Scratchpad Updater Node
 * Appends new thought/action/observation to scratchpad
 */
export const scratchpadUpdaterExecutor: NodeExecutor = async (inputs, context) => {
  if (process.env.DEBUG_GRAPH) console.log(`[ScratchpadUpdater] ========== SCRATCHPAD UPDATE ==========`);
  if (process.env.DEBUG_GRAPH) console.log(`[ScratchpadUpdater] Received ${inputs.length} inputs`);
  if (process.env.DEBUG_GRAPH) console.log(`[ScratchpadUpdater] Input[0] (iteration state):`, {
    type: typeof inputs[0],
    keys: inputs[0] ? Object.keys(inputs[0]) : [],
  });
  if (process.env.DEBUG_GRAPH) console.log(`[ScratchpadUpdater] Input[1] (observation):`, {
    type: typeof inputs[1],
    keys: inputs[1] && typeof inputs[1] === 'object' ? Object.keys(inputs[1]) : [],
    preview: typeof inputs[1] === 'string' ? inputs[1].substring(0, 100) : 'object',
  });
  if (process.env.DEBUG_GRAPH) console.log(`[ScratchpadUpdater] Input[2] (plan):`, {
    type: typeof inputs[2],
    keys: inputs[2] && typeof inputs[2] === 'object' ? Object.keys(inputs[2]) : [],
    planPreview: inputs[2]?.plan?.substring(0, 100) || 'none',
  });

  const currentScratchpad = inputs[0]?.scratchpad || [];
  const iteration = inputs[0]?.iteration || 0;

  // Extract thought and action from react planner output (inputs[2])
  const planOutput = inputs[2];
  const planText = typeof planOutput === 'object' ? planOutput.plan : planOutput;

  // Parse the plan text to extract thought and action
  let thought = planText || '';
  let action = '';

  // Try to extract structured components
  const thoughtMatch = planText?.match(/Thought:\s*(.+?)(?=\nAction:|$)/is);
  const actionMatch = planText?.match(/Action:\s*(.+?)(?=\nAction Input:|$)/is);

  if (thoughtMatch) {
    thought = thoughtMatch[1].trim();
  }
  if (actionMatch) {
    action = actionMatch[1].trim();
  }

  // Extract observation from skill executor output (inputs[1])
  const observationOutput = inputs[1];
  let observation = '';

  if (typeof observationOutput === 'string') {
    observation = observationOutput;
  } else if (observationOutput && typeof observationOutput === 'object') {
    observation = observationOutput.observation || JSON.stringify(observationOutput);
  }

  const newEntry = {
    iteration: iteration + 1,
    thought,
    action,
    observation,
    timestamp: new Date().toISOString(),
  };

  const updatedScratchpad = [...currentScratchpad, newEntry];

  const result = {
    scratchpad: updatedScratchpad,
    iteration: iteration + 1,
    maxIterations: inputs[0]?.maxIterations || 10,
    isComplete: false,
  };

  if (process.env.DEBUG_GRAPH) console.log(`[ScratchpadUpdater] Extracted:`, {
    thoughtPreview: thought.substring(0, 80),
    actionPreview: action.substring(0, 50),
    observationPreview: observation.substring(0, 80),
  });
  if (process.env.DEBUG_GRAPH) console.log(`[ScratchpadUpdater] Updated scratchpad: iteration=${result.iteration}/${result.maxIterations}, entries=${result.scratchpad.length}`);
  if (process.env.DEBUG_GRAPH) console.log(`[ScratchpadUpdater] Latest entry:`, {
    iteration: newEntry.iteration,
    thoughtLength: newEntry.thought.length,
    actionLength: newEntry.action.length,
    observationLength: newEntry.observation.length,
  });
  if (process.env.DEBUG_GRAPH) console.log(`[ScratchpadUpdater] =======================================`);

  return result;
};

/**
 * Iteration Counter Node
 * Tracks and validates iteration count
 *
 * Inputs:
 *   slot 0: Initial scratchpad from initializer (first iteration)
 *   slot 1: Loop-back data from conditional_router (subsequent iterations)
 */
export const iterationCounterExecutor: NodeExecutor = async (inputs, context) => {
  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] ========== ITERATION COUNTER ==========`);
  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] Received ${inputs.length} inputs`);
  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] Input[0]:`, {
    type: typeof inputs[0],
    keys: inputs[0] ? Object.keys(inputs[0]) : [],
  });
  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] Input[1]:`, {
    type: typeof inputs[1],
    keys: inputs[1] ? Object.keys(inputs[1]) : [],
  });

  // Merge inputs: slot 1 (loop-back) takes priority over slot 0 (initial)
  // Note: loop-back data comes wrapped in { routedData: {...} } from conditional_router
  let scratchpadData = inputs[1] || inputs[0] || {};

  // Unwrap routedData if present (from conditional_router loop-back)
  if (scratchpadData.routedData) {
    console.log(`[IterationCounter] Unwrapping routedData from conditional_router`);
    scratchpadData = scratchpadData.routedData;
  }

  const iteration = scratchpadData.iteration || 0;
  const maxIterations = scratchpadData.maxIterations || context.maxIterations || 10;
  const scratchpad = scratchpadData.scratchpad || [];

  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] Using data from: ${inputs[1] ? 'slot 1 (loop-back)' : 'slot 0 (initial)'}`);
  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] Extracted data:`, {
    iteration,
    maxIterations,
    scratchpadLength: scratchpad.length,
    hasRouted: !!inputs[1]?.routedData,
  });
  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] Iteration: ${iteration}/${maxIterations}, scratchpadLength: ${scratchpad.length}`);

  const hasExceededMax = iteration >= maxIterations;
  const shouldContinue = !hasExceededMax;

  const result = {
    iteration,
    maxIterations,
    hasExceededMax,
    shouldContinue,
    scratchpad,  // Pass scratchpad through
    scratchpadLength: scratchpad.length,
  };

  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] Returning:`, {
    iteration: result.iteration,
    maxIterations: result.maxIterations,
    hasExceededMax: result.hasExceededMax,
    shouldContinue: result.shouldContinue,
  });
  if (process.env.DEBUG_GRAPH) console.log(`[IterationCounter] ==========================================`);

  return result;
};

/**
 * Scratchpad Completion Checker Node
 * Determines if ReAct task is complete based on response content and iteration count
 */
export const scratchpadCompletionCheckerExecutor: NodeExecutor = async (inputs) => {
  if (process.env.DEBUG_GRAPH) console.log(`[CompletionChecker] Received inputs:`, {
    inputCount: inputs.length,
    input0Type: typeof inputs[0],
    input0Keys: inputs[0] ? Object.keys(inputs[0]) : [],
  });

  // Extract scratchpad data (comes from scratchpad_updater)
  const scratchpadData = inputs[0] || {};
  const scratchpad = scratchpadData.scratchpad || [];
  const iteration = scratchpadData.iteration || 0;
  const maxIterations = scratchpadData.maxIterations || 10;

  if (process.env.DEBUG_GRAPH) console.log(`[CompletionChecker] Extracted: iteration=${iteration}/${maxIterations}, scratchpadLength=${scratchpad.length}`);

  // Get the latest entry to check for completion markers
  const latestEntry = scratchpad[scratchpad.length - 1] || {};
  const latestThought = latestEntry.thought || '';
  const latestObservation = latestEntry.observation || '';
  const combinedText = `${latestThought} ${latestObservation}`;

  if (process.env.DEBUG_GRAPH) console.log(`[CompletionChecker] Latest entry:`, {
    thoughtPreview: latestThought.substring(0, 100),
    observationPreview: latestObservation.substring(0, 100),
  });

  // Check for completion markers in the latest thought or observation
  const hasFinalAnswer = /Final Answer:|FINAL_ANSWER|Task Complete/i.test(combinedText);
  const hasExceededMax = iteration >= maxIterations;

  // Auto-complete after successful conversational_response (optimization for simple queries)
  // This short-circuits the loop for greetings/simple conversation
  const isConversationalResponse = latestEntry.action === 'conversational_response';
  const hasSuccessfulResponse = latestObservation.includes('"success":true') && latestObservation.includes('"response"');
  const shouldAutoComplete = isConversationalResponse && hasSuccessfulResponse;

  const isComplete = hasFinalAnswer || hasExceededMax || shouldAutoComplete;

  const reason = hasFinalAnswer ? 'final_answer' :
    hasExceededMax ? 'max_iterations' :
    shouldAutoComplete ? 'auto_complete_conversational' :
    'continue';

  if (process.env.DEBUG_GRAPH) console.log(`[CompletionChecker] Iteration: ${iteration}/${maxIterations}, Complete: ${isComplete}, Reason: ${reason}`);

  const result = {
    isComplete,
    hasFinalAnswer,
    hasExceededMax,
    shouldAutoComplete,
    iteration,
    scratchpad,
    maxIterations,
    reason,
  };

  if (process.env.DEBUG_GRAPH) console.log(`[CompletionChecker] Returning:`, {
    isComplete: result.isComplete,
    reason: result.reason,
    iteration: result.iteration,
    maxIterations: result.maxIterations,
  });

  return result;
};

/**
 * Scratchpad Formatter Node
 * Formats scratchpad for display or LLM consumption
 */
export const scratchpadFormatterExecutor: NodeExecutor = async (inputs, context) => {
  // Unwrap routedData if present (from conditional_router)
  let inputData = inputs[0];
  if (inputData?.routedData) {
    console.log(`[ScratchpadFormatter] Unwrapping routedData from conditional_router`);
    inputData = inputData.routedData;
  }

  const scratchpad = inputData?.scratchpad || [];
  const format = context.format || 'text'; // 'text' | 'json' | 'markdown'

  console.log(`[ScratchpadFormatter] Formatting ${scratchpad.length} scratchpad entries`);
  if (scratchpad.length === 0) {
    console.warn(`[ScratchpadFormatter] ⚠️  Empty scratchpad received!`);
  }

  if (format === 'json') {
    return {
      formatted: JSON.stringify(scratchpad, null, 2),
      entries: scratchpad.length,
      scratchpad,
    };
  }

  if (format === 'markdown') {
    const formatted = scratchpad
      .map((entry: any, idx: number) => {
        return `### Iteration ${idx + 1}\n\n**Thought:** ${entry.thought}\n\n**Action:** ${entry.action}\n\n**Observation:** ${entry.observation}\n`;
      })
      .join('\n---\n\n');
    return {
      formatted,
      entries: scratchpad.length,
      scratchpad,
    };
  }

  // Default: text format
  const formatted = scratchpad
    .map((entry: any) => `Thought: ${entry.thought}\nAction: ${entry.action}\nObservation: ${entry.observation}`)
    .join('\n\n');

  return {
    formatted,
    entries: scratchpad.length,
    scratchpad,
  };
};

/**
 * Scratchpad Manager Node
 * Manages ReAct scratchpad state (thought, action, observation history)
 */
export const scratchpadManagerExecutor: NodeExecutor = async (inputs, context, properties) => {
  const operation = properties?.operation || 'append'; // append, get, clear, trim
  const maxSteps = properties?.maxSteps || 10;
  const sessionId = context.sessionId || 'default';

  // Store scratchpad in context (persists across node executions within same graph run)
  const scratchpadKey = `scratchpad_${sessionId}`;

  try {
    switch (operation) {
      case 'append':
        // Add new step to scratchpad
        const scratchpad = (context[scratchpadKey] || []) as any[];
        const newStep = inputs[0] || {};
        scratchpad.push(newStep);
        context[scratchpadKey] = scratchpad;

        return {
          scratchpad,
          stepCount: scratchpad.length,
          appended: true,
        };

      case 'get':
        // Retrieve current scratchpad
        const current = (context[scratchpadKey] || []) as any[];
        return {
          scratchpad: current,
          stepCount: current.length,
        };

      case 'clear':
        // Clear scratchpad
        context[scratchpadKey] = [];
        return {
          scratchpad: [],
          stepCount: 0,
          cleared: true,
        };

      case 'trim':
        // Trim to last N steps
        const full = (context[scratchpadKey] || []) as any[];
        const trimmed = full.slice(-maxSteps);
        context[scratchpadKey] = trimmed;
        return {
          scratchpad: trimmed,
          stepCount: trimmed.length,
          trimmed: true,
        };

      default:
        return {
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    console.error('[ScratchpadManager] Error:', error);
    return {
      error: (error as Error).message,
    };
  }
};

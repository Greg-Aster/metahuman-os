/**
 * Control Flow Node Executors
 * Handles loop controller, conditional branch, switch, and forEach
 */

import type { NodeExecutor } from './types.js';

/**
 * Loop Controller Node
 * Implements iterative ReAct execution with max iterations and completion detection
 *
 * This executor hard-codes the ReAct loop structure for Phase 1:
 * - Plan (reactPlanner)
 * - Execute (skillExecutor)
 * - Observe (observationFormatter)
 * - Check Completion (completionChecker)
 *
 * Manages scratchpad state across iterations and handles graceful completion.
 */
export const loopControllerExecutor: NodeExecutor = async (inputs, context, properties) => {
  const maxIterations = properties?.maxIterations || 10;

  // Extract message string from inputs (multiple possible formats)
  let userMessage = '';
  if (typeof inputs[1] === 'object' && inputs[1]?.message) {
    userMessage = inputs[1].message;
  } else if (typeof inputs[0] === 'string') {
    userMessage = inputs[0];
  } else if (inputs.userMessage) {
    userMessage = inputs.userMessage;
  } else if (inputs.message) {
    userMessage = inputs.message;
  } else if (context.userMessage) {
    userMessage = context.userMessage;
  }

  if (!userMessage || typeof userMessage !== 'string') {
    console.error('[LoopController] No message found. inputs:', inputs);
    return {
      error: 'No user message provided to loop controller',
      iterations: [],
      completed: false,
    };
  }

  // Initialize loop state
  const iterations: any[] = [];
  let scratchpad = context.scratchpad || [];
  let completed = false;
  let iteration = 0;
  let finalResponse = '';
  let stuckReason: string | null = null;

  console.log(`[LoopController] Starting ReAct loop for: "${userMessage.substring(0, 80)}..."`);

  while (iteration < maxIterations && !completed && !stuckReason) {
    iteration++;
    console.log(`[LoopController] === Iteration ${iteration}/${maxIterations} ===`);

    try {
      // STEP 1: Plan next action
      const { reactPlannerExecutor } = await import('./operator-executors.js');
      const planResult = await reactPlannerExecutor(
        { userMessage, scratchpad },
        { ...context, scratchpad, iterationNumber: iteration },
        properties
      );

      if (!planResult || !planResult.plan) {
        stuckReason = 'Planning failed - no plan generated';
        break;
      }

      const plan = planResult.plan;
      console.log(`[LoopController] Plan: ${plan.substring(0, 150)}...`);

      // Update scratchpad with planning result
      scratchpad = planResult.scratchpad || scratchpad;

      // STEP 2: Check for completion before executing
      const { completionCheckerExecutor } = await import('./operator-executors.js');
      const preCheckResult = await completionCheckerExecutor(
        { userMessage, observation: plan },
        { ...context, scratchpad, iterationNumber: iteration },
        properties
      );

      if (preCheckResult?.complete === true) {
        console.log(`[LoopController] ✓ Completion detected in plan`);
        completed = true;
        finalResponse = plan;

        iterations.push({
          iteration,
          thought: plan,
          action: null,
          observation: null,
          complete: true,
        });
        break;
      }

      // STEP 3: Execute skill (if action present in plan)
      const { skillExecutorExecutor } = await import('./operator-executors.js');
      const skillResult = await skillExecutorExecutor(
        { plan },
        { ...context, scratchpad, iterationNumber: iteration },
        properties
      );

      if (!skillResult) {
        stuckReason = 'Skill execution failed - no result returned';
        break;
      }

      console.log(`[LoopController] Skill executed: ${skillResult.success ? '✓' : '✗'}`);

      // STEP 4: Format observation
      const { observationFormatterExecutor } = await import('./operator-executors.js');
      const observationResult = await observationFormatterExecutor(
        { skillResult },
        { ...context, scratchpad, iterationNumber: iteration },
        properties
      );

      const observation = observationResult?.observation || JSON.stringify(skillResult);
      console.log(`[LoopController] Observation: ${observation.substring(0, 150)}...`);

      // STEP 5: Check for completion after execution
      const postCheckResult = await completionCheckerExecutor(
        { userMessage, observation },
        { ...context, scratchpad, iterationNumber: iteration },
        properties
      );

      completed = postCheckResult?.complete === true;

      if (completed) {
        console.log(`[LoopController] ✓ Task completed after ${iteration} iterations`);
        finalResponse = observation;
      }

      // Track this iteration
      iterations.push({
        iteration,
        thought: plan,
        action: skillResult.skillId || null,
        observation,
        complete: completed,
        success: skillResult.success !== false,
      });

      // Update scratchpad with this step
      scratchpad.push({
        iteration,
        thought: plan.substring(0, 500), // Truncate for token efficiency
        action: skillResult.skillId || 'none',
        observation: observation.substring(0, 500),
        complete: completed,
      });

      // Trim scratchpad to last 10 steps (token management)
      if (scratchpad.length > 10) {
        scratchpad = scratchpad.slice(-10);
      }

      // STEP 6: Check for stuck state (failure loops)
      if (!completed && iteration >= 3) {
        const { stuckDetectorExecutor } = await import('./operator-executors.js');
        const stuckAnalysis = await stuckDetectorExecutor(
          [{ scratchpad }],
          { ...context, scratchpad, iterationNumber: iteration },
          { threshold: 3 }
        );

        if (stuckAnalysis.isStuck) {
          console.warn(`[LoopController] ⚠️  Stuck detected: ${stuckAnalysis.diagnosis}`);
          stuckReason = `${stuckAnalysis.diagnosis}. Suggestion: ${stuckAnalysis.suggestion}`;
          break;
        }
      }

    } catch (error) {
      console.error(`[LoopController] Error in iteration ${iteration}:`, error);
      stuckReason = `Exception in iteration ${iteration}: ${(error as Error).message}`;

      iterations.push({
        iteration,
        thought: null,
        action: null,
        observation: null,
        complete: false,
        error: (error as Error).message,
      });
      break;
    }
  }

  // Handle stuck state
  if (!completed && iteration >= maxIterations) {
    stuckReason = `Max iterations (${maxIterations}) reached without completion`;
  }

  if (stuckReason) {
    console.warn(`[LoopController] ❌ Stuck: ${stuckReason}`);
  }

  // If no final response, synthesize from last observation
  if (!finalResponse && iterations.length > 0) {
    const lastIteration = iterations[iterations.length - 1];
    finalResponse = lastIteration.observation || lastIteration.thought || '';
  }

  return {
    iterations,
    finalResponse,
    completed,
    iterationCount: iteration,
    scratchpad,
    stuck: !completed && !!stuckReason,
    stuckReason: stuckReason || undefined,
  };
};

/**
 * Conditional Branch Node
 * Routes execution based on a condition (if/else logic)
 */
export const conditionalBranchExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const condition = properties?.condition || 'value'; // Field to check
  const operator = properties?.operator || '=='; // Comparison operator
  const compareValue = properties?.compareValue; // Value to compare against

  const inputValue = inputs[0]?.[condition] ?? inputs[0];
  let conditionMet = false;

  switch (operator) {
    case '==':
    case 'equals':
      conditionMet = inputValue === compareValue;
      break;
    case '!=':
    case 'not_equals':
      conditionMet = inputValue !== compareValue;
      break;
    case '>':
    case 'greater_than':
      conditionMet = Number(inputValue) > Number(compareValue);
      break;
    case '<':
    case 'less_than':
      conditionMet = Number(inputValue) < Number(compareValue);
      break;
    case 'exists':
      conditionMet = inputValue !== null && inputValue !== undefined;
      break;
    case 'not_exists':
      conditionMet = inputValue === null || inputValue === undefined;
      break;
    case 'truthy':
      conditionMet = Boolean(inputValue);
      break;
    case 'falsy':
      conditionMet = !Boolean(inputValue);
      break;
    default:
      conditionMet = Boolean(inputValue);
  }

  return {
    conditionMet,
    value: inputValue,
    // Route to different output slots based on condition
    trueOutput: conditionMet ? inputs[0] : null,
    falseOutput: !conditionMet ? inputs[0] : null,
  };
};

/**
 * Switch Node
 * Multi-way routing based on a value (like cognitive mode router)
 */
export const switchExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const switchField = properties?.switchField || 'mode'; // Field to switch on
  const cases = properties?.cases || {}; // Map of case values to output slots
  const defaultCase = properties?.defaultCase || 'default';

  const switchValue = inputs[0]?.[switchField] ?? inputs[0];
  const matchedCase = cases[switchValue] || defaultCase;

  return {
    switchValue,
    matchedCase,
    output: inputs[0],
    // Create output for each case
    ...Object.keys(cases).reduce((acc, caseKey) => {
      acc[`output_${caseKey}`] = switchValue === caseKey ? inputs[0] : null;
      return acc;
    }, {} as Record<string, any>),
    output_default: matchedCase === defaultCase ? inputs[0] : null,
  };
};

/**
 * For Each Node
 * Iterates over an array, executing logic for each element
 */
export const forEachExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const arrayField = properties?.arrayField || 'items'; // Field containing array
  // TODO: bodyGraph property (sub-graph to execute for each item) not yet implemented

  const inputArray = inputs[0]?.[arrayField] || [];
  const results: any[] = [];

  // In a real implementation, we'd execute bodyGraph for each item
  // For now, just collect items with index
  for (let i = 0; i < inputArray.length; i++) {
    results.push({
      index: i,
      item: inputArray[i],
      // In production, this would be the result of executing bodyGraph with this item
    });
  }

  return {
    results,
    count: results.length,
    items: inputArray,
  };
};

/**
 * Conditional Router Node
 * Routes data flow based on conditions, enabling graph-level loops
 *
 * Inputs:
 *   - condition: boolean | string | object - The condition to evaluate
 *   - trueData: any - Data to pass if condition is true
 *   - falseData: any - Data to pass if condition is false
 *
 * Outputs:
 *   - routedData: any - The data selected based on condition
 *   - conditionMet: boolean - Whether condition was true
 *   - branch: 'true' | 'false' - Which branch was taken
 *
 * Note: The graph executor handles the actual routing to different nodes
 * via the 'routingDecision' field. This executor just evaluates the condition
 * and prepares the data.
 */
export const conditionalRouterExecutor: NodeExecutor = async (inputs, _context, _properties) => {
  if (process.env.DEBUG_GRAPH) console.log(`[ConditionalRouter] ========== ROUTER INVOKED ==========`);
  if (process.env.DEBUG_GRAPH) console.log(`[ConditionalRouter] Received ${inputs.length} inputs`);
  if (process.env.DEBUG_GRAPH) console.log(`[ConditionalRouter] Input[0]:`, {
    type: typeof inputs[0],
    keys: inputs[0] && typeof inputs[0] === 'object' ? Object.keys(inputs[0]) : [],
    isComplete: inputs[0]?.isComplete,
    condition: inputs[0]?.condition,
  });

  // Extract inputs
  const condition = inputs[0]?.condition ?? inputs[0]?.isComplete ?? inputs[0];
  const trueData = inputs[1]?.trueData ?? inputs[1];
  const falseData = inputs[2]?.falseData ?? inputs[2];

  if (process.env.DEBUG_GRAPH) console.log(`[ConditionalRouter] Extracted condition:`, {
    type: typeof condition,
    value: condition,
    isComplete: inputs[0]?.isComplete,
  });

  // Evaluate condition
  let conditionMet = false;

  if (typeof condition === 'boolean') {
    conditionMet = condition;
    console.log(`[ConditionalRouter] Boolean condition: ${conditionMet}`);
  } else if (typeof condition === 'string') {
    conditionMet = condition.toLowerCase() === 'true' || condition === '1';
    console.log(`[ConditionalRouter] String condition "${condition}": ${conditionMet}`);
  } else if (typeof condition === 'object' && condition !== null) {
    // Handle objects with isComplete, isDone, or shouldContinue fields
    conditionMet = Boolean(
      condition.isComplete ||
      condition.isDone ||
      condition.shouldContinue ||
      condition.value
    );
    console.log(`[ConditionalRouter] Object condition:`, {
      isComplete: condition.isComplete,
      isDone: condition.isDone,
      shouldContinue: condition.shouldContinue,
      value: condition.value,
      evaluated: conditionMet,
    });
  } else if (typeof condition === 'number') {
    conditionMet = condition !== 0;
    console.log(`[ConditionalRouter] Number condition ${condition}: ${conditionMet}`);
  } else {
    conditionMet = Boolean(condition);
    console.log(`[ConditionalRouter] Default boolean cast: ${conditionMet}`);
  }

  // Select data based on condition
  const routedData = conditionMet ? trueData : falseData;
  const branch = conditionMet ? 'true' : 'false';

  if (process.env.DEBUG_GRAPH) console.log(`[ConditionalRouter] ===== ROUTING DECISION =====`);
  if (process.env.DEBUG_GRAPH) console.log(`[ConditionalRouter] Condition Met: ${conditionMet}`);
  if (process.env.DEBUG_GRAPH) console.log(`[ConditionalRouter] Branch: ${branch}`);
  if (process.env.DEBUG_GRAPH) console.log(`[ConditionalRouter] ${branch === 'true' ? '✅ EXITING LOOP (slot 0)' : '🔄 CONTINUING LOOP (slot 1)'}`);
  if (process.env.DEBUG_GRAPH) console.log(`[ConditionalRouter] ==============================`);

  return {
    routedData,
    conditionMet,
    branch,
    // This special field tells the graph executor which output slot to activate
    routingDecision: branch,
  };
};

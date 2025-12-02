/**
 * Loop Controller Node
 *
 * Implements iterative ReAct execution with max iterations and completion detection
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const LoopControllerNode: NodeDefinition = defineNode({
  id: 'loop_controller',
  name: 'Loop Controller',
  category: 'control_flow',
  inputs: [
    { name: 'input', type: 'any', description: 'Loop input data' },
    { name: 'message', type: 'string', optional: true, description: 'User message' },
  ],
  outputs: [
    { name: 'iterations', type: 'array', description: 'All iteration results' },
    { name: 'finalResponse', type: 'string', description: 'Final response' },
    { name: 'completed', type: 'boolean', description: 'Whether loop completed' },
    { name: 'iterationCount', type: 'number', description: 'Number of iterations' },
  ],
  properties: {
    maxIterations: 10,
  },
  propertySchemas: {
    maxIterations: {
      type: 'slider',
      default: 10,
      label: 'Max Iterations',
      min: 1,
      max: 20,
      step: 1,
    },
  },
  description: 'Implements iterative ReAct execution with max iterations',

  execute: async (inputs, context, properties) => {
    const maxIterations = properties?.maxIterations || 10;

    let userMessage = '';
    if (typeof inputs[1] === 'object' && inputs[1]?.message) {
      userMessage = inputs[1].message;
    } else if (typeof inputs[0] === 'string') {
      userMessage = inputs[0];
    } else if (context.userMessage) {
      userMessage = context.userMessage;
    }

    if (!userMessage || typeof userMessage !== 'string') {
      return {
        error: 'No user message provided',
        iterations: [],
        completed: false,
      };
    }

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
        // Import executors dynamically to avoid circular deps
        const { reactPlannerExecutor, skillExecutorExecutor, observationFormatterExecutor, completionCheckerExecutor, stuckDetectorExecutor } = await import('../../node-executors/operator-executors.js');

        // STEP 1: Plan
        const planResult = await reactPlannerExecutor(
          { userMessage, scratchpad },
          { ...context, scratchpad, iterationNumber: iteration },
          properties
        );

        if (!planResult || !planResult.plan) {
          stuckReason = 'Planning failed';
          break;
        }

        const plan = planResult.plan;
        scratchpad = planResult.scratchpad || scratchpad;

        // STEP 2: Pre-check completion
        const preCheckResult = await completionCheckerExecutor(
          { userMessage, observation: plan },
          { ...context, scratchpad, iterationNumber: iteration },
          properties
        );

        if (preCheckResult?.complete === true) {
          completed = true;
          finalResponse = plan;
          iterations.push({ iteration, thought: plan, complete: true });
          break;
        }

        // STEP 3: Execute skill
        const skillResult = await skillExecutorExecutor(
          { plan },
          { ...context, scratchpad, iterationNumber: iteration },
          properties
        );

        if (!skillResult) {
          stuckReason = 'Skill execution failed';
          break;
        }

        // STEP 4: Format observation
        const observationResult = await observationFormatterExecutor(
          { skillResult },
          { ...context, scratchpad, iterationNumber: iteration },
          properties
        );

        const observation = observationResult?.observation || JSON.stringify(skillResult);

        // STEP 5: Post-check completion
        const postCheckResult = await completionCheckerExecutor(
          { userMessage, observation },
          { ...context, scratchpad, iterationNumber: iteration },
          properties
        );

        completed = postCheckResult?.complete === true;
        if (completed) finalResponse = observation;

        iterations.push({
          iteration,
          thought: plan,
          action: skillResult.skillId || null,
          observation,
          complete: completed,
          success: skillResult.success !== false,
        });

        scratchpad.push({
          iteration,
          thought: plan.substring(0, 500),
          action: skillResult.skillId || 'none',
          observation: observation.substring(0, 500),
          complete: completed,
        });

        if (scratchpad.length > 10) scratchpad = scratchpad.slice(-10);

        // STEP 6: Check stuck state
        if (!completed && iteration >= 3) {
          const stuckAnalysis = await stuckDetectorExecutor(
            [{ scratchpad }],
            { ...context, scratchpad, iterationNumber: iteration },
            { threshold: 3 }
          );

          if (stuckAnalysis.isStuck) {
            stuckReason = `${stuckAnalysis.diagnosis}. Suggestion: ${stuckAnalysis.suggestion}`;
            break;
          }
        }

      } catch (error) {
        stuckReason = `Exception: ${(error as Error).message}`;
        iterations.push({ iteration, error: (error as Error).message });
        break;
      }
    }

    if (!completed && iteration >= maxIterations) {
      stuckReason = `Max iterations (${maxIterations}) reached`;
    }

    if (!finalResponse && iterations.length > 0) {
      const last = iterations[iterations.length - 1];
      finalResponse = last.observation || last.thought || '';
    }

    return {
      iterations,
      finalResponse,
      completed,
      iterationCount: iteration,
      scratchpad,
      stuck: !completed && !!stuckReason,
      stuckReason,
    };
  },
});

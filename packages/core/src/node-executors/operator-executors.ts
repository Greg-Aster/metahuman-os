/**
 * Operator Node Executors
 * Handles ReAct loop components: planning, skill execution, observation formatting, completion checking, etc.
 */

import { executeSkill, listSkills, type TrustLevel } from '../skills.js';
import { callLLM } from '../model-router.js';
import { captureEvent } from '../memory.js';
import { canWriteMemory, shouldCaptureTool } from '../memory-policy.js';
import type { CognitiveModeId } from '../cognitive-mode.js';
import type { NodeExecutor } from './types.js';

/**
 * ReAct Planner Node
 * Plans the next action using ReAct reasoning
 */
export const reactPlannerExecutor: NodeExecutor = async (inputs, context) => {
  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] ENTRY - context.useOperator =`, context.useOperator);

  if (context.useOperator === false) {
    // Signal immediate completion - bypass operator loop
    // Return plan field (not thought) to match normal planner output format
    // Scratchpad updater expects planOutput.plan, not planOutput.thought
    const bypassResult = {
      plan: 'Final Answer: User query is conversational, not requiring operator tools.',
      iteration: 0,
      maxIterations: 10,
      scratchpad: [],
    };
    if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] BYPASSING OPERATOR - Returning:`, JSON.stringify(bypassResult, null, 2));
    return bypassResult;
  }

  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] ========== REACT PLANNER ==========`);
  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] Received ${inputs.length} inputs`);
  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] Input[0] (iteration state):`, JSON.stringify({
    type: typeof inputs[0],
    keys: inputs[0] ? Object.keys(inputs[0]) : [],
  }));
  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] Input[1] (user message):`, typeof inputs[1]);
  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] Input[2] (context):`, JSON.stringify({
    type: typeof inputs[2],
    keys: inputs[2] ? Object.keys(inputs[2]) : [],
  }));

  // Extract scratchpad from iteration counter output (inputs[0])
  const scratchpadData = inputs[0] || {};
  const iteration = scratchpadData.iteration || 0;
  const maxIterations = scratchpadData.maxIterations || 10;

  // Ensure scratchpad is always an array
  let scratchpad: any[] = [];
  const scratchpadInput = scratchpadData.scratchpad;

  if (Array.isArray(scratchpadInput)) {
    scratchpad = scratchpadInput;
  } else if (scratchpadInput && typeof scratchpadInput === 'string') {
    scratchpad = scratchpadInput
      .split(/\n{2,}/)
      .map(entry => ({ thought: entry.trim(), action: '', observation: '' }));
  } else if (scratchpadInput && typeof scratchpadInput === 'object') {
    scratchpad = [scratchpadInput];
  } else if (scratchpadInput === null || scratchpadInput === undefined) {
    scratchpad = [];
  } else {
    // Unknown type - convert to empty array and log warning
    console.warn('[ReactPlanner] Unexpected scratchpad type:', typeof scratchpadInput, scratchpadInput);
    scratchpad = [];
  }

  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] Iteration: ${iteration}/${maxIterations}, scratchpadLength: ${scratchpad.length}`);

  // Get available skills for planning
  const skills = listSkills();
  const skillDescriptions = skills.map(s => `- ${s.id}: ${s.description}`).join('\n');

  // Extract user message (inputs[1])
  const userMessage = typeof inputs[1] === 'string' ? inputs[1] : (inputs[1]?.message || context.userMessage || '');

  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] User message: "${userMessage.substring(0, 80)}..."`);

  const messages = [
    {
      role: 'system' as const,
      content: `You are a ReAct planner. Your job is to plan the next action to take based on the user's query and available skills.

Available Skills:
${skillDescriptions}

IMPORTANT: Use "Final Answer:" for conversational responses. Only use skills when you need to take an actual action (read files, create tasks, search data, etc.). Do NOT use conversational_response skill - just use Final Answer directly.

Output your response in this format:

If you need to use a tool/skill:
Thought: [your reasoning]
Action: [skill_id]
Action Input: {"param": "value"}

If you can answer directly without tools:
Thought: [your reasoning]
Final Answer: [your response]`,
    },
    {
      role: 'user' as const,
      content: `Query: ${userMessage}

Scratchpad:
${scratchpad.map((s: any) => `${s.thought}\n${s.action}\n${s.observation}`).join('\n\n')}

What should I do next?`,
    },
  ];

  try {
    console.log(`[ReactPlanner] Calling LLM for planning...`);
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 1024,
        repeatPenalty: 1.15,
        temperature: 0.5,
      },
    });

    console.log(`[ReactPlanner] LLM response: "${response.content.substring(0, 150)}..."`);
    if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] ==========================================`);

    return {
      plan: response.content,
      iteration,  // Pass through
      maxIterations,  // Pass through
      scratchpad,  // Pass through current scratchpad (before update)
    };
  } catch (error) {
    console.error('[ReActPlanner] Error:', error);
    throw new Error(`ReAct planning failed: ${(error as Error).message}`);
  }
};

/**
 * Skill Executor Node
 * Executes a specific skill based on the plan and captures tool invocations to memory
 */
export const skillExecutorExecutor: NodeExecutor = async (inputs, context) => {
  console.log('[SkillExecutor] ========== SKILL EXECUTOR ENTRY ==========');
  console.log('[SkillExecutor] useOperator:', context.useOperator);
  console.log('[SkillExecutor] Inputs:', inputs.length, 'items');
  console.log('[SkillExecutor] Input[0] type:', typeof inputs[0], 'keys:', inputs[0] ? Object.keys(inputs[0]) : []);

  if (context.useOperator === false) {
    console.log('[SkillExecutor] EARLY RETURN: useOperator === false');
    return {};
  }

  // Handle both string and object inputs (react_planner returns { plan: string })
  const planInput = inputs[0] || '';
  const plan = typeof planInput === 'object' && planInput.plan ? planInput.plan : planInput;

  console.log('[SkillExecutor] Plan type:', typeof plan);
  if (typeof plan === 'string') {
    console.log('[SkillExecutor] Plan length:', plan.length);
    console.log('[SkillExecutor] Full plan:', plan);
  }

  if (typeof plan !== 'string') {
    console.error('[SkillExecutor] Expected string plan, got:', typeof plan, plan);
    return {
      success: false,
      error: `Invalid plan type: ${typeof plan}`,
      outputs: {},
    };
  }

  const maxRetries = 2; // Maximum retry attempts per skill execution
  const retryCount = context.retryCount || 0;

  // Check if this is a Final Answer (no action to execute)
  console.log('[SkillExecutor] Checking for "Final Answer:" in plan...');
  const finalAnswerMatch = plan.match(/Final Answer:\s*(.+)/is);
  console.log('[SkillExecutor] finalAnswerMatch:', finalAnswerMatch ? `Found: "${finalAnswerMatch[1].substring(0, 100)}..."` : 'NOT FOUND');

  if (finalAnswerMatch) {
    const finalAnswer = finalAnswerMatch[1].trim();
    console.log('[SkillExecutor] ✅ Detected Final Answer, passing through to ResponseSynthesizer');
    console.log('[SkillExecutor] finalAnswer length:', finalAnswer.length);
    return {
      success: true,
      finalResponse: finalAnswer,
      outputs: {
        response: finalAnswer,
      },
    };
  }

  // Parse the plan to extract skill_id and inputs
  // This is a simplified parser - in production you'd want more robust parsing
  const actionMatch = plan.match(/Action:\s*(\w+)/i);
  const inputMatch = plan.match(/Action Input:\s*({[\s\S]*?})/i);

  if (!actionMatch) {
    return {
      success: false,
      error: 'No action found in plan',
      outputs: {},
    };
  }

  const skillId = actionMatch[1];
  let skillInputs = {};

  if (inputMatch) {
    try {
      skillInputs = JSON.parse(inputMatch[1]);
    } catch (e) {
      console.error('[SkillExecutor] Failed to parse skill inputs:', e);
    }
  }

  const startTime = Date.now();
  let result;
  let error: string | undefined;
  let errorRecoveryAnalysis: any = null;

  try {
    const trustLevel: TrustLevel = 'supervised_auto';
    // Auto-approve skills when yolo mode is enabled
    // Orchestrator already performed permission pre-checks, so we can safely bypass approval queue
    const autoApprove = context.yoloMode === true;
    result = await executeSkill(skillId, skillInputs, trustLevel, autoApprove);
    error = result.error;

    // If execution failed and we haven't exhausted retries, analyze error for recovery
    if (!result.success && result.error && retryCount < maxRetries) {
      console.log(`[SkillExecutor] Skill ${skillId} failed (retry ${retryCount}/${maxRetries}), analyzing error...`);

      // Call error recovery executor to categorize and determine if we should retry
      errorRecoveryAnalysis = await errorRecoveryExecutor(
        [{ error: result.error, skillId, retryCount }],
        context,
        { maxRetries }
      );

      if (errorRecoveryAnalysis.shouldRetry) {
        console.log(`[SkillExecutor] Error type: ${errorRecoveryAnalysis.errorType}, retrying...`);
        console.log(`[SkillExecutor] Suggestions: ${errorRecoveryAnalysis.suggestions.join(', ')}`);

        // Wait briefly before retry (exponential backoff)
        const delayMs = Math.min(1000 * Math.pow(2, retryCount), 5000);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // Retry the skill execution (use same autoApprove setting)
        const retryResult = await executeSkill(skillId, skillInputs, trustLevel, autoApprove);

        if (retryResult.success) {
          console.log(`[SkillExecutor] ✓ Retry succeeded for ${skillId}`);
          result = retryResult;
          error = undefined;
        } else {
          console.log(`[SkillExecutor] ✗ Retry failed for ${skillId}: ${retryResult.error}`);
          result = retryResult;
          error = retryResult.error;
        }
      } else {
        console.log(`[SkillExecutor] Error type ${errorRecoveryAnalysis.errorType} is not retryable`);
      }
    }
  } catch (err) {
    console.error('[SkillExecutor] Error executing skill:', err);
    result = {
      success: false,
      outputs: {},
      error: (err as Error).message,
    };
    error = (err as Error).message;
  }

  const executionTimeMs = Date.now() - startTime;

  // Capture tool invocation to memory (if enabled)
  const cognitiveMode = (context.cognitiveMode || 'dual') as CognitiveModeId;
  const allowMemoryWrites = context.allowMemoryWrites !== false;
  const canWrite = canWriteMemory(cognitiveMode, 'tool_invocation');
  const shouldCapture = shouldCaptureTool(cognitiveMode, skillId);

  if (allowMemoryWrites && canWrite && shouldCapture) {
    try {
      captureEvent(`Invoked skill: ${skillId}`, {
        type: 'tool_invocation',
        metadata: {
          cognitiveMode,
          sessionId: context.sessionId,
          conversationId: context.conversationId,
          parentEventId: context.parentEventId,
          toolName: skillId,
          toolInputs: skillInputs,
          toolOutputs: result.outputs || {},
          success: result.success !== false,
          error,
          executionTimeMs,
          iterationNumber: context.iterationNumber,
        },
        tags: ['tool', skillId, 'operator', 'react'],
      });

      console.log(`[SkillExecutor] ✓ Captured tool_invocation: ${skillId} (${executionTimeMs}ms)`);
    } catch (captureError) {
      console.error('[SkillExecutor] Failed to capture tool invocation:', captureError);
      // Don't fail the execution if memory capture fails
    }
  }

  return {
    success: result.success,
    outputs: result.outputs || {},
    error,
    skillId,
    executionTimeMs,
    retryCount,
    errorRecovery: errorRecoveryAnalysis ? {
      errorType: errorRecoveryAnalysis.errorType,
      suggestions: errorRecoveryAnalysis.suggestions,
      wasRetried: errorRecoveryAnalysis.shouldRetry,
    } : undefined,
  };
};

/**
 * Observation Formatter Node
 * Formats skill execution results for the scratchpad
 */
export const observationFormatterExecutor: NodeExecutor = async (inputs) => {
  if (!inputs || Object.keys(inputs).length === 0) {
    return {};
  }

  const skillResult = inputs[0] || {};

  let observation = '';
  if (skillResult.success) {
    observation = `Observation: ${JSON.stringify(skillResult.outputs, null, 2)}`;
  } else {
    observation = `Observation: Error - ${skillResult.error}`;

    // Include error recovery suggestions if available
    if (skillResult.errorRecovery) {
      const { errorType, suggestions, wasRetried } = skillResult.errorRecovery;
      observation += `\nError Type: ${errorType}`;

      if (wasRetried) {
        observation += ` (auto-retry attempted)`;
      }

      if (suggestions && suggestions.length > 0) {
        observation += `\nSuggestions:\n${suggestions.map((s: string) => `  - ${s}`).join('\n')}`;
      }
    }
  }

  return {
    observation,
    scratchpad: [...(inputs[1] || []), { observation }],
  };
};

/**
 * Completion Checker Node
 * Checks if the task is complete based on the plan
 */
export const completionCheckerExecutor: NodeExecutor = async (inputs) => {
  if (!inputs || Object.keys(inputs).length === 0) {
    return {};
  }

  const plan = inputs[0] || '';

  const isComplete = plan.toLowerCase().includes('final answer');

  return {
    complete: isComplete,
    plan,
  };
};

/**
 * Response Synthesizer Node
 * Synthesizes final response from loop controller output or scratchpad
 */
export const responseSynthesizerExecutor: NodeExecutor = async (inputs, context) => {
  console.log(`[ResponseSynthesizer] ========== RESPONSE SYNTHESIZER ==========`);
  console.log(`[ResponseSynthesizer] Received ${inputs.length} inputs`);
  console.log(`[ResponseSynthesizer] Input[0]:`, {
    type: typeof inputs[0],
    keys: inputs[0] ? Object.keys(inputs[0]) : [],
  });
  console.log(`[ResponseSynthesizer] Input[1]:`, {
    type: typeof inputs[1],
    keys: inputs[1] ? Object.keys(inputs[1]) : [],
  });

  // Check if inputs[1] has the SkillExecutor output (slot 1 in agent-mode graph)
  if (inputs[1]) {
    console.log(`[ResponseSynthesizer] Checking inputs[1] for response data...`);
    console.log(`[ResponseSynthesizer] inputs[1].finalResponse:`, inputs[1].finalResponse ? `"${inputs[1].finalResponse.substring(0, 50)}..."` : 'undefined');
    console.log(`[ResponseSynthesizer] inputs[1].outputs:`, inputs[1].outputs);

    if (inputs[1].finalResponse) {
      console.log(`[ResponseSynthesizer] ✅ Found finalResponse in inputs[1] (SkillExecutor output)`);
      console.log(`[ResponseSynthesizer] finalResponse: "${inputs[1].finalResponse.substring(0, 100)}..."`);
      return {
        response: inputs[1].finalResponse,
        skillExecutorOutput: true,
      };
    }

    if (inputs[1].outputs && inputs[1].outputs.response) {
      console.log(`[ResponseSynthesizer] ✅ Found response in inputs[1].outputs (SkillExecutor output)`);
      console.log(`[ResponseSynthesizer] response: "${inputs[1].outputs.response.substring(0, 100)}..."`);
      return {
        response: inputs[1].outputs.response,
        skillExecutorOutput: true,
      };
    }
  }

  // Extract loop result or scratchpad
  let loopResult = inputs[0] || inputs.loopResult || {};

  // Check if this is pre-formatted output from scratchpad_formatter
  if (loopResult.formatted && typeof loopResult.formatted === 'string') {
    console.log(`[ResponseSynthesizer] Received pre-formatted scratchpad from formatter (${loopResult.entries} entries)`);

    // Extract the response from the formatted scratchpad
    // Look for "Observation: " followed by JSON
    const obsIndex = loopResult.formatted.indexOf('Observation: ');
    if (obsIndex !== -1) {
      const jsonStart = loopResult.formatted.indexOf('{', obsIndex);
      if (jsonStart !== -1) {
        // Find the matching closing brace using simple brace counting
        let braceCount = 0;
        let jsonEnd = -1;
        for (let i = jsonStart; i < loopResult.formatted.length; i++) {
          if (loopResult.formatted[i] === '{') braceCount++;
          if (loopResult.formatted[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }

        if (jsonEnd !== -1) {
          try {
            const jsonStr = loopResult.formatted.substring(jsonStart, jsonEnd);
            const observation = JSON.parse(jsonStr);
            if (observation.success && observation.outputs && observation.outputs.response) {
              console.log(`[ResponseSynthesizer] ✅ Extracted response from observation`);
              if (process.env.DEBUG_GRAPH) console.log(`[ResponseSynthesizer] ==========================================`);
              return {
                response: observation.outputs.response,
                formatted: loopResult.formatted,
                entries: loopResult.entries,
              };
            }
          } catch (err) {
            console.warn(`[ResponseSynthesizer] Failed to parse observation JSON`);
          }
        }
      }
    }

    console.log(`[ResponseSynthesizer] Could not extract response, continuing to synthesis`);
  }

  // Unwrap routedData if present (from conditional_router)
  if (loopResult.routedData) {
    console.log(`[ResponseSynthesizer] Unwrapping routedData from conditional_router`);
    loopResult = loopResult.routedData;
  }

  const userMessage = inputs[1] || inputs.userMessage || context.userMessage || '';

  // Handle loop controller output format
  let scratchpad: any[] = [];
  let finalResponse = '';

  if (loopResult.scratchpad && Array.isArray(loopResult.scratchpad)) {
    // Loop controller format: extract scratchpad and finalResponse
    scratchpad = loopResult.scratchpad;
    finalResponse = loopResult.finalResponse || '';
    console.log(`[ResponseSynthesizer] Extracted scratchpad from loopResult.scratchpad: ${scratchpad.length} entries`);
  } else if (Array.isArray(loopResult)) {
    // Direct scratchpad array
    scratchpad = loopResult;
    console.log(`[ResponseSynthesizer] Using loopResult as direct scratchpad array: ${scratchpad.length} entries`);
  } else if (loopResult.iterations && Array.isArray(loopResult.iterations)) {
    // Use iterations as scratchpad fallback
    scratchpad = loopResult.iterations;
    finalResponse = loopResult.finalResponse || '';
    console.log(`[ResponseSynthesizer] Extracted scratchpad from loopResult.iterations: ${scratchpad.length} entries`);
  } else {
    console.warn(`[ResponseSynthesizer] Could not extract scratchpad. loopResult structure:`, {
      hasScratchpad: !!loopResult.scratchpad,
      isArray: Array.isArray(loopResult),
      hasIterations: !!loopResult.iterations,
      keys: Object.keys(loopResult || {}),
    });
  }

  // If loop controller already has a finalResponse, use it directly
  if (finalResponse && finalResponse.trim().length > 0) {
    console.log('[ResponseSynthesizer] Using final response from loop controller');
    if (process.env.DEBUG_GRAPH) console.log(`[ResponseSynthesizer] =======================================================================`);
    return {
      response: finalResponse,
      loopComplete: loopResult.completed,
      iterations: loopResult.iterationCount,
    };
  }

  // Otherwise synthesize from scratchpad
  console.log('[ResponseSynthesizer] Synthesizing from scratchpad:', scratchpad.length, 'steps');

  if (scratchpad.length === 0) {
    console.warn('[ResponseSynthesizer] No scratchpad data available');
    return {
      response: 'I was unable to process your request.',
      error: 'Empty scratchpad',
    };
  }

  // Fast-path: extract the latest observation response without calling an LLM
  const latest = scratchpad[scratchpad.length - 1] || {};
  const obsText = latest.observation || '';

  // Try to parse observation as JSON and pull { outputs: { response } }
  try {
    const parsed = typeof obsText === 'string' ? JSON.parse(obsText) : obsText;
    const candidate = parsed?.outputs?.response || parsed?.response;
    if (candidate && typeof candidate === 'string') {
      console.log('[ResponseSynthesizer] Using response from last observation (fast-path)');
      return {
        response: candidate,
        loopComplete: loopResult.completed,
        iterations: scratchpad.length,
      };
    }
  } catch {
    // Observation wasn't JSON – fall through to LLM-based synthesis
  }

  const messages = [
    {
      role: 'system' as const,
      content: 'You are a response synthesizer. Create a natural, conversational response based on the observations gathered during task execution.',
    },
    {
      role: 'user' as const,
      content: `Original Query: ${userMessage}

Execution Steps:
${scratchpad.map((s: any, i: number) => `Step ${i + 1}:
Thought: ${s.thought || s.plan || 'N/A'}
Action: ${s.action || 'none'}
Observation: ${s.observation || 'N/A'}
`).join('\n')}

Based on these execution steps, provide a clear, helpful response to the user's original query:`,
    },
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 2048,
        repeatPenalty: 1.2,  // Increased from 1.20 to match persona_llm settings
        temperature: 0.7,
      },
    });

    return {
      response: response.content,
      loopComplete: loopResult.completed,
      iterations: scratchpad.length,
    };
  } catch (error) {
    console.error('[ResponseSynthesizer] Error:', error);
    return {
      response: finalResponse || 'I encountered an error while processing your request.',
      error: (error as Error).message,
    };
  }
};

/**
 * Plan Parser Node
 * Parses ReAct-style planning output into structured components
 */
export const planParserExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const format = properties?.format || 'react'; // react, json, freeform
  const planText = inputs[0]?.plan || inputs[0] || '';

  try {
    if (format === 'react') {
      // Parse ReAct format: "Thought: ... Action: ... Action Input: ..."
      const thoughtMatch = planText.match(/Thought:\s*([\s\S]*?)(?=\n(?:Action|Final Answer):|$)/i);
      const actionMatch = planText.match(/Action:\s*(\w+)/i);
      const actionInputMatch = planText.match(/Action Input:\s*({[\s\S]*?}|\S+)/i);
      const finalAnswerMatch = planText.match(/Final Answer:\s*([\s\S]*)/i);

      return {
        thought: thoughtMatch?.[1]?.trim() || '',
        action: actionMatch?.[1]?.trim() || null,
        actionInput: actionInputMatch?.[1]?.trim() || '{}',
        respond: finalAnswerMatch?.[1]?.trim() || null,
        parsed: true,
        format: 'react',
      };
    } else if (format === 'json') {
      // Parse JSON format
      const parsed = JSON.parse(planText);
      return {
        ...parsed,
        parsed: true,
        format: 'json',
      };
    } else {
      // Freeform - just return as-is
      return {
        text: planText,
        parsed: true,
        format: 'freeform',
      };
    }
  } catch (error) {
    console.error('[PlanParser] Error:', error);
    return {
      thought: '',
      action: null,
      respond: null,
      parsed: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Error Recovery Node
 * Provides smart retry suggestions based on error type and context
 */
export const errorRecoveryExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const error = inputs[0]?.error || inputs[0] || '';
  const skillId = inputs[0]?.skillId || '';
  const maxRetries = properties?.maxRetries || 3;
  const retryCount = inputs[0]?.retryCount || 0;

  try {
    // Categorize error type
    let errorType = 'UNKNOWN';
    let suggestions: string[] = [];

    const errorStr = String(error).toLowerCase();

    // Check for path restriction errors (most specific first)
    if (errorStr.includes('path_not_allowed') || errorStr.includes('write not allowed')) {
      errorType = 'PATH_RESTRICTED';
      // Extract allowed directories from error message if present
      const match = String(error).match(/allowed:\s*([^.]+)/i);
      if (match) {
        const allowedDirs = match[1].trim();
        suggestions = [
          `This path is restricted. Use one of these directories: ${allowedDirs}`,
          `Do NOT retry with the same path - it will always fail`,
          `Use conversational_response to explain the restriction to the user`,
        ];
      } else {
        suggestions = [
          `This path is restricted by security policy`,
          `Check the skill's allowedDirectories in the manifest`,
          `Use conversational_response to explain the restriction to the user`,
        ];
      }
    } else if (errorStr.includes('failed validation')) {
      errorType = 'VALIDATION_FAILED';
      suggestions = [
        `The input parameters don't meet requirements`,
        `Check the skill manifest for parameter constraints`,
        `Do NOT retry with the same inputs`,
        `Use conversational_response to explain the validation error to the user`,
      ];
    } else if (errorStr.includes('not found') || errorStr.includes('enoent')) {
      errorType = 'FILE_NOT_FOUND';
      suggestions = [
        `Try using fs_list to check what files are available`,
        `Verify the file path is correct`,
        `Check if the file exists in a different directory`,
      ];
    } else if (errorStr.includes('permission') || errorStr.includes('eacces')) {
      errorType = 'PERMISSION_DENIED';
      suggestions = [
        `Check file permissions`,
        `Try accessing with different user privileges`,
        `Verify you have write access to the directory`,
      ];
    } else if (errorStr.includes('invalid') || errorStr.includes('parse')) {
      errorType = 'INVALID_ARGS';
      suggestions = [
        `Check the format of your input arguments`,
        `Verify JSON syntax if passing JSON data`,
        `Review the skill's required parameters`,
      ];
    } else if (errorStr.includes('timeout')) {
      errorType = 'TIMEOUT';
      suggestions = [
        `Retry the operation`,
        `Break the task into smaller steps`,
        `Check if the service is responsive`,
      ];
    } else if (errorStr.includes('network') || errorStr.includes('connection')) {
      errorType = 'NETWORK_ERROR';
      suggestions = [
        `Check network connectivity`,
        `Retry after a brief delay`,
        `Verify the service endpoint is accessible`,
      ];
    }

    // Determine if we should retry
    // ONLY retry transient errors (timeouts, network issues, invalid args)
    // DO NOT retry: PATH_RESTRICTED, VALIDATION_FAILED, PERMISSION_DENIED, FILE_NOT_FOUND
    const shouldRetry = retryCount < maxRetries && (
      errorType === 'TIMEOUT' ||
      errorType === 'NETWORK_ERROR' ||
      errorType === 'INVALID_ARGS'
    );

    return {
      errorType,
      suggestions,
      shouldRetry,
      retryCount: retryCount + 1,
      error,
      skillId,
    };
  } catch (err) {
    console.error('[ErrorRecovery] Error:', err);
    return {
      errorType: 'UNKNOWN',
      suggestions: [],
      shouldRetry: false,
      retryCount,
      error: (err as Error).message,
    };
  }
};

/**
 * Stuck Detector Node
 * Detects failure loops and repeated unsuccessful actions
 */
export const stuckDetectorExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const threshold = properties?.threshold || 3; // Number of consecutive failures to consider "stuck"
  const scratchpad = inputs[0]?.scratchpad || inputs[0] || [];

  try {
    // Analyze scratchpad for patterns
    let consecutiveFailures = 0;
    const recentActions: string[] = [];

    // Count consecutive failures from the end
    for (let i = scratchpad.length - 1; i >= 0; i--) {
      const step = scratchpad[i];
      const observation = step.observation || '';
      const action = step.action || '';

      if (observation.toLowerCase().includes('error') || observation.toLowerCase().includes('failed')) {
        consecutiveFailures++;
        if (action) recentActions.push(action);
      } else {
        break; // Stop at first success
      }
    }

    // Check for repeated actions (same action attempted multiple times)
    const actionCounts = recentActions.reduce((acc, action) => {
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const maxRepeats = Math.max(...Object.values(actionCounts), 0);
    const isRepeating = maxRepeats >= 2;

    // Determine if stuck
    const isStuck = consecutiveFailures >= threshold;

    let diagnosis = '';
    let suggestion = '';

    if (isStuck) {
      if (isRepeating) {
        diagnosis = `Detected ${consecutiveFailures} consecutive failures with repeated action attempts`;
        suggestion = `Try a different approach - the current action is not working`;
      } else {
        diagnosis = `Detected ${consecutiveFailures} consecutive failures`;
        suggestion = `Review the error messages and adjust your strategy`;
      }
    }

    return {
      isStuck,
      consecutiveFailures,
      isRepeating,
      diagnosis,
      suggestion,
      threshold,
    };
  } catch (error) {
    console.error('[StuckDetector] Error:', error);
    return {
      isStuck: false,
      consecutiveFailures: 0,
      isRepeating: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Operator Node Executors
 * Handles ReAct loop components: planning, skill execution, observation formatting, completion checking, etc.
 */

import { executeSkill, listSkills, type TrustLevel } from '../skills.js';
import { callLLM } from '../model-router.js';
import { captureEvent } from '../memory.js';
import { canWriteMemory, shouldCaptureTool } from '../memory-policy.js';
import { getIdentitySummary } from '../identity.js';
import type { CognitiveModeId } from '../cognitive-mode.js';
import type { NodeExecutor } from './types.js';
import { formatObservation } from '../operator/observation-formatter.js';

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

  // Extract conversation history for context continuity across turns
  const conversationHistory = context.conversationHistory || [];
  const recentHistory = conversationHistory.slice(-4); // Last 2 exchanges (4 messages)
  const historyText = recentHistory.length > 0
    ? recentHistory.map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')
    : 'No previous conversation';

  // Extract user context for profile-aware file operations
  const username = context.username || 'anonymous';
  const userRole = context.role || 'anonymous';
  const isOwner = userRole === 'owner';
  const profilePath = username !== 'anonymous' ? `profiles/${username}` : null;

  // Build profile-aware search strategy guidance
  let searchStrategyGuidance = '';
  if (profilePath) {
    searchStrategyGuidance = `
YOUR PROFILE CONTEXT:
- Username: ${username}
- Role: ${userRole}
- Your profile directory: ${profilePath}/
- Your output directory: ${profilePath}/out/

FILE SEARCH STRATEGY (follow this order):
1. **First**: Search your profile's out directory: {"pattern": "filename", "cwd": "${profilePath}/out"}
2. **Second**: Search your entire profile: {"pattern": "**/filename", "cwd": "${profilePath}"}
${isOwner ? '3. **Third** (owner privilege): Search entire project: {"pattern": "**/filename"}' : ''}

FILE WRITE STRATEGY:
- **Default location**: ALWAYS write files to "${profilePath}/out/" unless user specifies otherwise
- Example: To create "notes.md", use path "${profilePath}/out/notes.md"
- If user provides explicit path (e.g., "docs/file.md"), use that path directly
${isOwner ? '- As owner, you CAN write to system directories (e.g., "out/", "docs/"), but prefer your profile directory' : ''}

IMPORTANT:
- ALWAYS start searches in your profile directories (${profilePath}/)
- ALWAYS write files to your profile out directory (${profilePath}/out/) by default
- Use recursive patterns (**/) to search subdirectories
- Pattern "filename" ONLY searches the cwd, NOT subdirectories`;
  } else {
    searchStrategyGuidance = `
FILE SEARCH PATTERNS:
- Files are stored in the "out/" directory
- Use RECURSIVE patterns: "**/filename.md" (searches all subdirectories)
- Or specify directory: {"pattern": "filename.md", "cwd": "out"}
- Pattern "filename.md" ONLY searches project root, NOT subdirectories`;
  }

  const messages = [
    {
      role: 'system' as const,
      content: `You are a ReAct planner. Your job is to plan the next action to take based on the user's query and available skills.

Available Skills:
${skillDescriptions}

IMPORTANT RULES:
1. Use "Final Answer:" for conversational responses. Only use skills when you need to take an actual action (read files, create tasks, search data, etc.).
2. Do NOT use conversational_response skill - just use Final Answer directly.
3. CRITICAL: If you output "Action:", do NOT include "Final Answer:" in the same response.
4. After an Action, you must WAIT for the Observation before deciding if you can provide a Final Answer.
5. Never assume an action succeeded - wait for the observation to confirm it.
6. MEMORY PERSISTENCE: When you find/create/reference files or data, ALWAYS include specific details (file paths, IDs, names) in your Final Answer so you can reference them in follow-up questions.
   - Good: "I found bean.md at profiles/greggles/out/bean.md"
   - Bad: "The file was found" (no path for follow-up)
7. CONVERSATION CONTEXT: Check the scratchpad for previous actions in THIS turn. For follow-up questions across turns, parse YOUR OWN previous responses in the conversation history to extract file paths, IDs, or references.
   - Example: User says "what's inside?" after you said "I found bean.md at path/to/file" → Extract "path/to/file" from your previous message
${searchStrategyGuidance}

Output your response in this format:

If you need to use a tool/skill (DO NOT include Final Answer):
Thought: [your reasoning]
Action: [skill_id]
Action Input: {"param": "value"}

If you can answer directly without tools OR after receiving observations:
Thought: [your reasoning]
Final Answer: [your response]`,
    },
    {
      role: 'user' as const,
      content: `Recent Conversation Context:
${historyText}

Current Query: ${userMessage}

Scratchpad (current turn only):
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
      onProgress: context.emitProgress,
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
  console.log('[SkillExecutor] yoloMode:', context.yoloMode);
  console.log('[SkillExecutor] Inputs:', inputs.length, 'items');
  console.log('[SkillExecutor] Input[0] type:', typeof inputs[0], 'keys:', inputs[0] ? Object.keys(inputs[0]) : []);

  if (context.useOperator === false) {
    console.log('[SkillExecutor] EARLY RETURN: useOperator === false');
    return {};
  }

  // Handle Big Brother Router output (check if this is from router's localPath)
  let planInput = inputs[0] || '';
  if (planInput && typeof planInput === 'object' && 'localPath' in planInput && 'claudePath' in planInput) {
    // This is router output - check if localPath is active
    if (planInput.localPath === null || planInput.localPath === undefined) {
      // This path is not active, skip execution
      console.log('[SkillExecutor] Skipping - routed to Claude path');
      return {};
    }
    // Extract the actual plan from localPath
    planInput = planInput.localPath;
  }

  // Handle both string and object inputs (react_planner returns { plan: string })
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
    // Load trust level from decision rules instead of hardcoding
    const { loadDecisionRules } = await import('../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

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
 * Uses shared observation-formatter module for consistent formatting
 */
export const observationFormatterExecutor: NodeExecutor = async (inputs) => {
  if (!inputs || Object.keys(inputs).length === 0) {
    return {};
  }

  const skillResult = inputs[0] || {};

  // Use shared formatter for consistent observation formatting
  const observation = `Observation: ${formatObservation(skillResult)}`;

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
 * Helper: Apply persona voice to a response if persona input is available
 */
async function applyPersonaVoice(
  responseText: string,
  personaInput: any,
  userMessage: string,
  conversationHistory: any[],
  cognitiveMode: string,
  metadata: Record<string, any> = {},
  emitProgress?: (event: any) => void
): Promise<{ response: string; personaSynthesized: boolean }> {
  // Check if persona input is available and valid
  const personaPrompt = personaInput?.formatted || personaInput;

  if (!personaPrompt || typeof personaPrompt !== 'string' || personaPrompt.trim().length === 0) {
    console.log('[ResponseSynthesizer] No persona input available, returning original response');
    return { response: responseText, personaSynthesized: false };
  }

  console.log('[ResponseSynthesizer] Applying persona voice to response...');
  console.log(`[ResponseSynthesizer] Persona prompt (first 200 chars): ${personaPrompt.substring(0, 200)}...`);

  // Build system prompt with persona
  const systemPrompt = `${personaPrompt}

You are responding based on information that was gathered or generated. Your task is to deliver this information in your natural voice while:
1. Maintaining your personality and communication style
2. Being conversational and natural (not robotic or formal)
3. Preserving all factual content and technical details
4. NOT repeating technical output verbatim - translate into your speaking voice`;

  // Build messages array
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...conversationHistory.slice(-10).map((msg: any) => ({
      role: msg.role || 'user',
      content: msg.content || msg.message || '',
    })).filter((msg: any) => {
      return typeof msg.content === 'string' && msg.content.trim().length > 0;
    }),
    { role: 'user' as const, content: userMessage },
    { role: 'assistant' as const, content: `[Generated response]\n\n${responseText}` },
    { role: 'user' as const, content: 'Please respond naturally in your own voice based on the information above.' },
  ].filter((msg) => {
    return typeof msg.content === 'string' && msg.content.trim().length > 0;
  });

  console.log(`[ResponseSynthesizer] Synthesizing persona response with ${messages.length} messages`);

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      cognitiveMode,
      options: {
        maxTokens: 2048,
        repeatPenalty: 1.3,
        temperature: 0.8,
      },
      onProgress: emitProgress,
    });

    console.log(`[ResponseSynthesizer] ✅ Applied persona voice successfully`);
    console.log(`[ResponseSynthesizer] Response (first 200 chars): ${response.content.substring(0, 200)}...`);

    return { response: response.content, personaSynthesized: true };
  } catch (error) {
    console.error('[ResponseSynthesizer] Error applying persona voice:', error);
    return { response: responseText, personaSynthesized: false };
  }
}

/**
 * Response Synthesizer Node
 * Synthesizes final response from loop controller output or scratchpad
 * Applies persona voice to final output if persona input is connected
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

  // Store persona input for later synthesis (inputs[4])
  const personaInput = inputs[4];
  const hasPersona = personaInput && (personaInput.formatted || typeof personaInput === 'string');

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

  // Check if this is orchestrator guidance (from ConditionalReroute fallback)
  if (loopResult.needsMemory !== undefined && loopResult.responseStyle && loopResult.instructions) {
    console.log(`[ResponseSynthesizer] ✅ Detected orchestrator guidance format`);
    console.log(`[ResponseSynthesizer] needsMemory: ${loopResult.needsMemory}, responseStyle: ${loopResult.responseStyle}`);
    console.log(`[ResponseSynthesizer] instructions: "${loopResult.instructions.substring(0, 100)}..."`);

    // Orchestrator guidance means nodes were muted, generate response using persona LLM
    const userMessageInput = inputs[1] || inputs.userMessage || context.userMessage || {};
    const userMessage = typeof userMessageInput === 'string'
      ? userMessageInput
      : (userMessageInput.message || context.userMessage || '');

    console.log(`[ResponseSynthesizer] Extracted user message: "${userMessage.substring(0, 100)}..."`);

    // Load persona identity
    const personaSummary = getIdentitySummary();

    // Extract conversation history from context builder (inputs[2])
    const contextData = inputs[2] || {};
    const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];

    // Build system prompt with persona and instructions
    const systemPrompt = `${personaSummary}\n\nInstructions: ${loopResult.instructions}`;

    console.log(`[ResponseSynthesizer] Persona summary (first 200 chars): ${personaSummary.substring(0, 200)}...`);

    // Calculate temperature based on response style
    let temperature = 0.7;
    if (loopResult.responseStyle === 'verbose') {
      temperature = 0.8;
    } else if (loopResult.responseStyle === 'concise') {
      temperature = 0.5;
    }

    // Build messages array with conversation history
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationHistory.slice(-10).map((msg: any) => ({
        role: msg.role || 'user',
        content: msg.content || msg.message || '',
      })).filter((msg: any) => {
        // Only include messages with non-empty string content
        return typeof msg.content === 'string' && msg.content.trim().length > 0;
      }),
      { role: 'user' as const, content: userMessage },
    ].filter((msg) => {
      // Final filter to ensure all messages have valid content
      return typeof msg.content === 'string' && msg.content.trim().length > 0;
    });

    console.log(`[ResponseSynthesizer] Building response with ${messages.length} messages (${conversationHistory.length} history entries)`);

    try {
      const response = await callLLM({
        role: 'persona',
        messages,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens: 2048,
          repeatPenalty: 1.3,
          temperature,
        },
        onProgress: context.emitProgress,
      });

      console.log(`[ResponseSynthesizer] ✅ Generated response using orchestrator guidance`);
      console.log(`[ResponseSynthesizer] Response (first 200 chars): ${response.content.substring(0, 200)}...`);
      return {
        response: response.content,
        orchestratorGuidance: true,
        responseStyle: loopResult.responseStyle,
      };
    } catch (error) {
      console.error('[ResponseSynthesizer] Error generating response from orchestrator guidance:', error);
      return {
        response: 'I encountered an error while processing your request.',
        error: (error as Error).message,
      };
    }
  }

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

  // If loop controller already has a finalResponse, check if it needs persona synthesis
  if (finalResponse && finalResponse.trim().length > 0) {
    console.log('[ResponseSynthesizer] Found finalResponse from loop controller');

    // Check if this was delegated to Claude Code (Big Brother variant)
    // AND we have persona input available (inputs[4])
    if (loopResult.delegatedTo === 'claude-code' && loopResult.bypassedReActLoop && inputs[4]) {
      console.log('[ResponseSynthesizer] Detected Big Brother delegation with persona input');

      const personaPrompt = inputs[4]?.formatted || inputs[4];

      if (personaPrompt && typeof personaPrompt === 'string' && personaPrompt.trim().length > 0) {
        console.log('[ResponseSynthesizer] Synthesizing response with persona voice...');
        console.log(`[ResponseSynthesizer] Persona prompt (first 200 chars): ${personaPrompt.substring(0, 200)}...`);

        // Extract conversation history from context (inputs[2])
        const contextData = inputs[2] || {};
        const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];

        // Extract user message
        const userMessageInput = inputs[1] || context.userMessage || {};
        const userMessage = typeof userMessageInput === 'string'
          ? userMessageInput
          : (userMessageInput.message || context.userMessage || '');

        // Build system prompt with persona
        const systemPrompt = `${personaPrompt}

You are responding to the user based on work that was completed by your autonomous capabilities. Review what was done and provide a response in your natural voice that:
1. Acknowledges what was accomplished
2. Maintains your personality and communication style
3. Is conversational and natural (not robotic or overly formal)

DO NOT repeat the technical details verbatim - translate them into your natural speaking voice.`;

        // Build messages array with conversation history
        const messages = [
          { role: 'system' as const, content: systemPrompt },
          ...conversationHistory.slice(-10).map((msg: any) => ({
            role: msg.role || 'user',
            content: msg.content || msg.message || '',
          })).filter((msg: any) => {
            return typeof msg.content === 'string' && msg.content.trim().length > 0;
          }),
          { role: 'user' as const, content: userMessage },
          { role: 'assistant' as const, content: `[Work completed]\n\n${finalResponse}` },
          { role: 'user' as const, content: 'Please respond naturally in your own voice based on what was accomplished.' },
        ].filter((msg) => {
          return typeof msg.content === 'string' && msg.content.trim().length > 0;
        });

        console.log(`[ResponseSynthesizer] Synthesizing persona response with ${messages.length} messages`);

        try {
          const response = await callLLM({
            role: 'persona',
            messages,
            cognitiveMode: context.cognitiveMode,
            options: {
              maxTokens: 2048,
              repeatPenalty: 1.3,
              temperature: 0.8,
            },
            onProgress: context.emitProgress,
          });

          console.log(`[ResponseSynthesizer] ✅ Generated persona-infused response for Big Brother`);
          console.log(`[ResponseSynthesizer] Response (first 200 chars): ${response.content.substring(0, 200)}...`);
          return {
            response: response.content,
            bigBrotherDelegation: true,
            originalResponse: finalResponse,
            personaSynthesized: true,
          };
        } catch (error) {
          console.error('[ResponseSynthesizer] Error synthesizing persona response:', error);
          // Fall back to raw response if synthesis fails
          console.log('[ResponseSynthesizer] Falling back to raw Claude response due to synthesis error');
          return {
            response: finalResponse,
            loopComplete: loopResult.completed,
            iterations: loopResult.iterationCount,
            personaSynthesisFailed: true,
          };
        }
      }
    }

    // For non-Big Brother responses or missing persona, use directly
    console.log('[ResponseSynthesizer] Using final response from loop controller directly');
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

  // Try to parse observation as JSON and pull { outputs: { response } } or { finalResponse }
  try {
    const parsed = typeof obsText === 'string' ? JSON.parse(obsText) : obsText;
    const candidate = parsed?.outputs?.response || parsed?.response || parsed?.finalResponse;
    if (candidate && typeof candidate === 'string') {
      console.log('[ResponseSynthesizer] Using response from last observation (fast-path)');
      console.log('[ResponseSynthesizer] Extracted:', candidate.substring(0, 100));
      return {
        response: candidate,
        loopComplete: loopResult.completed,
        iterations: scratchpad.length,
      };
    }
  } catch (error) {
    // Observation wasn't JSON – fall through to LLM-based synthesis
    console.log('[ResponseSynthesizer] Fast-path failed:', (error as Error).message);
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
      onProgress: context.emitProgress,
    });

    let result: any = {
      response: response.content,
      loopComplete: loopResult.completed,
      iterations: scratchpad.length,
    };

    // Apply persona voice if persona input is available
    if (hasPersona) {
      const contextData = inputs[2] || {};
      const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];
      const userMessageInput = inputs[1] || context.userMessage || {};
      const userMessage = typeof userMessageInput === 'string'
        ? userMessageInput
        : (userMessageInput.message || context.userMessage || '');

      const synthesized = await applyPersonaVoice(
        result.response,
        personaInput,
        userMessage,
        conversationHistory,
        context.cognitiveMode || 'dual',
        {},
        context.emitProgress
      );

      if (synthesized.personaSynthesized) {
        result.response = synthesized.response;
        result.personaSynthesized = true;
      }
    }

    return result;
  } catch (error) {
    console.error('[ResponseSynthesizer] Error:', error);
    let result: any = {
      response: finalResponse || 'I encountered an error while processing your request.',
      error: (error as Error).message,
    };

    // Apply persona voice even to error responses if persona input is available
    if (hasPersona && result.response) {
      const contextData = inputs[2] || {};
      const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];
      const userMessageInput = inputs[1] || context.userMessage || {};
      const userMessage = typeof userMessageInput === 'string'
        ? userMessageInput
        : (userMessageInput.message || context.userMessage || '');

      try {
        const synthesized = await applyPersonaVoice(
          result.response,
          personaInput,
          userMessage,
          conversationHistory,
          context.cognitiveMode || 'dual',
          {},
          context.emitProgress
        );

        if (synthesized.personaSynthesized) {
          result.response = synthesized.response;
          result.personaSynthesized = true;
        }
      } catch (personaError) {
        console.error('[ResponseSynthesizer] Error applying persona to error response:', personaError);
      }
    }

    return result;
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

/**
 * Big Brother Router Node
 * Routes skill execution to local executor or Claude CLI based on config and session status
 */
export const bigBrotherRouterExecutor: NodeExecutor = async (inputs, _context) => {
  try {
    // Handle plan input (same as SkillExecutor)
    const planInput = inputs[0] || '';
    const plan = typeof planInput === 'object' && planInput.plan ? planInput.plan : planInput;

    if (typeof plan !== 'string') {
      console.error('[BigBrotherRouter] Expected string plan, got:', typeof plan);
      // Default to local path on error
      return {
        localPath: planInput,
        claudePath: null,
      };
    }

    // Parse the plan to extract action (skill name)
    const actionMatch = plan.match(/Action:\s*(\w+)/i);

    if (!actionMatch) {
      // No action found, pass through to local executor
      return {
        localPath: planInput,
        claudePath: null,
      };
    }

    const skillName = actionMatch[1];

    // Load operator config to check if Big Brother mode is enabled
    const { loadOperatorConfig } = await import('../config.js');
    const operatorConfig = loadOperatorConfig();
    const bigBrotherEnabled = operatorConfig.bigBrotherMode?.enabled || false;

    // Check if Claude session is ready
    const { isClaudeSessionReady } = await import('../claude-session.js');
    const sessionReady = isClaudeSessionReady();

    if (bigBrotherEnabled && sessionReady) {
      // Route to Claude CLI executor (output slot 1)
      console.log(`[BigBrotherRouter] Routing ${skillName} to Claude CLI`);
      return {
        localPath: null,
        claudePath: planInput, // Pass the full plan object
      };
    } else {
      // Route to local executor (output slot 0)
      console.log(`[BigBrotherRouter] Routing ${skillName} to local executor (BB: ${bigBrotherEnabled}, Session: ${sessionReady})`);
      return {
        localPath: planInput, // Pass the full plan object
        claudePath: null,
      };
    }
  } catch (error) {
    console.error('[BigBrotherRouter] Error:', error);
    // On error, default to local execution
    return {
      localPath: inputs[0],
      claudePath: null,
      error: (error as Error).message,
    };
  }
};

/**
 * Big Brother Executor Node
 * Executes skills via Claude CLI delegation
 */
export const bigBrotherExecutorExecutor = async (inputs: Record<string, any>, _context: any, properties?: Record<string, any>) => {
  try {
    // Handle Big Brother Router output (check if this is from router's claudePath)
    let planInput = inputs[0] || '';
    if (planInput && typeof planInput === 'object' && 'localPath' in planInput && 'claudePath' in planInput) {
      // This is router output - check if claudePath is active
      if (planInput.claudePath === null || planInput.claudePath === undefined) {
        // This path is not active, skip execution
        console.log('[BigBrotherExecutor] Skipping - routed to local path');
        return JSON.stringify({
          success: false,
          error: 'Not routed to Big Brother',
          outputs: {},
        });
      }
      // Extract the actual plan from claudePath
      planInput = planInput.claudePath;
    }

    // Handle plan input (same as SkillExecutor)
    const plan = typeof planInput === 'object' && planInput.plan ? planInput.plan : planInput;

    if (typeof plan !== 'string') {
      console.error('[BigBrotherExecutor] Expected string plan, got:', typeof plan);
      return JSON.stringify({
        success: false,
        error: `Invalid plan type: ${typeof plan}`,
        outputs: {},
      });
    }

    // Parse the plan to extract skill name and inputs (same as SkillExecutor)
    const actionMatch = plan.match(/Action:\s*(\w+)/i);
    const inputMatch = plan.match(/Action Input:\s*({[\s\S]*?})/i);

    if (!actionMatch) {
      return {
        success: false,
        error: 'No action found in plan',
        outputs: {},
      };
    }

    const skillName = actionMatch[1];
    let skillInputs = {};

    if (inputMatch) {
      try {
        skillInputs = JSON.parse(inputMatch[1]);
      } catch (e) {
        console.error('[BigBrotherExecutor] Failed to parse skill inputs:', e);
      }
    }

    console.log(`[BigBrotherExecutor] Executing skill: ${skillName} via Claude CLI`);

    const { audit } = await import('../audit.js');
    const { isClaudeSessionReady, sendPrompt, startClaudeSession } = await import('../claude-session.js');

    // Ensure session is ready
    if (!isClaudeSessionReady()) {
      const autoStart = properties?.autoStartSession !== false;
      if (autoStart) {
        console.log('[BigBrotherExecutor] Claude session not ready, starting...');
        const started = await startClaudeSession();
        if (!started) {
          throw new Error('Claude session not available and auto-start failed');
        }
      } else {
        throw new Error('Claude session not available');
      }
    }

    // Build prompt for Claude to provide content/instructions (not execute directly)
    const prompt = `I need you to help me prepare content for a skill execution. This is part of an automated system where you're providing intelligent content generation.

**Skill to Execute:** ${skillName}

**Skill Inputs:**
${JSON.stringify(skillInputs, null, 2)}

Please provide the content or instructions needed to execute this skill. For example:
- For fs_write: Provide the exact file content that should be written
- For fs_read: Explain what to look for in the file
- For shell commands: Provide the command to run
- For conversational_response: Provide the response text

Return ONLY a JSON object in this format:
{
  "success": true,
  "content": "the actual content, command, or response text",
  "explanation": "brief explanation of what this does (optional)"
}

Do NOT try to execute any tools yourself. Just provide the content.`;

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_skill_delegation',
      details: {
        skillName,
        args: skillInputs,
        promptLength: prompt.length,
      },
      actor: 'big-brother',
    });

    // Send to Claude CLI with timeout
    const timeoutMs = properties?.timeout || 60000;
    const response = await sendPrompt(prompt, timeoutMs);

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    let claudeResult;

    if (jsonMatch) {
      try {
        claudeResult = JSON.parse(jsonMatch[0]);
      } catch (err) {
        console.warn('[BigBrotherExecutor] Failed to parse JSON from response, using raw response');
        claudeResult = {
          success: true,
          content: response,
        };
      }
    } else {
      // No JSON found, treat entire response as content
      claudeResult = {
        success: true,
        content: response,
      };
    }

    // Now execute the skill locally using Claude's content
    console.log(`[BigBrotherExecutor] Received content from Claude, executing ${skillName} locally`);

    const { executeSkill } = await import('../skills.js');
    const { loadDecisionRules } = await import('../identity.js');
    const rules = loadDecisionRules();
    const trustLevel = rules.trustLevel as any;

    // Prepare skill inputs with Claude's content
    const finalInputs: Record<string, any> = { ...skillInputs };

    // For fs_write, use Claude's content as the file content
    if (skillName === 'fs_write' && claudeResult.content) {
      finalInputs.content = claudeResult.content;
    }
    // For conversational_response, use Claude's content as the response
    else if (skillName === 'conversational_response' && claudeResult.content) {
      finalInputs.response = claudeResult.content;
    }
    // For other skills, add content as an additional parameter
    else if (claudeResult.content) {
      finalInputs.claudeContent = claudeResult.content;
    }

    const skillResult = await executeSkill(skillName, finalInputs, trustLevel);

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_skill_completed',
      details: {
        skillName,
        success: skillResult.success,
        claudeContent: claudeResult.content?.substring(0, 100),
      },
      actor: 'big-brother',
    });

    console.log(`[BigBrotherExecutor] ✓ Skill completed via Claude CLI + local execution`);

    // Format response to match SkillExecutor output format (as JSON string for observation)
    return JSON.stringify({
      success: skillResult.success,
      outputs: skillResult.outputs || {
        response: claudeResult.content,
      },
      error: skillResult.error,
      skillId: skillName,
      delegatedTo: 'claude-cli',
      claudeExplanation: claudeResult.explanation,
    });
  } catch (error) {
    console.error('[BigBrotherExecutor] Error:', error);

    const { audit } = await import('../audit.js');
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_skill_failed',
      details: {
        error: (error as Error).message,
      },
      actor: 'big-brother',
    });

    // Return error in SkillExecutor format
    return JSON.stringify({
      success: false,
      error: (error as Error).message,
      outputs: {},
    });
  }
};

/**
 * Claude Full Task Executor
 * Sends the entire user request to Claude Code for full autonomous completion
 * Bypasses the local ReAct loop entirely - Claude handles planning, execution, and response
 */
export const claudeFullTaskExecutor: NodeExecutor = async (inputs, _context, _properties) => {
  try {
    // Input slots vary by graph:
    // Standard dual-mode graph: [orchestratorAnalysis, userMessage, contextPackage]
    // Big Brother graph: [undefined, userInputObject, contextPackage]
    const orchestratorAnalysis = inputs[0] || {};
    const userMessage = inputs[1] || inputs[0] || '';
    const contextPackage = inputs[2] || inputs[1] || {};

    // Extract message string from various possible formats
    let messageText = '';
    if (typeof userMessage === 'string') {
      messageText = userMessage;
    } else if (userMessage && typeof userMessage === 'object') {
      // Try multiple property names that might contain the message
      messageText = userMessage.message || userMessage.text || userMessage.content || '';
    }

    // Defensive check: ensure we have a string
    if (typeof messageText !== 'string') {
      console.warn('[ClaudeFullTask] messageText is not a string, converting:', typeof messageText, messageText);
      messageText = String(messageText || 'No message provided');
    }

    console.log(`[ClaudeFullTask] Delegating entire task to Claude Code: "${messageText.substring(0, 60)}..."`);
    console.log(`[ClaudeFullTask] Input types: userMessage=${typeof userMessage}, messageText=${typeof messageText}`);

    const { audit } = await import('../audit.js');
    const { isClaudeSessionReady, sendPrompt, startClaudeSession } = await import('../claude-session.js');

    // Ensure Claude session is ready
    if (!isClaudeSessionReady()) {
      console.log('[ClaudeFullTask] Claude session not ready, starting...');
      const started = await startClaudeSession();
      if (!started) {
        throw new Error('Claude session not available and auto-start failed');
      }
    }

    // Build comprehensive prompt for Claude
    const skillsList = 'File operations (read/write/list/delete), shell commands, task management, web search, git operations, etc.';

    const contextInfo = contextPackage.memories && contextPackage.memories.length > 0
      ? `\n\nRelevant context from user's memories:\n${contextPackage.memories.slice(0, 3).map((m: any) => `- ${m.content || m.text || ''}`).join('\n')}`
      : '';

    const prompt = `You are an autonomous AI operator with FULL PERMISSIONS to execute any task. You have been granted complete access to all tools and should execute tasks WITHOUT asking for permission.

**User Request:**
${messageText}

**Your Capabilities:**
${skillsList}

**CRITICAL INSTRUCTIONS:**
1. You have FULL, UNRESTRICTED permissions - DO NOT ask for approval
2. Execute tasks IMMEDIATELY using your tools (Write, Bash, Read, etc.)
3. DO NOT say "I need permission" - you already have it
4. DO NOT explain what you WOULD do - just DO IT
5. Complete the task fully, then report what you accomplished${contextInfo}

**Your Task:**
1. Understand what the user wants
2. Execute it IMMEDIATELY using your tools
3. Return a clear response explaining what you DID (past tense, not future)

**Example BAD response:**
"I need permission to create that file. Once you grant me permission..."

**Example GOOD response:**
"I've created the file 'cell phone' with three phone models: iPhone 15 Pro Max, Samsung Galaxy S24 Ultra, and Google Pixel 8 Pro."

Execute now and report results.`;

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_full_task_delegation',
      details: {
        userMessage: messageText.substring(0, 100),
        promptLength: prompt.length,
      },
      actor: 'big-brother',
    });

    // Send to Claude with extended timeout for full task completion
    // Complex tasks like web searches, file operations, etc. can take several minutes
    const timeoutMs = _properties?.timeout || 300000; // 5 minutes default
    console.log('[ClaudeFullTask] Sending request to Claude Code...');
    const response = await sendPrompt(prompt, timeoutMs);

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_full_task_completed',
      details: {
        responseLength: response.length,
      },
      actor: 'big-brother',
    });

    console.log(`[ClaudeFullTask] ✓ Task completed by Claude Code`);

    // Return in format that Response Synthesizer understands
    // Response Synthesizer will use this as raw execution result to synthesize persona response
    return {
      scratchpad: [{
        thought: "Delegated task execution to Claude Code",
        action: "claude_full_task",
        observation: response.trim()
      }],
      finalResponse: response.trim(),  // What Claude actually did (for persona to synthesize from)
      success: true,
      delegatedTo: 'claude-code',
      bypassedReActLoop: true,
    };
  } catch (error) {
    console.error('[ClaudeFullTask] Error:', error);

    const { audit } = await import('../audit.js');
    const errorMsg = (error as Error).message;
    // Node.js execSync timeout sets killed=true and signal='SIGTERM', not ETIMEDOUT
    const err = error as any;
    const isTimeout = err.killed === true || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timed out');

    audit({
      level: 'error',
      category: 'action',
      event: 'claude_full_task_failed',
      details: {
        error: errorMsg,
        isTimeout,
      },
      actor: 'big-brother',
    });

    // Provide helpful error message
    const userMessage = isTimeout
      ? "The task took too long to complete (exceeded 5 minute timeout). This usually happens with complex research questions that require extensive web searching. You might try asking a simpler question or breaking it into smaller parts."
      : `I encountered an error while delegating to Claude: ${errorMsg}`;

    // Return in format Response Synthesizer understands
    return {
      scratchpad: [{
        thought: "Attempted to delegate to Claude Code",
        action: "claude_full_task",
        observation: `ERROR: ${errorMsg}`
      }],
      finalResponse: userMessage,
      success: false,
      error: errorMsg,
    };
  }
};

/**
 * Big Brother Escalation Node
 * Escalates stuck states to Claude CLI for expert analysis and recovery suggestions
 */
export const bigBrotherExecutor: NodeExecutor = async (inputs, _context, _properties) => {
  try {
    const goal = inputs[0] || inputs.goal || '';
    const scratchpad = inputs[1] || inputs.scratchpad || [];
    const errorType = inputs[2] || inputs.errorType || null;
    const contextData = inputs[3] || inputs.context || {};

    console.log(`[BigBrother] Escalating stuck state for goal: "${goal.substring(0, 50)}..."`);

    const { loadOperatorConfig } = await import('../config.js');
    const { escalateToBigBrother } = await import('../big-brother.js');

    const operatorConfig = loadOperatorConfig();

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

/**
 * Conditional Reroute Node
 * Intelligently routes between primary and fallback inputs based on data validity.
 * Used to bypass muted nodes by detecting empty/pass-through data.
 */
export const conditionalRerouteExecutor: NodeExecutor = async (inputs, _context, _properties) => {
  try {
    const primaryInput = inputs[0] || {};
    const fallbackInput = inputs[1] || {};

    // Check if primary input is empty or from a muted node (pass-through)
    const isPrimaryEmpty = !primaryInput ||
                          (typeof primaryInput === 'object' && Object.keys(primaryInput).length === 0) ||
                          (Array.isArray(primaryInput) && primaryInput.length === 0);

    if (isPrimaryEmpty) {
      console.log('[ConditionalReroute] Primary input is empty, using fallback');
      console.log('[ConditionalReroute] Metadata: usedFallback=true, reason=Primary input was empty (likely from muted nodes)');
      return fallbackInput;
    } else {
      console.log('[ConditionalReroute] Primary input is valid, using primary');
      console.log('[ConditionalReroute] Metadata: usedFallback=false, reason=Primary input was valid');
      return primaryInput;
    }
  } catch (error) {
    console.error('[ConditionalReroute] Error:', error);
    console.log('[ConditionalReroute] Metadata: usedFallback=true, reason=Error occurred');
    // On error, try to use fallback
    return inputs[1] || {};
  }
};

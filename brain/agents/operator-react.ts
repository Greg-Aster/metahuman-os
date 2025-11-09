/**
 * ReAct Loop Operator Agent
 *
 * Modern agentic loop using the Reason + Act pattern.
 * Unlike the legacy static planner, this operator:
 * - Plans ONE step at a time
 * - Observes the result
 * - Adapts the next step based on what it learned
 *
 * This prevents hallucinated filenames and other issues caused by
 * planning all steps upfront without seeing intermediate results.
 */

import { audit, executeSkill as coreExecuteSkill, listSkills, captureEvent } from '@metahuman/core';
import { callLLM, type RouterMessage } from '../../packages/core/src/model-router.js';
import type { SkillResult } from '../../packages/core/src/skills.js';
import { canWriteMemory, shouldCaptureTool } from '@metahuman/core/memory-policy';
import { loadCognitiveMode } from '@metahuman/core/cognitive-mode';
import { getUserContext } from '@metahuman/core/context';
import { resolvePathWithFuzzyFallback, type PathResolution } from '@metahuman/core/path-resolver';
import { initializeSkills } from '../skills/index';

// Ensure the skills registry is populated before any ReAct loop runs.
// initializeSkills() is idempotent, so calling on module load avoids missing-skill failures
// when this module is imported outside of the web operator route.
initializeSkills();

// ============================================================================
// Types
// ============================================================================

/**
 * Operator Task - Extended task type for the operator
 */
export interface OperatorTask {
  id: string;
  goal: string;
  audience?: string;
  context?: string;
  status: 'in_progress' | 'completed' | 'failed';
  created: string;
}

export interface ReActStep {
  iteration: number;
  thought: string;          // "I need to list files first"
  action: string;           // "fs_list"
  actionInput: any;         // { pattern: "docs/**/*" }
  observation: string;      // "Found 20 files: [...]"
  reasoning?: string;       // Optional deep reasoning
  timestamp: string;
}

export interface ReActContext {
  goal: string;
  audience?: string;
  steps: ReActStep[];
  completed: boolean;
  result?: any;
  error?: string;
}

export interface ReActConfig {
  maxIterations: number;
  enableDeepReasoning: boolean;
  observationMaxLength: number;
  reasoningDepth?: number;  // 0=off, 1=quick, 2=focused, 3=deep (matches UI slider)
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: ReActConfig = {
  maxIterations: 10,
  enableDeepReasoning: false,
  observationMaxLength: 500,
};

/**
 * Load operator configuration from etc/operator.json
 */
function loadConfig(): ReActConfig {
  // TODO: Load from file in Phase 6
  return DEFAULT_CONFIG;
}

// ============================================================================
// Core ReAct Loop
// ============================================================================

/**
 * Detect if a goal is pure conversational (no actions needed).
 * Returns true for obvious chat, false for action requests.
 */
function isPureChatRequest(goal: string): boolean {
  // Obvious conversational patterns
  const chatPatterns = [
    /^(hi|hey|hello|howdy|greetings|yo|sup)/i,
    /how (are|is) (you|it|things|everything)/i,
    /what('s| is) up/i,
    /^(thanks|thank you|thx)/i,
    /^(good morning|good afternoon|good evening|good night)/i,
    /^(bye|goodbye|see you|later)/i,
    /(tell me about yourself|who are you|what can you do)/i,
  ];

  if (chatPatterns.some(p => p.test(goal))) {
    return true;
  }

  // Action patterns that definitely need React loop
  const actionPatterns = [
    /(list|find|search|look for|show me|get|read|write|create|delete|remove|update)/i,
    /(file|task|document|folder|directory|path)/i,
    /(open|close|run|execute|start|stop)/i,
  ];

  if (actionPatterns.some(p => p.test(goal))) {
    return false;
  }

  // Questions are usually conversational unless they ask for file/task info
  if (/^(what|why|how|when|where|who|can you|could you|would you|will you)/i.test(goal)) {
    // Check if it's asking about files/tasks
    if (/\b(file|folder|task|document)\b/i.test(goal)) {
      return false;
    }
    return true;
  }

  // Default: assume conversational (safer, will just add 1 planning step if wrong)
  return true;
}

/**
 * Run the ReAct loop for a given task.
 *
 * The loop continues until:
 * 1. The task is marked as completed
 * 2. Maximum iterations reached
 * 3. An unrecoverable error occurs
 *
 * OPTIMIZATION: Detects pure conversational requests and uses fast-path
 * to skip unnecessary React iterations.
 *
 * @param task - The task to execute
 * @param onProgress - Optional callback for streaming progress
 * @param reasoningDepth - Optional reasoning depth (0-3) from UI slider
 * @returns ReActContext with all steps and final result
 */
export async function runReActLoop(
  task: OperatorTask,
  onProgress?: (step: ReActStep) => void,
  reasoningDepth?: number,
  sessionId?: string,
  parentEventId?: string
): Promise<ReActContext> {
  const config = loadConfig();

  // Override reasoning settings based on slider
  if (reasoningDepth !== undefined) {
    config.reasoningDepth = reasoningDepth;
    // reasoningDepth 0 = off (no deep reasoning)
    // reasoningDepth 1-3 = enable deep reasoning with increasing detail
    config.enableDeepReasoning = reasoningDepth > 0;
  }

  // OPTIMIZATION: Fast-path for pure conversational requests
  // Saves 2 LLM calls (planNextStep + checkCompletion) + eliminates loop overhead
  const isPureChat = isPureChatRequest(task.goal);

  if (isPureChat) {
    audit({
      level: 'info',
      category: 'action',
      event: 'react_fastpath_chat',
      details: {
        goal: task.goal,
        savedLatency: '200-400ms',
        savedLlmCalls: 2,
      },
      actor: 'operator-react',
    });

    // Execute conversational_response skill directly
    try {
      const result = await coreExecuteSkill(
        'conversational_response',
        { message: task.goal, context: task.context || '' },
        'bounded_auto',
        true
      );

      const observation = formatObservation(result, config);

      const step: ReActStep = {
        iteration: 1,
        thought: 'Pure conversational request (fast-path)',
        action: 'conversational_response',
        actionInput: { message: task.goal },
        observation,
        timestamp: new Date().toISOString(),
      };

      // Stream progress to UI
      if (onProgress) {
        onProgress(step);
      }

      // Extract result from observation
      let finalResult = observation;
      const match = observation.match(/Success\.\s*Output:\s*(.+)/s);
      if (match) {
        finalResult = match[1].trim();
      } else if (observation.startsWith('Success')) {
        finalResult = observation.replace(/^Success\.\s*/i, '').trim();
      }

      audit({
        level: 'info',
        category: 'action',
        event: 'react_fastpath_completed',
        details: {
          goal: task.goal,
          iterations: 1,
          llmCalls: 1, // Only the conversational_response call
        },
        actor: 'operator-react',
      });

      return {
        goal: task.goal,
        audience: task.audience,
        steps: [step],
        completed: true,
        result: finalResult,
      };
    } catch (error) {
      // If fast-path fails, fall back to normal React loop
      audit({
        level: 'warn',
        category: 'action',
        event: 'react_fastpath_failed',
        details: {
          goal: task.goal,
          error: (error as Error).message,
          fallback: 'normal_react_loop',
        },
        actor: 'operator-react',
      });
      // Continue to normal loop below
    }
  }

  // Normal React loop for action requests or failed fast-path
  const context: ReActContext = {
    goal: task.goal,
    audience: task.audience,
    steps: [],
    completed: false,
  };

  audit({
    level: 'info',
    category: 'action',
    event: 'react_loop_started',
    details: {
      taskId: task.id,
      goal: task.goal,
      maxIterations: config.maxIterations,
    },
    actor: 'operator-react',
  });

  try {
    while (!context.completed && context.steps.length < config.maxIterations) {
      const iteration = context.steps.length + 1;

      // 1. THINK: What should I do next?
      const thought = await planNextStep(context, config);

      // 2. ACT: Execute one skill
      const result = await executeSkill(thought.action, thought.actionInput, sessionId, parentEventId);

      // 3. OBSERVE: Record what happened
      const observation = formatObservation(result, config);

      const step: ReActStep = {
        iteration,
        thought: thought.thought,
        action: thought.action,
        actionInput: thought.actionInput,
        observation,
        reasoning: config.enableDeepReasoning ? thought.reasoning : undefined,
        timestamp: new Date().toISOString(),
      };

      context.steps.push(step);

      // Stream progress to UI
      if (onProgress) {
        onProgress(step);
      }

      audit({
        level: 'info',
        category: 'action',
        event: 'react_step_completed',
        details: {
          iteration,
          action: step.action,
          observationLength: observation.length,
        },
        actor: 'operator-react',
      });

      // 4. REFLECT: Am I done?
      context.completed = await checkCompletion(context);

      // If completed, extract final result
      if (context.completed) {
        context.result = await extractFinalResult(context);
      }
    }

    // Check if we hit max iterations without completing
    if (!context.completed && context.steps.length >= config.maxIterations) {
      context.error = `Task incomplete after ${config.maxIterations} iterations`;
      audit({
        level: 'warn',
        category: 'action',
        event: 'react_loop_max_iterations',
        details: {
          goal: context.goal,
          iterations: context.steps.length,
        },
        actor: 'operator-react',
      });
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'react_loop_completed',
      details: {
        goal: context.goal,
        completed: context.completed,
        iterations: context.steps.length,
        hasResult: !!context.result,
        hasError: !!context.error,
      },
      actor: 'operator-react',
    });

    return context;
  } catch (error) {
    context.error = (error as Error).message;
    audit({
      level: 'error',
      category: 'action',
      event: 'react_loop_error',
      details: {
        goal: context.goal,
        error: (error as Error).message,
        iterations: context.steps.length,
      },
      actor: 'operator-react',
    });
    throw error;
  }
}

// ============================================================================
// Step Functions
// ============================================================================

/**
 * Plan the next single step based on the goal and all previous observations.
 *
 * This is where the magic happens - instead of planning all steps upfront,
 * we see what happened in previous steps and decide what to do next.
 *
 * @param context - Current ReAct context with goal and previous steps
 * @param config - Operator configuration
 * @returns The next thought and action to take
 */
async function planNextStep(
  context: ReActContext,
  config: ReActConfig
): Promise<{
  thought: string;
  action: string;
  actionInput: any;
  reasoning?: string;
}> {
  audit({
    level: 'info',
    category: 'action',
    event: 'react_planning_step',
    details: {
      iteration: context.steps.length + 1,
      previousSteps: context.steps.length,
    },
    actor: 'operator-react',
  });

  // Build context from previous steps
  const previousStepsContext = context.steps.map(s => `
Iteration ${s.iteration}:
Thought: ${s.thought}
Action: ${s.action}(${JSON.stringify(s.actionInput)})
Observation: ${s.observation}
`).join('\n');

  // Get available skills
  const skills = listSkills();
  const skillsContext = skills.map(s => `
- ${s.id}: ${s.description}
  Category: ${s.category}, Risk: ${s.risk}
  Inputs: ${Object.keys(s.inputs).join(', ')}`).join('\n');

  // Build the planning prompt
  const systemPrompt = `You are a unified reasoning agent that handles ALL user requests - both actions and conversations.

IMPORTANT RULES:
- Plan ONE step at a time, not multiple steps
- Base your decision on ACTUAL observations from previous steps
- NEVER guess or hallucinate data - only use what you've observed
- If you need information, use a skill to get it first
- Always read the actual results before proceeding

SKILL SELECTION GUIDE:
- If the user needs FILE SYSTEM access (list/read/write files) → use fs_list, fs_read, fs_write
- If the user needs TASK management → use task_create, task_list, etc.
- If the user needs WEB search → use web_search
- If the user is just ASKING A QUESTION or having a CONVERSATION → use conversational_response
- If you have gathered information and need to ANSWER the user → use conversational_response with context

EXAMPLES:
- "Look for a user guide in docs folder" → fs_list (need to see what files exist)
- "What is a user guide?" → conversational_response (just explaining a concept)
- "How are you doing?" → conversational_response (casual conversation)
- After fs_list finds files → conversational_response (answer with the file list)

Available Skills:
${skillsContext}

Goal: ${context.goal}
${context.audience ? `Audience: ${context.audience}` : ''}

${previousStepsContext ? `Previous Steps:\n${previousStepsContext}` : 'No previous steps yet.'}

Based on the observations above, what is the NEXT SINGLE ACTION you should take?

CRITICAL: You MUST respond with ONLY a valid JSON object. Do NOT include any explanatory text before or after the JSON.

JSON Format:
{
  "thought": "Brief explanation of what you're thinking",
  "action": "skill_id",
  "actionInput": { "param": "value" },
  "reasoning": "Optional deeper reasoning if needed"
}`;

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Return ONLY JSON. No other text.' },
  ];

  try {
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      options: {
        temperature: 0.3, // Lower temperature for more focused planning
        maxTokens: 1000,
      },
    });

    // Parse JSON response
    const parsed = JSON.parse(response.content);

    audit({
      level: 'info',
      category: 'action',
      event: 'react_step_planned',
      details: {
        iteration: context.steps.length + 1,
        action: parsed.action,
        model: response.modelId,
        latencyMs: response.latencyMs,
      },
      actor: 'operator-react',
    });

    return {
      thought: parsed.thought || 'No thought provided',
      action: parsed.action,
      actionInput: parsed.actionInput || {},
      reasoning: config.enableDeepReasoning ? parsed.reasoning : undefined,
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'react_planning_error',
      details: {
        error: (error as Error).message,
        iteration: context.steps.length + 1,
      },
      actor: 'operator-react',
    });
    throw new Error(`Planning failed: ${(error as Error).message}`);
  }
}

/**
 * Resolve filesystem paths with fuzzy fallback before skill execution.
 * This prevents "file not found" errors when users slightly misspell filenames.
 *
 * @param skillName - Name of the skill being executed
 * @param input - Skill input parameters
 * @returns Modified input with resolved paths, or null if resolution failed with no suggestions
 */
function resolveFilesystemPaths(skillName: string, input: any): { input: any; suggestions?: string[]; originalPath?: string } {
  // List of filesystem skills that require path resolution
  const fsSkills = ['fs_read', 'fs_write', 'fs_list', 'fs_delete', 'fs_move', 'fs_copy'];

  if (!fsSkills.includes(skillName)) {
    return { input }; // Not a filesystem skill, no resolution needed
  }

  // Extract path from various possible fields
  const pathField = input.path || input.filePath || input.file || input.pattern;

  if (!pathField || typeof pathField !== 'string') {
    return { input }; // No path to resolve
  }

  // Resolve the path with fuzzy fallback
  const resolution: PathResolution = resolvePathWithFuzzyFallback(pathField);

  // If exact match found, use it
  if (resolution.exists && resolution.resolved) {
    const resolvedInput = { ...input };
    if (input.path) resolvedInput.path = resolution.resolved;
    if (input.filePath) resolvedInput.filePath = resolution.resolved;
    if (input.file) resolvedInput.file = resolution.resolved;
    if (input.pattern) resolvedInput.pattern = resolution.resolved;

    return { input: resolvedInput };
  }

  // No exact match - return suggestions if available
  if (resolution.suggestions.length > 0) {
    return {
      input,
      suggestions: resolution.suggestions,
      originalPath: pathField
    };
  }

  // No match and no suggestions
  return { input };
}

/**
 * Execute a skill with the given input.
 *
 * @param skillName - Name of the skill to execute
 * @param input - Input parameters for the skill
 * @returns The skill execution result
 */
async function executeSkill(skillName: string, input: any, sessionId?: string, parentEventId?: string): Promise<SkillResult> {
  const startTime = Date.now();

  // Phase 6: Fuzzy path resolution before filesystem operations
  const pathResolution = resolveFilesystemPaths(skillName, input);

  // If we have suggestions but no exact match, return helpful error
  if (pathResolution.suggestions && pathResolution.suggestions.length > 0) {
    const suggestionsText = pathResolution.suggestions
      .slice(0, 5)
      .map((s, i) => `  ${i + 1}. ${s}`)
      .join('\n');

    return {
      success: false,
      error: `Path not found: "${pathResolution.originalPath}"\n\nDid you mean one of these?\n${suggestionsText}\n\nTip: Use fs_list with a fuzzy pattern like "**/*${pathResolution.originalPath}*" to search.`
    };
  }

  // Use resolved input (may be same as original if no resolution was needed)
  const resolvedInput = pathResolution.input;

  audit({
    level: 'info',
    category: 'action',
    event: 'react_executing_skill',
    details: {
      skill: skillName,
      input: resolvedInput,
      sessionId,
    },
    actor: 'operator-react',
  });

  try {
    // Execute skill with bounded_auto trust level
    // This allows automatic execution without approval for most skills
    const result = await coreExecuteSkill(
      skillName,
      resolvedInput,
      'bounded_auto',
      true // autoApprove = true for ReAct loop
    );

    const executionTime = Date.now() - startTime;

    audit({
      level: result.success ? 'info' : 'warn',
      category: 'action',
      event: 'react_skill_executed',
      details: {
        skill: skillName,
        success: result.success,
        error: result.error,
        executionTimeMs: executionTime,
      },
      actor: 'operator-react',
    });

    // Capture tool invocation as memory event (mode-aware)
    try {
      const ctx = getUserContext();
      const cognitiveConfig = loadCognitiveMode();
      const cognitiveMode = cognitiveConfig.currentMode;

      // Check if we should capture this tool invocation
      if (ctx && shouldCaptureTool(cognitiveMode, skillName) && canWriteMemory(cognitiveMode, 'tool_invocation')) {
        captureEvent(`Tool: ${skillName}`, {
          type: 'tool_invocation',
          tags: ['tool', skillName, 'operator', 'react'],
          importance: result.success ? 0.6 : 0.8, // Failures more important
          metadata: {
            conversationId: sessionId,
            toolName: skillName,
            toolInputs: resolvedInput, // Use resolved input (may have fuzzy-matched paths)
            toolOutputs: result.outputs || {},
            success: result.success,
            error: result.error || undefined,
            executionTimeMs: executionTime,
            cognitiveMode,
            timestamp: new Date().toISOString(),
            parentEventId,
          },
        });
      }
    } catch (captureError) {
      // Don't fail the skill execution if memory capture fails
      console.warn('[operator-react] Failed to capture tool invocation:', captureError);
    }

    return result;
  } catch (error) {
    const executionTime = Date.now() - startTime;

    audit({
      level: 'error',
      category: 'action',
      event: 'react_skill_execution_error',
      details: {
        skill: skillName,
        error: (error as Error).message,
        executionTimeMs: executionTime,
      },
      actor: 'operator-react',
    });

    // Capture failed tool invocation
    try {
      const ctx = getUserContext();
      const cognitiveConfig = loadCognitiveMode();
      const cognitiveMode = cognitiveConfig.currentMode;

      if (ctx && shouldCaptureTool(cognitiveMode, skillName) && canWriteMemory(cognitiveMode, 'tool_invocation')) {
        captureEvent(`Tool failed: ${skillName}`, {
          type: 'tool_invocation',
          tags: ['tool', skillName, 'operator', 'error'],
          importance: 0.9, // High importance for errors
          metadata: {
            conversationId: sessionId,
            toolName: skillName,
            toolInputs: resolvedInput, // Use resolved input
            success: false,
            error: (error as Error).message,
            executionTimeMs: executionTime,
            cognitiveMode,
            timestamp: new Date().toISOString(),
            parentEventId,
          },
        });
      }
    } catch (captureError) {
      console.warn('[operator-react] Failed to capture tool error:', captureError);
    }

    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Format a skill execution result into a human-readable observation.
 *
 * This is critical for the LLM to understand what happened and plan the next step.
 * We convert raw data structures into natural language summaries.
 *
 * @param result - Raw skill execution result
 * @param config - Operator configuration
 * @returns Human-readable observation string
 */
function formatObservation(result: SkillResult, config: ReActConfig): string {
  if (result === null || result === undefined) {
    return 'No result returned';
  }

  // Handle error results
  if (result.success === false) {
    return `Error: ${result.error || 'Unknown error'}`;
  }

  // Handle success results with outputs
  if (result.success === true && result.outputs) {
    // Extract the primary output data
    const outputs = result.outputs;

    // Special formatting for common skill types
    if (outputs.files && Array.isArray(outputs.files)) {
      // fs_list result
      const fileList = outputs.files;
      if (fileList.length === 0) {
        return 'No files found';
      }
      if (fileList.length <= 10) {
        return `Found ${fileList.length} file(s): ${fileList.join(', ')}`;
      }
      return `Found ${fileList.length} file(s): ${fileList.slice(0, 10).join(', ')} ... and ${fileList.length - 10} more`;
    }

    if (outputs.content && typeof outputs.content === 'string') {
      // fs_read result
      const content = outputs.content;
      const charCount = content.length;
      const lineCount = content.split('\n').length;

      if (charCount <= config.observationMaxLength) {
        return `File content (${charCount} chars, ${lineCount} lines):\n${content}`;
      }

      // Truncate with preview
      const preview = content.substring(0, Math.min(200, config.observationMaxLength));
      return `File content (${charCount} chars, ${lineCount} lines). Preview:\n${preview}\n... (content truncated, ${charCount - preview.length} chars remaining)`;
    }

    if (outputs.results && Array.isArray(outputs.results)) {
      // search_index or web_search result
      const results = outputs.results;
      if (results.length === 0) {
        return 'No results found';
      }
      return `Found ${results.length} result(s):\n${results.slice(0, 5).map((r: any, i: number) =>
        `${i + 1}. ${r.title || r.event || r.url || JSON.stringify(r).substring(0, 100)}`
      ).join('\n')}${results.length > 5 ? `\n... and ${results.length - 5} more` : ''}`;
    }

    if (outputs.tasks && Array.isArray(outputs.tasks)) {
      // task_list result
      const tasks = outputs.tasks;
      if (tasks.length === 0) {
        return 'No tasks found';
      }
      return `Found ${tasks.length} task(s):\n${tasks.map((t: any) =>
        `- [${t.status}] ${t.goal}`
      ).join('\n')}`;
    }

    // Generic output formatting
    const dataStr = JSON.stringify(outputs, null, 2);
    if (dataStr.length <= config.observationMaxLength) {
      return `Success. Output:\n${dataStr}`;
    }

    return `Success. Output preview:\n${dataStr.substring(0, config.observationMaxLength)}\n... (output truncated)`;
  }

  // Simple success with no outputs
  if (result.success === true) {
    return 'Success (no output data)';
  }

  // Fallback
  const resultStr = JSON.stringify(result, null, 2);
  if (resultStr.length <= config.observationMaxLength) {
    return resultStr;
  }
  return resultStr.substring(0, config.observationMaxLength) + '... (truncated)';
}

/**
 * Check if the task is complete based on the goal and observations.
 *
 * OPTIMIZATION: Use deterministic rules to skip LLM call when completion
 * is obvious (e.g., after conversational_response or first fs action).
 *
 * @param context - Current ReAct context
 * @returns true if task is complete, false otherwise
 */
async function checkCompletion(context: ReActContext): Promise<boolean> {
  audit({
    level: 'info',
    category: 'action',
    event: 'react_checking_completion',
    details: {
      iteration: context.steps.length,
      goal: context.goal,
    },
    actor: 'operator-react',
  });

  if (context.steps.length === 0) {
    return false;
  }

  const lastStep = context.steps[context.steps.length - 1];

  // OPTIMIZATION: Fast-path for deterministic completion rules
  // This saves 50-100ms per obvious case

  // Rule 1: conversational_response skill is always terminal (produces final answer)
  if (lastStep.action === 'conversational_response' && lastStep.observation.startsWith('Success')) {
    audit({
      level: 'info',
      category: 'action',
      event: 'react_completion_fastpath',
      details: {
        rule: 'conversational_response_terminal',
        complete: true,
        savedLatency: '50-100ms',
      },
      actor: 'operator-react',
    });
    return true;
  }

  // Rule 2: Errors require adaptation, definitely not complete
  if (lastStep.observation.startsWith('Error:')) {
    audit({
      level: 'info',
      category: 'action',
      event: 'react_completion_fastpath',
      details: {
        rule: 'error_not_complete',
        complete: false,
        savedLatency: '50-100ms',
      },
      actor: 'operator-react',
    });
    return false;
  }

  // Rule 3: First file system action is never complete (need to respond to user)
  if (context.steps.length === 1 && lastStep.action.startsWith('fs_')) {
    audit({
      level: 'info',
      category: 'action',
      event: 'react_completion_fastpath',
      details: {
        rule: 'first_fs_action',
        complete: false,
        savedLatency: '50-100ms',
      },
      actor: 'operator-react',
    });
    return false;
  }

  // Rule 4: First task operation is never complete (need to respond to user)
  if (context.steps.length === 1 && lastStep.action.startsWith('task_')) {
    audit({
      level: 'info',
      category: 'action',
      event: 'react_completion_fastpath',
      details: {
        rule: 'first_task_action',
        complete: false,
        savedLatency: '50-100ms',
      },
      actor: 'operator-react',
    });
    return false;
  }

  // Rule 5: First web search is never complete (need to respond to user)
  if (context.steps.length === 1 && lastStep.action === 'web_search') {
    audit({
      level: 'info',
      category: 'action',
      event: 'react_completion_fastpath',
      details: {
        rule: 'first_web_search',
        complete: false,
        savedLatency: '50-100ms',
      },
      actor: 'operator-react',
    });
    return false;
  }

  // Fall back to LLM for ambiguous cases
  audit({
    level: 'info',
    category: 'action',
    event: 'react_completion_llm_needed',
    details: {
      reason: 'ambiguous_case',
      lastAction: lastStep.action,
      stepCount: context.steps.length,
    },
    actor: 'operator-react',
  });

  return await checkCompletionWithLLM(context);
}

/**
 * Use LLM to determine task completion (fallback for ambiguous cases).
 */
async function checkCompletionWithLLM(context: ReActContext): Promise<boolean> {
  // Build summary of all observations
  const observationsSummary = context.steps.map(s => `
Step ${s.iteration}: ${s.action}
Result: ${s.observation.substring(0, 200)}${s.observation.length > 200 ? '...' : ''}`).join('\n');

  const systemPrompt = `You are a task completion evaluator. Analyze whether the goal has been achieved based on the observations.

Goal: ${context.goal}
${context.audience ? `Audience: ${context.audience}` : ''}

Steps taken:
${observationsSummary}

Question: Has the goal been achieved? Consider:
- Do we have all the information needed?
- Have we completed all necessary actions?
- Are there any errors that need to be resolved?

Respond with ONLY a JSON object:
{
  "complete": true/false,
  "reason": "Brief explanation of why the task is complete or incomplete"
}`;

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Is the task complete?' },
  ];

  try {
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      options: {
        temperature: 0.2, // Very low temperature for consistent evaluation
        maxTokens: 200,
      },
    });

    const parsed = JSON.parse(response.content);

    audit({
      level: 'info',
      category: 'action',
      event: 'react_completion_checked',
      details: {
        complete: parsed.complete,
        reason: parsed.reason,
        iteration: context.steps.length,
      },
      actor: 'operator-react',
    });

    return parsed.complete === true;
  } catch (error) {
    audit({
      level: 'warn',
      category: 'action',
      event: 'react_completion_check_error',
      details: {
        error: (error as Error).message,
        iteration: context.steps.length,
      },
      actor: 'operator-react',
    });

    // On error, assume not complete and continue
    return false;
  }
}

/**
 * Extract the final result from the completed context.
 *
 * OPTIMIZATION: Skip LLM synthesis when the last skill already produced
 * a perfect response (e.g., conversational_response skill).
 *
 * @param context - Completed ReAct context
 * @returns The final result to return to the user
 */
async function extractFinalResult(context: ReActContext): Promise<any> {
  audit({
    level: 'info',
    category: 'action',
    event: 'react_extracting_result',
    details: {
      iterations: context.steps.length,
    },
    actor: 'operator-react',
  });

  // OPTIMIZATION: Fast-path for terminal skills that already produced perfect output
  if (context.steps.length > 0) {
    const lastStep = context.steps[context.steps.length - 1];

    // Terminal skills that produce user-ready responses
    const terminalSkills = ['conversational_response'];

    if (terminalSkills.includes(lastStep.action) && lastStep.observation.startsWith('Success')) {
      audit({
        level: 'info',
        category: 'action',
        event: 'react_synthesis_skipped',
        details: {
          reason: 'terminal_skill_output',
          skill: lastStep.action,
          savedLatency: '100-200ms',
        },
        actor: 'operator-react',
      });

      // Extract the actual response from the observation
      // Format varies by skill, try multiple patterns

      // Pattern 1: "Success. Output: <response>"
      let match = lastStep.observation.match(/Success\.\s*Output:\s*(.+)/s);
      if (match) {
        return match[1].trim();
      }

      // Pattern 2: "Success (response follows): <response>"
      match = lastStep.observation.match(/Success[^:]*:\s*(.+)/s);
      if (match) {
        return match[1].trim();
      }

      // Pattern 3: Just the observation itself (already formatted)
      if (lastStep.observation.length > 50) {
        return lastStep.observation.replace(/^Success\.\s*/i, '').trim();
      }
    }
  }

  // Fall back to LLM synthesis for complex multi-step results
  audit({
    level: 'info',
    category: 'action',
    event: 'react_synthesis_llm',
    details: {
      reason: 'multi_step_synthesis_needed',
      iterations: context.steps.length,
    },
    actor: 'operator-react',
  });

  // Build complete context of all steps
  const stepsContext = context.steps.map(s => `
Step ${s.iteration}: ${s.thought}
Action: ${s.action}(${JSON.stringify(s.actionInput)})
Observation: ${s.observation}`).join('\n\n');

  const systemPrompt = `You are a result synthesizer. Review all the steps taken and provide a clear, concise summary for the user.

Goal: ${context.goal}
${context.audience ? `Audience: ${context.audience}` : ''}

Steps taken:
${stepsContext}

Provide a clear summary of:
1. What was accomplished
2. Key findings or data discovered
3. Any important notes or caveats

Be concise but complete. Format the response for the ${context.audience || 'user'}.`;

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Summarize the results.' },
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      options: {
        temperature: 0.7,
        maxTokens: 1000,
      },
    });

    audit({
      level: 'info',
      category: 'action',
      event: 'react_result_extracted',
      details: {
        iterations: context.steps.length,
        resultLength: response.content.length,
      },
      actor: 'operator-react',
    });

    return response.content;
  } catch (error) {
    audit({
      level: 'warn',
      category: 'action',
      event: 'react_result_extraction_error',
      details: {
        error: (error as Error).message,
      },
      actor: 'operator-react',
    });

    // Fallback: return the last observation
    if (context.steps.length > 0) {
      return context.steps[context.steps.length - 1].observation;
    }

    return 'Task completed but no result available.';
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Main entry point for the ReAct operator.
 * Compatible with the existing operator interface.
 *
 * @param task - The task to execute
 * @param onProgress - Optional callback for streaming progress
 * @returns The task result
 */
export async function runTask(
  task: OperatorTask,
  onProgress?: (step: ReActStep) => void
): Promise<any> {
  const context = await runReActLoop(task, onProgress);

  if (context.error) {
    throw new Error(context.error);
  }

  return context.result;
}

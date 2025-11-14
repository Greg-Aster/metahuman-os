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
import { callLLM, type RouterMessage, type RouterResponse } from '../../packages/core/src/model-router.js';
import type { SkillResult } from '../../packages/core/src/skills.js';
import { canWriteMemory, shouldCaptureTool } from '@metahuman/core/memory-policy';
import { loadCognitiveMode } from '@metahuman/core/cognitive-mode';
import { getUserContext } from '@metahuman/core/context';
import { resolvePathWithFuzzyFallback, type PathResolution } from '@metahuman/core/path-resolver';
import { initializeSkills } from '../skills/index';
import { ReasoningEngine } from '@metahuman/core/reasoning';
import { formatContextForPrompt } from '@metahuman/core/context-builder';

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
// V2 Scratchpad Types (Phase 2 Implementation)
// ============================================================================

/**
 * Single entry in the structured scratchpad
 */
export interface ScratchpadEntry {
  step: number;
  thought: string; // LLM reasoning about what to do
  action?: {
    tool: string;
    args: Record<string, any>;
  }; // Optional tool invocation
  observation?: {
    mode: 'narrative' | 'structured' | 'verbatim';
    content: string;
    success: boolean;
    error?: {
      code: string;
      message: string;
      context: any;
    };
  }; // Result of tool execution
  outputs?: any; // Raw skill outputs for precision-grounded responses
  timestamp: string;
}

/**
 * Planning response from LLM (JSON structured)
 */
export interface PlanningResponse {
  thought: string; // Required reasoning about current state
  action?: {
    tool: string;
    args: Record<string, any>;
  }; // Optional tool to invoke
  respond?: boolean; // True when ready to respond to user
  responseStyle?: 'default' | 'strict' | 'summary'; // How to format final response
}

/**
 * ReAct V2 state with structured scratchpad
 */
export interface ReactState {
  scratchpad: ScratchpadEntry[];
  maxSteps: number;
  currentStep: number;
  completed: boolean;
  finalResponse?: string;
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

  const baseMessages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Return ONLY JSON. No other text.' },
  ];

  try {
    const { parsed, response } = await requestPlannerJson(baseMessages, context);

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

interface PlannerJsonResult {
  parsed: any;
  response: RouterResponse;
}

async function requestPlannerJson(
  baseMessages: RouterMessage[],
  context: ReActContext,
  maxAttempts = 2
): Promise<PlannerJsonResult> {
  let messages = baseMessages;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await callLLM({
        role: 'orchestrator',
        messages,
        options: {
          temperature: 0.3,
          maxTokens: 1000,
        },
      });

      const parsed = JSON.parse(extractJsonBlock(response.content));
      return { parsed, response };
    } catch (error) {
      lastError = error as Error;

      audit({
        level: 'warn',
        category: 'action',
        event: 'react_planning_parse_retry',
        details: {
          iteration: context.steps.length + 1,
          attempt,
          error: (error as Error).message,
        },
        actor: 'operator-react',
      });

      if (attempt === maxAttempts) {
        break;
      }

      messages = [
        ...baseMessages,
        {
          role: 'user',
          content: `Your previous reply was not valid JSON (error: ${(error as Error).message}). Respond again with ONLY the JSON object specified in the schema.`,
        },
      ];
    }
  }

  throw lastError ?? new Error('Planner failed to return valid JSON');
}

function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
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

      const formatValue = (label: string, value?: string) => value ? `${label}: ${value}` : '';

      const formatTask = (task: any, index: number) => {
        const parts = [
          `title: ${task.title || task.goal || task.description || task.id || 'Untitled task'}`,
          formatValue('status', task.status),
          formatValue('priority', task.priority),
          formatValue('tags', Array.isArray(task.tags) ? task.tags.join(', ') : task.tags),
          formatValue('due', task.due),
          formatValue('created', task.created),
          formatValue('description', task.description)
        ].filter(Boolean);
        return `${index + 1}. ${parts.join(' | ')}`;
      };

      return `Found ${tasks.length} task(s):\n${tasks.map((task: any, idx: number) => formatTask(task, idx)).join('\n')}`;
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
// V2 Implementation (Phase 2 - Structured Scratchpad)
// ============================================================================

/**
 * Format scratchpad for LLM consumption (V2)
 */
function formatScratchpadForLLM(scratchpad: ScratchpadEntry[]): string {
  if (scratchpad.length === 0) {
    return '(Empty - this is your first step)';
  }

  // Trim to last 10 steps to manage token limits
  const recentSteps = scratchpad.slice(-10);

  return recentSteps.map(entry => {
    let text = `Thought ${entry.step}: ${entry.thought}\n`;

    if (entry.action) {
      text += `Action ${entry.step}: ${entry.action.tool}(${JSON.stringify(entry.action.args)})\n`;
    }

    if (entry.observation) {
      if (entry.observation.success) {
        text += `Observation ${entry.step}: ${entry.observation.content}`;
      } else {
        text += `Observation ${entry.step}: ❌ ERROR - ${entry.observation.error?.message}`;
      }
    }

    return text;
  }).join('\n\n---\n\n');
}

/**
 * Plan next step using structured scratchpad (V2)
 */
async function planNextStepV2(
  goal: string,
  state: ReactState,
  contextPackage?: any,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<PlanningResponse> {
  // Import tool catalog
  const { getCachedCatalog } = await import('@metahuman/core');

  // Build structured scratchpad prompt
  const scratchpadText = formatScratchpadForLLM(state.scratchpad);
  const toolCatalog = getCachedCatalog();

  // NEW: Format context package if provided
  const contextNarrative = contextPackage
    ? `\n## Relevant Context\n\n${formatContextForPrompt(contextPackage)}\n`
    : '';

  const systemPrompt = `You are an autonomous agent using a ReAct (Reason-Act-Observe) pattern to help the user.

${toolCatalog}
${contextNarrative}
## Reasoning Process

For each step, provide your reasoning in this JSON format:
{
  "thought": "Your analysis of the current situation and what to do next",
  "action": { "tool": "skill_id", "args": {...} },  // Optional: omit if responding
  "respond": false,  // Set to true when ready to give final response
  "responseStyle": "default"  // Use "strict" for data-only responses, "default" for conversation
}

## Critical Rules

1. **ONLY use data from Observations** - Never invent, assume, or hallucinate information
2. **One action at a time** - Execute one tool, observe result, then plan next step
3. **Cite your sources** - Reference specific observation numbers when making claims
4. **Detect completion** - Set "respond": true when you have enough information to answer
5. **Handle errors gracefully** - If a tool fails, try alternatives or ask for clarification${contextNarrative ? '\n6. **Leverage context** - Use relevant memories, function guides, and tool history when applicable' : ''}

## Current Scratchpad

${scratchpadText}

## User Goal

${goal}`;

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Plan the next step. Return valid JSON only.' }
  ];

  // Use orchestrator model for planning
  const response = await callLLM({
    role: 'orchestrator',
    messages,
    options: {
      temperature: 0.1,
      maxTokens: 1000,
    },
    cognitiveMode: userContext?.cognitiveMode,
    userId: userContext?.userId
  });

  // Parse and validate response
  try {
    const planning = JSON.parse(extractJsonBlock(response.content)) as PlanningResponse;

    // Validate required fields
    if (!planning.thought) {
      throw new Error('Planning response missing required "thought" field');
    }

    if (planning.action && (!planning.action.tool || !planning.action.args)) {
      throw new Error('Planning action missing "tool" or "args" field');
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'react_v2_step_planned',
      details: {
        step: state.currentStep,
        action: planning.action?.tool,
        respond: planning.respond,
        model: response.modelId,
      },
      actor: 'operator-react-v2',
    });

    return planning;
  } catch (parseError) {
    // Retry once with schema hint
    audit({
      category: 'system',
      level: 'warn',
      event: 'react_v2_planning_json_parse_failed',
      details: { error: (parseError as Error).message, response: response.content },
      actor: 'operator-react-v2',
    });

    return retryPlanningWithHint(goal, state, response.content, userContext);
  }
}

/**
 * Retry planning with explicit schema hint (V2)
 */
async function retryPlanningWithHint(
  goal: string,
  state: ReactState,
  invalidResponse: string,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<PlanningResponse> {
  const messages: RouterMessage[] = [
    {
      role: 'system',
      content: `Your previous response was invalid JSON. Please provide a response matching this exact schema:

{
  "thought": "string - your reasoning",
  "action": { "tool": "string", "args": {} },  // Optional
  "respond": boolean,  // Optional, default false
  "responseStyle": "default" | "strict" | "summary"  // Optional
}

Previous invalid response:
${invalidResponse}`
    },
    { role: 'user', content: `Goal: ${goal}\n\nProvide valid JSON following the schema above.` }
  ];

  const response = await callLLM({
    role: 'orchestrator',
    messages,
    options: { temperature: 0.05 },
    cognitiveMode: userContext?.cognitiveMode,
    userId: userContext?.userId
  });

  const planning = JSON.parse(extractJsonBlock(response.content)) as PlanningResponse;

  if (!planning.thought) {
    throw new Error('Retry failed: still missing "thought" field');
  }

  return planning;
}

// ============================================================================
// V2 Observation Modes (Phase 3)
// ============================================================================

type ObservationMode = 'narrative' | 'structured' | 'verbatim';

interface ObservationResult {
  mode: ObservationMode;
  content: string;
  success: boolean;
  error?: { code: string; message: string; context: any };
}

/**
 * Format tool execution result based on mode (V2)
 */
function formatObservationV2(
  tool: string,
  result: SkillResult,
  mode: ObservationMode = 'narrative'
): ObservationResult {
  if (!result.success) {
    return {
      mode,
      content: `Error executing ${tool}: ${result.error || 'Unknown error'}`,
      success: false,
      error: {
        code: 'SKILL_ERROR',
        message: result.error || 'Unknown error',
        context: { tool, result }
      }
    };
  }

  switch (mode) {
    case 'verbatim':
      return {
        mode,
        content: JSON.stringify(result.outputs, null, 2),
        success: true
      };

    case 'structured':
      return {
        mode,
        content: formatStructured(tool, result),
        success: true
      };

    case 'narrative':
    default:
      return {
        mode,
        content: formatNarrative(tool, result),
        success: true
      };
  }
}

function hasExecutedTool(entries: ScratchpadEntry[]): boolean {
  return entries.some(entry => entry.action && entry.observation);
}

/**
 * Format observation as structured data (bullet lists/JSON)
 */
function formatStructured(tool: string, result: SkillResult): string {
  const outputs = result.outputs || {};

  switch (tool) {
    case 'task_list': {
      const tasks = outputs.tasks || [];
      if (tasks.length === 0) return '• No tasks found';

      return tasks.map((t: any) =>
        `• [${t.status || 'unknown'}] ${t.title || t.goal || 'Untitled'} (priority: ${t.priority || 'none'})`
      ).join('\n');
    }

    case 'fs_list': {
      const files = outputs.files || [];
      const dirs = outputs.directories || [];

      let text = '';
      if (dirs.length > 0) {
        text += `Directories (${dirs.length}):\n${dirs.map((d: string) => `  📁 ${d}`).join('\n')}\n`;
      }
      if (files.length > 0) {
        text += `Files (${files.length}):\n${files.map((f: string) => `  📄 ${f}`).join('\n')}`;
      }

      return text || '(empty directory)';
    }

    case 'fs_read': {
      const content = outputs.content || '';
      const lines = content.split('\n').length;
      return `File size: ${content.length} chars, ${lines} lines\n\nContent:\n${content}`;
    }

    case 'task_find':
    case 'task_create':
    case 'task_update_status': {
      const task = outputs.task || outputs;
      return `• Task: ${task.title || task.goal || 'Untitled'}\n• Status: ${task.status || 'unknown'}\n• Priority: ${task.priority || 'none'}`;
    }

    case 'web_search': {
      const results = outputs.results || [];
      if (results.length === 0) return '• No results found';

      return results.slice(0, 5).map((r: any, i: number) =>
        `${i + 1}. ${r.title || 'Untitled'}\n   URL: ${r.url || 'N/A'}\n   Snippet: ${r.snippet || 'No description'}`
      ).join('\n\n');
    }

    case 'search_index': {
      const results = outputs.results || [];
      if (results.length === 0) return '• No results found';

      return results.slice(0, 5).map((r: any, i: number) =>
        `${i + 1}. ${r.event || r.title || 'Untitled'} (score: ${r.score?.toFixed(2) || 'N/A'})`
      ).join('\n');
    }

    default:
      // Generic structured format
      return Object.entries(outputs)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join('\n');
  }
}

/**
 * Format observation as narrative (existing logic)
 */
function formatNarrative(tool: string, result: SkillResult): string {
  // Use existing formatObservation logic
  return formatObservation(result, DEFAULT_CONFIG);
}

/**
 * Detect if query is purely data retrieval (should use verbatim mode)
 */
function detectDataRetrievalIntent(goal: string): boolean {
  const dataKeywords = [
    'list', 'show', 'what tasks', 'display', 'read file',
    'get', 'fetch', 'retrieve', 'search for', 'find all',
    'tell me about my tasks', 'show me', 'what are'
  ];

  const goalLower = goal.toLowerCase();
  return dataKeywords.some(keyword => goalLower.includes(keyword));
}

/**
 * Check if we can short-circuit with verbatim response
 */
async function checkVerbatimShortCircuit(
  goal: string,
  onProgress?: (update: any) => void
): Promise<any | null> {
  if (!detectDataRetrievalIntent(goal)) {
    return null; // Not a data query
  }

  // Simple heuristic: if goal mentions "tasks", try task_list
  if (goal.toLowerCase().includes('task')) {
    try {
      const result = await coreExecuteSkill(
        'task_list',
        { includeCompleted: false },
        'bounded_auto',
        true
      );

      if (result.success) {
        const observation = formatObservationV2('task_list', result, 'structured');

        onProgress?.({
          type: 'completion',
          content: observation.content,
          step: 1,
          verbatim: true
        });

        audit({
          level: 'info',
          category: 'action',
          event: 'react_v2_verbatim_shortcircuit',
          details: {
            goal,
            tool: 'task_list',
            savedIterations: 2
          },
          actor: 'operator-react-v2',
        });

        return {
          goal,
          result: observation.content,
          reasoning: 'Direct task list retrieval (verbatim mode)',
          actions: ['task_list'],
          verbatim: true
        };
      }
    } catch (error) {
      // Fall through to normal loop
      audit({
        level: 'warn',
        category: 'action',
        event: 'react_v2_verbatim_shortcircuit_failed',
        details: {
          goal,
          error: (error as Error).message
        },
        actor: 'operator-react-v2',
      });
    }
  }

  // Could add more heuristics for other common queries
  return null;
}

// ============================================================================
// V2 Error Handling (Phase 5)
// ============================================================================

interface ErrorAnalysis {
  code: string;
  suggestions: string[];
}

/**
 * Analyze error and provide contextual suggestions
 */
function analyzeError(tool: string, args: any, errorMessage: string): ErrorAnalysis {
  const errorLower = errorMessage.toLowerCase();

  // File not found errors
  if (errorLower.includes('not found') || errorLower.includes('enoent')) {
    if (tool === 'fs_read' || tool === 'fs_write' || tool === 'fs_delete') {
      return {
        code: 'FILE_NOT_FOUND',
        suggestions: [
          'Use fs_list to check what files exist in the directory',
          'Verify the file path is correct',
          'Check if the file was recently deleted or moved'
        ]
      };
    }

    if (tool === 'task_find' || tool === 'task_list') {
      return {
        code: 'TASK_NOT_FOUND',
        suggestions: [
          'Use task_list to see all available tasks',
          'Check if the task was already completed',
          'Verify the task ID is correct'
        ]
      };
    }
  }

  // Permission errors
  if (errorLower.includes('permission') || errorLower.includes('eacces')) {
    return {
      code: 'PERMISSION_DENIED',
      suggestions: [
        'Check file/directory permissions',
        'Verify you have access to this location',
        'Try a different file or directory'
      ]
    };
  }

  // Invalid arguments
  if (errorLower.includes('invalid') || errorLower.includes('validation')) {
    return {
      code: 'INVALID_ARGS',
      suggestions: [
        'Check the skill manifest for correct input format',
        'Verify all required fields are provided',
        'Check data types match the schema'
      ]
    };
  }

  // Network errors
  if (errorLower.includes('network') || errorLower.includes('timeout') || errorLower.includes('econnrefused')) {
    return {
      code: 'NETWORK_ERROR',
      suggestions: [
        'Check network connectivity',
        'Try again in a moment',
        'Verify the URL or endpoint is correct'
      ]
    };
  }

  // Skill not found
  if (errorLower.includes('skill') && errorLower.includes('not found')) {
    return {
      code: 'SKILL_NOT_FOUND',
      suggestions: [
        'Check available skills in the tool catalog',
        'Verify the skill ID is spelled correctly',
        'Use a similar skill that exists'
      ]
    };
  }

  // Generic error
  return {
    code: 'UNKNOWN_ERROR',
    suggestions: [
      'Try a different approach',
      'Ask the user for clarification',
      'Check the logs for more details'
    ]
  };
}

interface FailureTracker {
  [actionKey: string]: {
    count: number;
    lastError: string;
  };
}

/**
 * Detect if we're in a failure loop (same action failing repeatedly)
 */
function detectFailureLoop(
  scratchpad: ScratchpadEntry[],
  currentAction: { tool: string; args: any }
): { isLoop: boolean; suggestion: string } {
  const failures: FailureTracker = {};

  // Count failures for each unique action
  for (const entry of scratchpad) {
    if (entry.observation && !entry.observation.success && entry.action) {
      const key = `${entry.action.tool}:${JSON.stringify(entry.action.args)}`;

      if (!failures[key]) {
        failures[key] = { count: 0, lastError: '' };
      }

      failures[key].count++;
      failures[key].lastError = entry.observation.error?.message || '';
    }
  }

  // Check if current action has already failed
  const currentKey = `${currentAction.tool}:${JSON.stringify(currentAction.args)}`;
  const currentFailures = failures[currentKey];

  if (currentFailures && currentFailures.count >= 2) {
    return {
      isLoop: true,
      suggestion: `⚠️ This action (${currentAction.tool}) has already failed ${currentFailures.count} times. Consider trying a different approach. Last error: ${currentFailures.lastError}`
    };
  }

  return { isLoop: false, suggestion: '' };
}

interface SkillExecutionResult {
  success: boolean;
  content: string; // Formatted observation
  outputs?: any; // Raw outputs
  error?: {
    code: string;
    message: string;
    context: any;
    suggestions?: string[]; // Recommended next actions
  };
}

/**
 * Execute skill with enhanced error capture (V2)
 */
async function executeSkillWithErrorHandling(
  tool: string,
  args: Record<string, any>,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<SkillExecutionResult> {
  try {
    const result = await coreExecuteSkill(
      tool,
      args,
      'bounded_auto',
      true
    );

    if (!result.success) {
      // Analyze error and provide suggestions
      const errorAnalysis = analyzeError(tool, args, result.error || 'Unknown error');

      return {
        success: false,
        content: `❌ ${tool} failed: ${result.error}`,
        error: {
          code: errorAnalysis.code,
          message: result.error || 'Unknown error',
          context: { tool, args, result },
          suggestions: errorAnalysis.suggestions
        }
      };
    }

    // Success - format observation using V2 formatter
    const observationMode: ObservationMode = 'structured';
    const observation = formatObservationV2(tool, result, observationMode);

    return {
      success: true,
      content: observation.content,
      outputs: result.outputs
    };

  } catch (error) {
    // Unexpected error during execution
    const errorAnalysis = analyzeError(tool, args, (error as Error).message);

    return {
      success: false,
      content: `❌ Unexpected error executing ${tool}: ${(error as Error).message}`,
      error: {
        code: 'UNEXPECTED_ERROR',
        message: (error as Error).message,
        context: { tool, args, stack: (error as Error).stack },
        suggestions: errorAnalysis.suggestions
      }
    };
  }
}

/**
 * Main V2 ReAct loop with structured scratchpad
 */
async function runReActLoopV2(
  goal: string,
  context: { memories?: any[]; conversationHistory?: any[]; contextPackage?: any },
  onProgress?: (update: any) => void,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<any> {
  // Check for verbatim short-circuit FIRST
  const verbatimResult = await checkVerbatimShortCircuit(goal, onProgress);
  if (verbatimResult) {
    return verbatimResult;
  }

  const state: ReactState = {
    scratchpad: [],
    maxSteps: 10,
    currentStep: 0,
    completed: false
  };

  audit({
    level: 'info',
    category: 'action',
    event: 'react_v2_loop_started',
    details: {
      goal,
      maxSteps: state.maxSteps,
    },
    actor: 'operator-react-v2',
  });

  while (state.currentStep < state.maxSteps && !state.completed) {
    state.currentStep++;

    // Plan next step
    const planning = await planNextStepV2(goal, state, context.contextPackage, userContext);

    // Create scratchpad entry
    const entry: ScratchpadEntry = {
      step: state.currentStep,
      thought: planning.thought,
      timestamp: new Date().toISOString()
    };

    // Stream thought to UI
    onProgress?.({
      type: 'thought',
      content: planning.thought,
      step: state.currentStep
    });

    // Execute action if present
    if (planning.action && !planning.respond) {
      entry.action = planning.action;

      // Check for failure loops BEFORE executing
      const loopCheck = detectFailureLoop(state.scratchpad, planning.action);

      if (loopCheck.isLoop) {
        // Inject warning into scratchpad
        const warningEntry: ScratchpadEntry = {
          step: state.currentStep,
          thought: `${planning.thought}\n\n${loopCheck.suggestion}`,
          timestamp: new Date().toISOString()
        };

        state.scratchpad.push(warningEntry);

        onProgress?.({
          type: 'warning',
          content: loopCheck.suggestion,
          step: state.currentStep
        });

        audit({
          level: 'warn',
          category: 'action',
          event: 'react_v2_failure_loop_detected',
          details: {
            goal,
            step: state.currentStep,
            action: planning.action.tool,
            loopSuggestion: loopCheck.suggestion
          },
          actor: 'operator-react-v2',
        });

        // Give LLM one more chance to adjust (continue to next iteration)
        continue;
      }

      // Execute skill with enhanced error handling
      const executionResult = await executeSkillWithErrorHandling(
        planning.action.tool,
        planning.action.args,
        userContext
      );

      // Convert execution result to observation format
      entry.observation = {
        mode: 'structured',
        content: executionResult.content,
        success: executionResult.success,
        error: executionResult.error
      };
      entry.outputs = executionResult.outputs;

      // If error has suggestions, append them to observation content
      if (executionResult.error?.suggestions) {
        entry.observation.content += '\n\nSuggestions:\n' +
          executionResult.error.suggestions.map(s => `- ${s}`).join('\n');
      }

      // Stream action + observation to UI
      onProgress?.({
        type: 'action',
        tool: planning.action.tool,
        args: planning.action.args,
        step: state.currentStep
      });

      onProgress?.({
        type: 'observation',
        content: entry.observation.content,
        success: executionResult.success,
        mode: entry.observation.mode,
        errorCode: executionResult.error?.code,
        step: state.currentStep
      });
    }

    state.scratchpad.push(entry);

    // Check for completion
    if (planning.respond) {
      const requiresEvidence = !isPureChatRequest(goal);
      const toolExecuted = hasExecutedTool(state.scratchpad);

      if (requiresEvidence && !toolExecuted) {
        const warning = 'Planned response lacks supporting tool execution; gather evidence before replying.';
        onProgress?.({
          type: 'warning',
          content: warning,
          step: state.currentStep
        });

        audit({
          level: 'warn',
          category: 'action',
          event: 'react_v2_missing_evidence',
          details: { goal, iteration: state.currentStep },
          actor: 'operator-react-v2',
        });

        state.scratchpad.push({
          step: state.currentStep,
          thought: `${planning.thought}\n\n${warning}`,
          timestamp: new Date().toISOString()
        });

        continue;
      }

      state.completed = true;

      const successfulEntries = state.scratchpad.filter(e => e.observation?.success);
      const observations = successfulEntries.map(e => e.observation!.content).join('\n\n');

      const evidenceBlocks = successfulEntries
        .filter(e => e.outputs && typeof e.outputs === 'object')
        .map(e => {
          const toolName = e.action?.tool || 'unknown_tool';
          try {
            return `Tool ${toolName} outputs:\n${JSON.stringify(e.outputs, null, 2)}`;
          } catch {
            return `Tool ${toolName} outputs (non-serializable)`;
          }
        });

      const responseContextSections: string[] = [];
      if (evidenceBlocks.length > 0) {
        responseContextSections.push(['## Structured Evidence', ...evidenceBlocks].join('\n\n'));
      }
      if (observations) {
        responseContextSections.push(`## Observations\n${observations}`);
      }

      const responseContext = responseContextSections.join('\n\n') || 'No information gathered';

      // Use strict style automatically when we have structured evidence unless planner overrides
      const responseStyle = planning.responseStyle || (evidenceBlocks.length ? 'strict' : 'default');

      try {
        const result = await coreExecuteSkill(
          'conversational_response',
          {
            context: responseContext,
            goal: goal,
            style: responseStyle
          },
          'bounded_auto',
          true
        );

        state.finalResponse = result.outputs?.response || 'Task completed';

        onProgress?.({
          type: 'completion',
          content: state.finalResponse,
          step: state.currentStep
        });
      } catch (error) {
        state.finalResponse = observations || 'Task completed but response generation failed';

        onProgress?.({
          type: 'completion',
          content: state.finalResponse,
          step: state.currentStep
        });
      }
    }
  }

  // Handle max iterations reached
  if (!state.completed) {
    audit({
      level: 'warn',
      category: 'action',
      event: 'react_v2_max_iterations',
      details: {
        goal,
        iterations: state.currentStep,
      },
      actor: 'operator-react-v2',
    });

    state.finalResponse = 'Max iterations reached without completion';
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'react_v2_loop_completed',
    details: {
      goal,
      iterations: state.currentStep,
      completed: state.completed,
    },
    actor: 'operator-react-v2',
  });

  // ========================================================================
  // Phase 3: Track Function Usage
  // ========================================================================

  // Extract function IDs from context if provided
  const providedFunctionIds: string[] = [];
  if (context.contextPackage?.functionGuides) {
    providedFunctionIds.push(...context.contextPackage.functionGuides.map((g: any) => g.id));
  }

  const result = {
    goal,
    result: state.finalResponse || 'No result generated',
    reasoning: state.scratchpad.map(e => e.thought).join(' → '),
    actions: state.scratchpad.filter(e => e.action).map(e => e.action!.tool),
    scratchpad: state.scratchpad, // Include for debugging
    metadata: {
      completed: state.completed,
      iterations: state.currentStep,
      providedFunctions: providedFunctionIds,
      timestamp: new Date().toISOString(),
    }
  };

  // Record function usage if functions were provided
  if (providedFunctionIds.length > 0 && state.completed) {
    try {
      const { recordFunctionUsage } = await import('@metahuman/core/function-memory');

      // Record usage for each provided function
      for (const functionId of providedFunctionIds) {
        await recordFunctionUsage(functionId, state.completed);
      }
    } catch (error) {
      // Don't fail the operator if usage tracking fails
      console.error('[operator-react-v2] Error recording function usage:', error);
    }
  }

  // ========================================================================
  // Phase 3: Auto-Learn New Functions from Multi-Step Patterns
  // ========================================================================

  // Detect if this execution created a pattern worth learning
  if (state.completed && state.scratchpad.length >= 3) {
    try {
      const { detectAndLearnPattern } = await import('@metahuman/core/function-memory');

      // Analyze scratchpad for reusable patterns
      await detectAndLearnPattern(
        goal,
        state.scratchpad,
        {
          sessionId: context.sessionId,
          userId: userContext?.userId || 'system',
        }
      );
    } catch (error) {
      // Don't fail the operator if pattern learning fails
      console.error('[operator-react-v2] Error learning pattern:', error);
    }
  }

  return result;
}

// ============================================================================
// Public API (Phase 6 - Feature Flag Integration)
// ============================================================================

/**
 * Run operator using unified ReasoningEngine service.
 * This is the new architecture that replaces inline V2 implementation.
 *
 * @param goal - User goal/question
 * @param context - Reasoning context (memories, history)
 * @param onProgress - Progress callback for SSE events
 * @param userContext - User context (ID, cognitive mode)
 * @param reasoningDepth - Reasoning depth (0-3 from UI slider)
 * @returns Operator result
 */
async function runWithReasoningEngine(
  goal: string,
  context?: { memories?: any[]; conversationHistory?: any[]; contextPackage?: any; sessionId?: string; conversationId?: string },
  onProgress?: (update: any) => void,
  userContext?: { userId?: string; cognitiveMode?: string },
  reasoningDepth: number = 2 // Default: focused
): Promise<any> {
  // Map reasoning depth (0-3) to ReasoningDepth type
  const depthMap: Record<number, 'off' | 'quick' | 'focused' | 'deep'> = {
    0: 'off',
    1: 'quick',
    2: 'focused',
    3: 'deep',
  };
  const depth = depthMap[reasoningDepth] || 'focused';

  // Create reasoning engine
  const engine = new ReasoningEngine({
    depth,
    sessionId: context?.sessionId || `session-${Date.now()}`,
    conversationId: context?.conversationId,
    userId: userContext?.userId,
    enableFastPath: true,
    enableVerbatimShortCircuit: true,
    enableErrorRetry: true,
    enableFailureLoopDetection: true,
  });

  // Convert ReasoningEngine events to operator progress format
  const progressAdapter = (event: any) => {
    // Map reasoning events to operator format for backward compatibility
    switch (event.type) {
      case 'thought':
        // Raw event for backward compatibility
        onProgress?.({
          type: 'thought',
          content: event.data.thought,
          step: event.step,
        });
        // UI-compatible reasoning event (for ChatInterface reasoning slider)
        onProgress?.({
          type: 'reasoning',
          data: {
            round: event.step,
            stage: 'thought',
            content: `**Thought:** ${event.data.thought}`,
          },
        });
        break;
      case 'action':
        // Raw event for backward compatibility
        onProgress?.({
          type: 'action',
          content: `Executing ${event.data.tool}`,
          step: event.step,
          tool: event.data.tool,
        });
        // UI-compatible reasoning event
        onProgress?.({
          type: 'reasoning',
          data: {
            round: event.step,
            stage: 'action',
            content: `**Action:** Executing \`${event.data.tool}\` with args: \`${JSON.stringify(event.data.args)}\``,
          },
        });
        break;
      case 'observation':
        // Raw event for backward compatibility
        onProgress?.({
          type: 'observation',
          content: event.data.result,
          step: event.step,
          success: event.data.success,
        });
        // UI-compatible reasoning event
        const obsPrefix = event.data.success ? '**Observation:**' : '**Error:**';
        const obsContent = typeof event.data.result === 'string'
          ? event.data.result
          : JSON.stringify(event.data.result, null, 2);
        onProgress?.({
          type: 'reasoning',
          data: {
            round: event.step,
            stage: 'observation',
            content: `${obsPrefix} ${obsContent}`,
          },
        });
        break;
      case 'completion':
        // Raw event for backward compatibility
        onProgress?.({
          type: 'completion',
          content: event.data.finalResponse,
          step: event.step,
          metadata: event.data.metadata,
        });
        // UI-compatible reasoning event
        onProgress?.({
          type: 'reasoning',
          data: {
            round: event.step,
            stage: 'completion',
            content: `**Complete:** ${event.data.finalResponse}`,
          },
        });
        break;
      case 'error':
        // Raw event for backward compatibility
        onProgress?.({
          type: 'error',
          content: event.data.error?.message,
          step: event.step,
        });
        // UI-compatible reasoning event
        onProgress?.({
          type: 'reasoning',
          data: {
            round: event.step,
            stage: 'error',
            content: `**Error:** ${event.data.error?.message || 'Unknown error'}`,
          },
        });
        break;
    }
  };

  // Run reasoning engine
  const result = await engine.run(
    goal,
    {
      memories: context?.memories || [],
      conversationHistory: context?.conversationHistory || [],
      contextPackage: context?.contextPackage,
      cognitiveMode: userContext?.cognitiveMode,
      userId: userContext?.userId,
      sessionId: context?.sessionId,
      conversationId: context?.conversationId,
    },
    progressAdapter
  );

  // Return in operator format
  return {
    goal,
    result: result.result,
    reasoning: result.scratchpad.map((e) => e.thought).join(' → '),
    actions: result.scratchpad.filter((e) => e.action).map((e) => e.action!.tool),
    scratchpad: result.scratchpad,
    metadata: result.metadata,
  };
}

/**
 * Run operator with feature flag routing (V1 vs V2 vs ReasoningEngine)
 *
 * This function checks the reactV2 feature flag and routes to either:
 * - V1: Legacy ReAct loop (runReActLoop)
 * - V2: Enhanced scratchpad-based loop (runReActLoopV2) OR ReasoningEngine
 *
 * To use ReasoningEngine instead of inline V2, set: operator.useReasoningService = true
 */
export async function runOperatorWithFeatureFlag(
  goal: string,
  context?: { memories?: any[]; conversationHistory?: any[]; contextPackage?: any; sessionId?: string; conversationId?: string },
  onProgress?: (update: any) => void,
  userContext?: { userId?: string; cognitiveMode?: string },
  reasoningDepth?: number
): Promise<any> {
  const { isReactV2Enabled, useReasoningService: checkReasoningService } = await import('@metahuman/core/config');

  const useV2 = isReactV2Enabled();
  const useService = checkReasoningService();

  audit({
    level: 'info',
    category: 'system',
    event: 'operator_feature_flag_check',
    details: {
      goal: goal.substring(0, 100),
      useV2,
      useService,
      userId: userContext?.userId
    },
    actor: 'operator',
  });

  if (useV2 && useService) {
    // Run with unified ReasoningEngine service
    return runWithReasoningEngine(goal, context || {}, onProgress, userContext, reasoningDepth);
  } else if (useV2) {
    // Run inline V2 with all enhancements
    return runReActLoopV2(goal, context || {}, onProgress, userContext);
  } else {
    // Run V1 (legacy) - convert interface
    const task: OperatorTask = {
      id: `task-${Date.now()}`,
      goal,
      context: JSON.stringify(context),
      status: 'in_progress',
      created: new Date().toISOString()
    };

    const v1Context = await runReActLoop(task, (step) => {
      onProgress?.({
        type: 'step',
        content: step.observation,
        step: step.iteration
      });
    });

    return {
      goal,
      result: v1Context.result,
      reasoning: v1Context.steps.map(s => s.thought).join(' → '),
      actions: v1Context.steps.map(s => s.action)
    };
  }
}

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

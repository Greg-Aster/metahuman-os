/**
 * Reasoning Service - Planning Logic
 *
 * LLM-based planning with structured JSON validation and retry.
 * Extracted from Operator V2.
 */

import { getCachedCatalog } from '../tool-catalog';
import { callLLM, type RouterMessage } from '../model-router';
import { audit } from '../audit';
import { formatScratchpadForLLM } from './scratchpad';
import { formatContextForPrompt } from '../context-builder';
import type { PlanningResponse, ReactState, ReasoningEngineConfig } from './types';

/**
 * Extract JSON block from LLM response (handles markdown code blocks).
 */
export function extractJsonBlock(raw: string): string {
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
 * Plan next step using structured scratchpad (V2).
 *
 * Uses orchestrator model to generate JSON planning response:
 * - thought: Reasoning about current situation
 * - action: Tool to execute (optional)
 * - respond: Whether to generate final response
 * - responseStyle: How to format final response
 *
 * @param goal - User goal
 * @param state - Current ReAct state
 * @param config - Reasoning engine configuration
 * @param contextPackage - Optional context package with memories, persona, etc.
 * @param userContext - User context (ID, cognitive mode)
 * @returns Planning response (validated JSON)
 */
export async function planNextStepV2(
  goal: string,
  state: ReactState,
  config: Required<ReasoningEngineConfig>,
  contextPackage?: any,
  userContext?: { userId?: string; cognitiveMode?: string }
): Promise<PlanningResponse> {
  // Build structured scratchpad prompt
  const scratchpadText = formatScratchpadForLLM(state.scratchpad, config.scratchpadTrimSize);
  const toolCatalog = config.toolCatalog || getCachedCatalog();

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
    { role: 'user', content: 'Plan the next step. Return valid JSON only.' },
  ];

  // Use orchestrator model for planning
  const response = await callLLM({
    role: config.planningModel === 'orchestrator' ? 'orchestrator' : 'persona',
    messages,
    options: {
      temperature: 0.1,
      maxTokens: 1000,
    },
    cognitiveMode: userContext?.cognitiveMode,
    userId: userContext?.userId,
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
      event: 'reasoning_step_planned',
      details: {
        step: state.currentStep,
        action: planning.action?.tool,
        respond: planning.respond,
        model: response.modelId,
      },
      actor: 'reasoning-service',
    });

    return planning;
  } catch (parseError) {
    // Retry once with schema hint
    audit({
      category: 'system',
      level: 'warn',
      event: 'reasoning_planning_json_parse_failed',
      details: { error: (parseError as Error).message, response: response.content },
      actor: 'reasoning-service',
    });

    return retryPlanningWithHint(goal, state, response.content, config, userContext);
  }
}

/**
 * Retry planning with explicit schema hint.
 * Called when initial planning produces invalid JSON.
 *
 * @param goal - User goal
 * @param state - Current ReAct state
 * @param invalidResponse - Invalid response from first attempt
 * @param config - Reasoning engine configuration
 * @param userContext - User context
 * @returns Planning response (second attempt)
 */
async function retryPlanningWithHint(
  goal: string,
  state: ReactState,
  invalidResponse: string,
  config: Required<ReasoningEngineConfig>,
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
${invalidResponse}`,
    },
    { role: 'user', content: `Goal: ${goal}\n\nProvide valid JSON following the schema above.` },
  ];

  const response = await callLLM({
    role: config.planningModel === 'orchestrator' ? 'orchestrator' : 'persona',
    messages,
    options: { temperature: 0.05 },
    cognitiveMode: userContext?.cognitiveMode,
    userId: userContext?.userId,
  });

  const planning = JSON.parse(extractJsonBlock(response.content)) as PlanningResponse;

  if (!planning.thought) {
    throw new Error('Retry failed: still missing "thought" field');
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'reasoning_planning_retry_success',
    details: {
      step: state.currentStep,
      action: planning.action?.tool,
    },
    actor: 'reasoning-service',
  });

  return planning;
}

/**
 * Validate planning response structure.
 *
 * @param planning - Planning response to validate
 * @throws Error if validation fails
 */
export function validatePlanning(planning: PlanningResponse): void {
  if (!planning.thought) {
    throw new Error('Planning response missing required "thought" field');
  }

  if (typeof planning.thought !== 'string' || planning.thought.trim().length === 0) {
    throw new Error('Planning "thought" must be a non-empty string');
  }

  if (planning.action) {
    if (!planning.action.tool || typeof planning.action.tool !== 'string') {
      throw new Error('Planning action missing or invalid "tool" field');
    }

    if (!planning.action.args || typeof planning.action.args !== 'object') {
      throw new Error('Planning action missing or invalid "args" field');
    }
  }

  if (planning.respond !== undefined && typeof planning.respond !== 'boolean') {
    throw new Error('Planning "respond" must be a boolean');
  }

  if (planning.responseStyle) {
    const validStyles = ['default', 'strict', 'summary'];
    if (!validStyles.includes(planning.responseStyle)) {
      throw new Error(
        `Planning "responseStyle" must be one of: ${validStyles.join(', ')} (got: ${planning.responseStyle})`
      );
    }
  }
}

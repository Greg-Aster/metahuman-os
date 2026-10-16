import { reasoningProperty } from './model-router.schema.js';
import { ENVIRONMENT_CONTEXT_ENTRIES, selectedEnvironmentRoutes, type EnvironmentRequestRouting } from '../environment/context-routing.js';
/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║   NO HARDCODING! ALL INTENT DETECTION IS LLM-INTERPRETED                  ║
 * ║                                                                           ║
 * ║   The ActionType union and prompt examples are DOCUMENTATION ONLY.        ║
 * ║   The LLM reads the prompt and decides intent - NO pattern matching.      ║
 * ║   To add new actions: update the prompt, not the code logic.              ║
 * ║                                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Orchestrator LLM Node
 *
 * Enhanced intent analysis for routing decisions
 * Determines:
 * - Memory needs (tier, query)
 * - Action detection (file ops, tasks, web search → Big Brother)
 * - Response style adaptation based on conversation context
 * - Complexity scoring for routing decisions
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { projectEnvironmentHistory } from '../environment/helpers.js';
import { callLLM } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';
import { modelRouterDefinition } from './model-router.schema.js';

// Action types that can trigger Big Brother
export type ActionType =
  | 'none'           // No action needed, just conversation
  | 'file_read'      // Read a file
  | 'file_write'     // Write/create a file
  | 'file_list'      // List files/directories
  | 'task_create'    // Create a new task
  | 'task_update'    // Update/complete a task
  | 'task_list'      // List tasks
  | 'web_search'     // Search the web
  | 'memory_search'  // Explicit memory search request
  | 'code_execute'   // Run code or commands
  | 'complex_task'   // Multi-step task requiring Big Brother
  | 'setting_change' // Change system settings
  | 'persona_update'; // Update persona/preferences

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are the Intent Orchestrator. Analyze the user's message and determine routing.

MEMORY SEARCH RULES:
needsMemory=TRUE when:
- User asks a QUESTION about past events, history, or stored information
- User explicitly references memory ("remember when...", "what did I say about...")
- User asks about preferences, relationships, or past conversations

needsMemory=FALSE when:
- Casual greetings, social statements, or observations ("hey", "it's late", "I'm bored")
- User is SHARING new information, not asking about old information
- Simple conversational exchanges that don't require recall
- Creative requests or philosophical discussions

Default to FALSE for statements/observations. Only TRUE for actual recall questions.

When needsMemory is true, choose the semantic search scope:
- memoryQuery describes what should be recalled.
- memoryTypes is an array of exact stored record types when the request targets a particular kind of memory; otherwise use [].
- Available record types include conversation, observation, reflection, reflection_summary, dream, daydream, audio, curiosity, action, tool_invocation, and inner_dialogue.
- Decide from the meaning and context of the request. The memory router will execute your selection without keyword-based intent rules.

Output JSON:
{
  "needsMemory": boolean,
  "memoryTier": string,
  "memoryQuery": string,
  "memoryTypes": string[],
  "needsAction": boolean,
  "actionType": string,
  "actionParams": object,
  "complexity": number,
  "responseStyle": string,
  "responseLength": string,
  "isFollowUp": boolean,
  "emotionalTone": string
}
{{feedbackSection}}
{{recentConversationSection}}`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Analyze this message: "{{userMessage}}"`;

const ENVIRONMENT_INTENT_FIELDS = [
  'needsResponse',
  'needsConversationHistory',
  'needsMemory',
  'needsRobotStatus',
  'needsEnvironment',
  'needsVision',
  'needsAction',
] as const;

export type EnvironmentIntentRouting = Record<typeof ENVIRONMENT_INTENT_FIELDS[number], boolean> & {
  needsExecutionContext?: boolean;
  needsPersona?: boolean;
  memoryQuery?: string;
  memoryTypes?: string[];
  memoryOrder?: 'relevance' | 'newest';
  memoryTimeRange?: { from?: string; before?: string };
  memorySleepCycle?: 'latest';
};

const temporalMemoryProperties = {
  memoryOrder: {
    type: 'string', enum: ['relevance', 'newest'],
    description: 'Order matching records by semantic relevance or by recorded time, newest first.',
  },
  memoryTimeRange: {
    type: 'object', additionalProperties: false,
    properties: { from: { type: 'string' }, before: { type: 'string' } },
    description: 'Restrict records to an explicitly identified time interval. from is inclusive and before is exclusive; timestamps use ISO 8601 with a timezone offset.',
  },
  memorySleepCycle: {
    type: 'string', enum: ['latest'],
    description: "Select the profile's latest recorded sleep cycle. The memory owner resolves its identity and reports its state; the model does not supply a session ID.",
  },
} as const;

export const ENVIRONMENT_INTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...ENVIRONMENT_INTENT_FIELDS],
  properties: { ...temporalMemoryProperties, memoryQuery: { type: 'string' }, memoryTypes: { type: 'array', items: { type: 'string' } }, ...Object.fromEntries(ENVIRONMENT_INTENT_FIELDS.map(field => [field, { type: 'boolean' }])) as Record<typeof ENVIRONMENT_INTENT_FIELDS[number], { type: 'boolean' }> },
} as const;

export const ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['needsResponse', 'needsAction', 'needsToolUse', 'taskPlanner', 'taskContext', 'conversationContext'],
  properties: {
    ...temporalMemoryProperties,
    needsResponse: { type: 'boolean' }, needsAction: { type: 'boolean' },
    needsToolUse: { type: 'boolean' },
    taskContext: { type: 'array', items: { type: 'string', enum: [...ENVIRONMENT_CONTEXT_ENTRIES] } },
    conversationContext: { type: 'array', items: { type: 'string', enum: [...ENVIRONMENT_CONTEXT_ENTRIES] } },
    memoryQuery: { type: 'string' }, memoryTypes: { type: 'array', items: { type: 'string' } },
    taskPlanner: { type: 'string', enum: ['specialist', 'vision'] },
  },
} as const;

export function parseEnvironmentIntentRouting(value: unknown, requestOnly: true): EnvironmentRequestRouting;
export function parseEnvironmentIntentRouting(value: unknown, requestOnly: false): EnvironmentIntentRouting;
export function parseEnvironmentIntentRouting(value: unknown): EnvironmentRequestRouting;
export function parseEnvironmentIntentRouting(value: unknown, requestOnly: boolean): EnvironmentRequestRouting | EnvironmentIntentRouting;
export function parseEnvironmentIntentRouting(value: unknown, requestOnly = true): EnvironmentRequestRouting | EnvironmentIntentRouting {
  if (typeof value !== 'string') throw new Error('Environment intent output must be strict JSON text');
  let parsed: unknown;
  try { parsed = JSON.parse(value.trim()); }
  catch { throw new Error('Environment intent output is not strict JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Environment intent output must be one JSON object');
  const record = parsed as Record<string, unknown>;
  const fields: readonly string[] = requestOnly ? ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA.required : ENVIRONMENT_INTENT_FIELDS;
  const unexpected = Object.keys(record).filter(field => !fields.includes(field) && !['memoryQuery', 'memoryTypes', ...Object.keys(temporalMemoryProperties)].includes(field));
  if (unexpected.length > 0) throw new Error(`Environment intent output contains unsupported field(s): ${unexpected.join(', ')}`);
  for (const field of fields) {
    // Retained training examples and saved routes predate delegated tool use.
    if (requestOnly && field === 'needsToolUse' && record[field] === undefined) continue;
    if (requestOnly && field === 'taskPlanner') {
      // Existing saved routes predate planner selection; fresh inference uses
      // the required schema field above.
      if (record[field] !== undefined && !['specialist', 'vision'].includes(record[field] as string)) {
        throw new Error('Environment intent output requires a valid taskPlanner');
      }
      continue;
    }
    if (requestOnly && (field === 'taskContext' || field === 'conversationContext')) {
      if (!Array.isArray(record[field]) || record[field].some(entry => !ENVIRONMENT_CONTEXT_ENTRIES.includes(entry))) {
        throw new Error(`Environment intent output requires valid context entries in ${field}`);
      }
    } else if (typeof record[field] !== 'boolean') throw new Error(`Environment intent output requires boolean ${field}`);
  }
  if (record.memoryQuery !== undefined && typeof record.memoryQuery !== 'string') throw new Error('Invalid memory query');
  if (record.memoryTypes !== undefined && (!Array.isArray(record.memoryTypes) || record.memoryTypes.some(type => typeof type !== 'string'))) throw new Error('Invalid memory types');
  if (record.memoryOrder !== undefined && !['relevance', 'newest'].includes(record.memoryOrder as string)) throw new Error('Invalid memory order');
  if (record.memorySleepCycle !== undefined && record.memorySleepCycle !== 'latest') throw new Error('Invalid memory sleep cycle');
  if (record.memoryTimeRange !== undefined) {
    const range = record.memoryTimeRange;
    if (!range || typeof range !== 'object' || Array.isArray(range)) throw new Error('Invalid memory time range');
    for (const [key, timestamp] of Object.entries(range)) {
      if (!['from', 'before'].includes(key) || typeof timestamp !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
        || !Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid memory time range timestamp');
    }
  }
  return record as unknown as EnvironmentRequestRouting | EnvironmentIntentRouting;
}

function withAnalysis<T extends Record<string, any>>(result: T): T & { analysis: T } {
  return {
    ...result,
    analysis: result,
  };
}

export function resolveOrchestratorActionRequirement(input: {
  declaredNeedsAction: boolean;
  actionType: string;
  complexity: number;
  cognitiveMode?: string;
}): boolean {
  return input.declaredNeedsAction
    || input.actionType !== 'none'
    || (input.cognitiveMode !== 'environment' && input.complexity > 0.7);
}

export const OrchestratorLLMNode: NodeDefinition = defineNode({
  id: 'orchestrator_llm',
  name: 'Intent Orchestrator',
  category: 'chat',
  inputs: [
    { name: 'autonomy', type: 'boolean', optional: true, description: 'Select the saved autonomous-input prompts for an internally authored intention.' },
    { name: 'message', type: 'string', description: 'Instruction or message whose routing needs should be analyzed' },
    { name: 'execution', type: 'object', optional: true, description: 'Current execution facts for routing an internal intention' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Recent conversation for context awareness' },
    { name: 'systemSettings', type: 'object', optional: true, description: 'System settings for permission context' },
    { name: 'feedbackContext', type: 'object', optional: true, description: 'Feedback from previous iteration (for refinement loops)' },
  ],
  outputs: [
    { name: 'taskPlanner', type: 'string', description: 'Model-selected task planner' },
    { name: 'useVisionPlanner', type: 'boolean', description: 'Whether Intent selected the vision planner' },
    { name: 'needsToolUse', type: 'boolean', description: 'Whether delegated computer tool use is selected.' },
    { name: 'raw', type: 'string', description: 'Exact model output before parsing' },
    { name: 'modelMessages', type: 'array', description: 'Exact messages supplied to this model call' },
    { name: 'analysis', type: 'object', description: 'Complete typed routing analysis' },
    { name: 'needsResponse', type: 'boolean', description: 'Whether this turn needs a conversational response' },
    { name: 'needsExecutionContext', type: 'boolean', description: 'Whether downstream reasoning needs execution context' },
    { name: 'needsPersona', type: 'boolean', description: 'Whether downstream reasoning needs persona context' },
    { name: 'needsConversationHistory', type: 'boolean', description: 'Whether downstream reasoning needs recent dialogue context' },
    { name: 'needsMemory', type: 'boolean', description: 'Whether memory search is needed' },
    { name: 'memoryTier', type: 'string', description: 'Memory tier to search' },
    { name: 'memoryQuery', type: 'string', description: 'Optimized search query' },
    { name: 'memoryTypes', type: 'array', description: 'Exact stored memory types selected semantically by the LLM; empty for broad recall' },
    { name: 'needsEnvironment', type: 'boolean', description: 'Whether current environment state or capabilities are needed' },
    { name: 'needsVision', type: 'boolean', description: 'Whether fresh correlated visual evidence is needed' },
    { name: 'needsRobotStatus', type: 'boolean', description: 'Whether downstream reasoning needs the current Robot Status snapshot' },
    { name: 'needsAction', type: 'boolean', description: 'Whether an action/skill is needed (routes to Big Brother)' },
    { name: 'actionType', type: 'string', description: 'Type of action to perform' },
    { name: 'actionParams', type: 'object', description: 'Parameters for the action' },
    { name: 'complexity', type: 'number', description: 'Task complexity 0-1 (>0.7 triggers Big Brother)' },
    { name: 'responseStyle', type: 'string', description: 'Suggested response style' },
    { name: 'responseLength', type: 'string', description: 'Expected response length: brief/medium/detailed' },
    { name: 'isFollowUp', type: 'boolean', description: 'Whether this is a follow-up to previous message' },
    { name: 'emotionalTone', type: 'string', description: 'Detected emotional context' },
  ],
  description: 'Enhanced intent analysis with action detection and conversation awareness',
  presentation: { defaultExpanded: true },

  properties: {
    enableThinking: false,
    role: 'orchestrator',
    outputContract: 'general',
    systemPrompt: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
    temperature: 0.2,
    maxTokens: 768,
  },
  propertySchemas: {
    autonomySystemPrompt: { type: 'text_multiline', default: '', label: 'Autonomy System Prompt', rows: 16 },
    autonomyUserPromptTemplate: { type: 'text_multiline', default: '', label: 'Autonomy Input Template', rows: 4 },
    enableThinking: reasoningProperty,
    role: { ...modelRouterDefinition.propertySchemas.role, default: 'orchestrator' },
    outputContract: {
      type: 'select',
      default: 'general',
      label: 'Routing Contract',
      canvas: 'expanded',
      description: 'Selects the typed intent fields this instance must return. Environment routing emits route switches only.',
      options: [
        { value: 'general', label: 'General' },
        { value: 'environment', label: 'Environment' },
        { value: 'environment-request', label: 'Environment Request Only' },
      ],
    },
    systemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      label: 'System Prompt',
      description: 'Supports {{feedbackSection}} and {{recentConversationSection}}.',
      rows: 16,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Supports {{userMessage}}, {{feedbackSection}}, and {{recentConversationSection}}.',
      rows: 4,
    },
    temperature: {
      type: 'slider',
      default: 0.2,
      label: 'Temperature',
      min: 0,
      max: 1,
      step: 0.1,
    },
    maxTokens: {
      type: 'number',
      default: 768,
      label: 'Max Tokens',
      description: 'Use -1 for unlimited generation on llama.cpp; positive values request an explicit output limit.',
      min: -1,
      step: 1,
    },
  },

  execute: async (inputs, context, properties) => {
    if (context.environmentInterpretation?.route) return context.environmentInterpretation.route;
    // Named inputs from graph edges with array fallbacks
    const requestOnly = properties?.outputContract === 'environment-request';
    const environmentContract = requestOnly || properties?.outputContract === 'environment';
    const inputData = inputs.message || inputs[0];
    const conversationHistory = requestOnly ? [] : inputs.conversationHistory || inputs[1] || context.conversationHistory || [];
    const systemSettings = inputs.systemSettings || inputs[2] || {};
    const feedbackContext = requestOnly ? null : inputs.feedbackContext || inputs[3] || null;
    const userMessage = typeof inputData === 'string'
      ? inputData
      : (inputData?.message || context.userMessage || '');

    // Analyze conversation context
    const conversationLength = Array.isArray(conversationHistory) ? conversationHistory.length : 0;
    const isInConversation = conversationLength > 2;

    // Check if this is a refinement iteration
    const isRefinementPass = feedbackContext !== null;
    const currentIteration = feedbackContext?.iteration ?? 1;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      if (environmentContract) {
        throw new Error('Intent Orchestrator requires an instruction or message');
      }
      return withAnalysis({
        needsMemory: false,
        memoryTier: 'hot',
        memoryQuery: '',
        memoryTypes: [],
        needsEnvironment: false,
        needsVision: false,
        needsAction: false,
        actionType: 'none',
        actionParams: {},
        complexity: 0,
        responseStyle: 'conversational',
        responseLength: 'brief',
        isFollowUp: false,
        emotionalTone: 'neutral',
        conversationDepth: conversationLength,
        error: 'No user message provided',
      });
    }

    // Buffer History owns the window. Preserve its selected dialogue, including
    // requirements at the end of a message and the retained latest user turn.
    const recentMessages = requestOnly ? '' : environmentContract
      ? JSON.stringify({ currentTime: context.currentTime ?? new Date().toISOString(), ...projectEnvironmentHistory(conversationHistory) })
      : Array.isArray(conversationHistory)
      ? conversationHistory
        .filter((message: any) => (
          (message?.role === 'user' || message?.role === 'assistant')
          && typeof message?.content === 'string'
          && message.content.trim()
        ))
        .map((message: any) => {
          const role = message.role === 'user' ? 'User' : 'Assistant';
          return `${role}: ${message.content.trim()}`;
        }).join('\n')
      : '';

    try {
      // Build feedback section if this is a refinement pass
      let feedbackSection = '';
      if (isRefinementPass && feedbackContext) {
        feedbackSection = `
IMPORTANT: This is refinement iteration ${currentIteration}. Previous attempt(s) failed quality checks.
Feedback from previous attempt: ${feedbackContext.specificFeedback || 'No specific feedback'}
Feedback type: ${feedbackContext.feedbackType || 'quality'}

Adjust your routing based on this feedback. If memory search already failed, consider:
- Setting needsMemory to false (already searched, no results)
- Recommending an "I don't know" style response
- Adjusting responseStyle to be more honest about uncertainty`;
      }

      const promptValues = {
        userMessage,
        executionSection: !requestOnly && inputs.execution ? `Current execution: ${JSON.stringify(inputs.execution)}` : '',
        feedbackSection,
        recentMessages,
        recentConversationSection: recentMessages ? `Recent conversation:\n${recentMessages}` : '',
      };
      const systemPrompt = renderPromptTemplate(
        (inputs.autonomy === true ? properties?.autonomySystemPrompt : properties?.systemPrompt) || DEFAULT_SYSTEM_PROMPT_TEMPLATE,
        promptValues,
      );
      const userPrompt = renderPromptTemplate(
        (inputs.autonomy === true ? properties?.autonomyUserPromptTemplate : properties?.userPromptTemplate) || DEFAULT_USER_PROMPT_TEMPLATE,
        promptValues,
      );

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt },
      ];

      const response = await callLLM({
        signal: context.abortSignal,
        role: properties?.role || 'orchestrator',
        userId: context.userId || context.username,
        messages,
        cognitiveMode: context.cognitiveMode,
        options: {
          enableThinking: properties?.enableThinking === true,
          maxTokens: properties?.maxTokens || 768,
          ...(requestOnly ? {} : { repeatPenalty: 1.15 }),
          temperature: properties?.temperature ?? 0.2,
          format: environmentContract ? 'json' : undefined,
          jsonSchema: requestOnly ? ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA : environmentContract ? ENVIRONMENT_INTENT_JSON_SCHEMA : undefined,
        },
        onProgress: context.emitProgress,
      });

      if (environmentContract) {
        const routing = parseEnvironmentIntentRouting(response.content, requestOnly);
        return {
          ...routing,
          ...selectedEnvironmentRoutes(routing),
          useVisionPlanner: ('taskPlanner' in routing && routing.taskPlanner === 'vision')
            || ('taskContext' in routing && Array.isArray(routing.taskContext) && routing.taskContext.includes('vision')),
          analysis: routing,
          modelMessages: messages,
          raw: response.content,
          thinking: response.thinking,
        };
      }

      try {
        const parsed = JSON.parse(response.content);
        const needsEnvironment = typeof parsed.needsEnvironment === 'boolean'
          ? parsed.needsEnvironment
          : undefined;
        const needsVision = typeof parsed.needsVision === 'boolean'
          ? parsed.needsVision
          : undefined;

        // Force medium+ response length in active conversations
        let responseLength = parsed.responseLength || 'medium';
        if (isInConversation && responseLength === 'brief') {
          responseLength = 'medium';
        }

        // Determine if action requires Big Brother
        const needsAction = parsed.needsAction === true;
        const complexity = typeof parsed.complexity === 'number' && Number.isFinite(parsed.complexity)
          ? Math.max(0, Math.min(1, parsed.complexity))
          : 0.3;
        const actionType = parsed.actionType || 'none';
        const triggersBigBrother = resolveOrchestratorActionRequirement({
          declaredNeedsAction: needsAction,
          actionType,
          complexity,
          cognitiveMode: context.cognitiveMode,
        });

        return withAnalysis({
          needsMemory: parsed.needsMemory ?? false,
          memoryTier: parsed.memoryTier || 'hot',
          memoryQuery: parsed.memoryQuery || '',
          memoryTypes: Array.isArray(parsed.memoryTypes) ? parsed.memoryTypes : [],
          needsEnvironment,
          needsVision,
          needsAction: triggersBigBrother,
          actionType: actionType,
          actionParams: parsed.actionParams || {},
          complexity,
          responseStyle: parsed.responseStyle || 'conversational',
          responseLength,
          isFollowUp: parsed.isFollowUp ?? (conversationLength > 0),
          emotionalTone: parsed.emotionalTone || 'neutral',
          conversationDepth: conversationLength,
          raw: response.content,
          thinking: response.thinking, // Pass through reasoning for graph executor
        });
      } catch {
        // Fallback parsing for malformed JSON
        const needsMemoryMatch = response.content.match(/needsMemory[":]\s*(true|false)/i);
        const needsEnvironmentMatch = response.content.match(/needsEnvironment[":]\s*(true|false)/i);
        const needsVisionMatch = response.content.match(/needsVision[":]\s*(true|false)/i);
        const tierMatch = response.content.match(/memoryTier[":]\s*["']?(hot|warm|cold|facts|all)/i);
        const needsActionMatch = response.content.match(/needsAction[":]\s*(true|false)/i);
        const actionTypeMatch = response.content.match(/actionType[":]\s*["']?(\w+)/i);
        const complexityMatch = response.content.match(/complexity[":]\s*([\d.]+)/i);
        const responseLengthMatch = response.content.match(/responseLength[":]\s*["']?(brief|medium|detailed)/i);

        const parsedComplexity = complexityMatch ? parseFloat(complexityMatch[1]) : 0.3;
        const complexity = Number.isFinite(parsedComplexity)
          ? Math.max(0, Math.min(1, parsedComplexity))
          : 0.3;
        const needsAction = needsActionMatch?.[1]?.toLowerCase() === 'true';
        const actionType = actionTypeMatch?.[1]?.toLowerCase() || 'none';

        return withAnalysis({
          needsMemory: needsMemoryMatch?.[1]?.toLowerCase() === 'true' || false,
          memoryTier: tierMatch?.[1]?.toLowerCase() || 'hot',
          memoryQuery: '',
          memoryTypes: [],
          needsEnvironment: needsEnvironmentMatch
            ? needsEnvironmentMatch[1]?.toLowerCase() === 'true'
            : undefined,
          needsVision: needsVisionMatch
            ? needsVisionMatch[1]?.toLowerCase() === 'true'
            : undefined,
          needsAction: resolveOrchestratorActionRequirement({
            declaredNeedsAction: needsAction,
            actionType,
            complexity,
            cognitiveMode: context.cognitiveMode,
          }),
          actionType,
          actionParams: {},
          complexity,
          responseStyle: 'conversational',
          responseLength: isInConversation ? 'medium' : (responseLengthMatch?.[1] || 'brief'),
          isFollowUp: conversationLength > 0,
          emotionalTone: 'neutral',
          conversationDepth: conversationLength,
          raw: response.content,
          thinking: response.thinking, // Pass through reasoning for graph executor
        });
      }
    } catch (error) {
      console.error('[OrchestratorLLM] Error:', error);
      if (environmentContract) throw error;
      return withAnalysis({
        needsMemory: false,
        memoryTier: 'hot',
        memoryQuery: '',
        memoryTypes: [],
        needsEnvironment: undefined,
        needsVision: undefined,
        needsAction: false,
        actionType: 'none',
        actionParams: {},
        complexity: 0,
        responseStyle: 'conversational',
        responseLength: isInConversation ? 'medium' : 'brief',
        isFollowUp: conversationLength > 0,
        emotionalTone: 'neutral',
        conversationDepth: conversationLength,
        error: (error as Error).message,
      });
    }
  },
});

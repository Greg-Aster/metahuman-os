/**
 * Real Node Executors for Cognitive Graph System
 *
 * This module provides the actual implementations for all cognitive node types,
 * integrating with the MetaHuman OS cognitive system (LLM, skills, memory, etc.)
 */

import { executeSkill, listSkills, getSkill, type TrustLevel } from './skills.js';
import { callLLM } from './model-router.js';
import { queryIndex } from './vector-index.js';
import { captureEvent, searchMemory, createTask, listActiveTasks, updateTaskStatus } from './memory.js';
import { loadCognitiveMode } from './cognitive-mode.js';
import { loadPersonaCore } from './identity.js';
import { audit } from './audit.js';
import { checkResponseSafety, refineResponseSafely } from './cognitive-layers/index.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface NodeExecutionContext {
  sessionId?: string;
  userId?: string;
  userMessage?: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  conversationHistory?: any[];
  contextPackage?: any;
  contextInfo?: string;
  allowMemoryWrites?: boolean;
  useOperator?: boolean;
  [key: string]: any;
}

export type NodeExecutor = (
  inputs: Record<string, any>,
  context: NodeExecutionContext,
  nodeProperties?: Record<string, any>
) => Promise<Record<string, any>>;

// ============================================================================
// Input Nodes
// ============================================================================

/**
 * User Input Node
 * Provides the user's message and session information
 */
export const userInputExecutor: NodeExecutor = async (inputs, context, properties) => {
  return {
    message: context.userMessage || properties?.message || '',
    sessionId: context.sessionId || `session-${Date.now()}`,
    userId: context.userId || 'anonymous',
    timestamp: new Date().toISOString(),
  };
};

/**
 * Session Context Node
 * Provides conversation history and user context
 */
export const sessionContextExecutor: NodeExecutor = async (inputs, context) => {
  return {
    conversationHistory: context.conversationHistory || [],
    user: context.user || {
      id: context.userId || 'anonymous',
      username: context.username || 'user',
      role: context.userRole || 'user',
    },
    sessionId: context.sessionId,
  };
};

/**
 * System Settings Node
 * Provides cognitive mode and system configuration
 */
export const systemSettingsExecutor: NodeExecutor = async (inputs, context) => {
  try {
    const cognitiveMode = loadCognitiveMode();
    return {
      cognitiveMode: cognitiveMode.currentMode || context.cognitiveMode || 'dual',
      trustLevel: 'supervised_auto',
      settings: {
        recordingEnabled: true,
        proactiveAgents: false,
      },
    };
  } catch (error) {
    console.error('[SystemSettings] Error loading cognitive mode:', error);
    return {
      cognitiveMode: context.cognitiveMode || 'dual',
      trustLevel: 'supervised_auto',
      settings: {},
    };
  }
};

// ============================================================================
// Router Nodes
// ============================================================================

/**
 * Cognitive Mode Router Node
 * Routes execution based on cognitive mode
 */
export const cognitiveModeRouterExecutor: NodeExecutor = async (inputs, context) => {
  const cognitiveMode = inputs[0] || context.cognitiveMode || 'dual';
  const message = inputs[1] || context.userMessage || '';

  // Output routing decision
  return {
    mode: cognitiveMode,
    message,
    routeToOperator: cognitiveMode === 'dual', // Dual mode always uses operator
    routeToChat: cognitiveMode === 'emulation', // Emulation uses chat only
  };
};

/**
 * Operator Eligibility Node
 * Determines if message should use operator or simple chat
 */
export const operatorEligibilityExecutor: NodeExecutor = async (inputs, context) => {
  const message = inputs[0] || context.userMessage || '';

  // Heuristic: action words indicate operator usage
  const actionWords = ['create', 'write', 'update', 'delete', 'run', 'execute', 'search', 'find', 'list', 'show', 'get'];
  const hasActionIntent = actionWords.some(word =>
    message.toLowerCase().includes(word)
  );
  const effectiveDecision = typeof context.useOperator === 'boolean' ? context.useOperator : hasActionIntent;

  return {
    useOperator: effectiveDecision,
    message,
    intent: effectiveDecision ? 'action' : 'conversation',
  };
};

/**
 * Auth Check Node
 * Verifies user authentication and permissions
 */
export const authCheckExecutor: NodeExecutor = async (inputs, context) => {
  const isAuthenticated = context.userId && context.userId !== 'anonymous';

  return {
    authenticated: isAuthenticated,
    userId: context.userId || 'anonymous',
    canWriteMemory: isAuthenticated,
    canExecuteSkills: isAuthenticated,
  };
};

// ============================================================================
// Context Nodes
// ============================================================================

/**
 * Semantic Search Node
 * Searches episodic memory for relevant context
 */
export const semanticSearchExecutor: NodeExecutor = async (inputs, context, properties) => {
  const query = inputs[0] || context.userMessage || '';
  const topK = properties?.topK || properties?.limit || 8;
  const threshold = properties?.threshold || 0.6;

  if (context.contextPackage?.memories) {
    return {
      memories: context.contextPackage.memories,
      query,
      fromCache: true,
    };
  }

  try {
    const results = await queryIndex(query, { topK });

    return {
      memories: results
        .filter(r => r.score >= threshold)
        .map(r => ({
          content: r.item.text || '',
          timestamp: r.item.timestamp,
          type: r.item.type || 'observation',
          score: r.score,
        })),
      query,
    };
  } catch (error) {
    console.error('[SemanticSearch] Error:', error);
    return {
      memories: [],
      query,
      error: (error as Error).message,
    };
  }
};

/**
 * Conversation History Node
 * Retrieves recent conversation messages
 */
export const conversationHistoryExecutor: NodeExecutor = async (inputs, context, properties) => {
  const limit = properties?.limit || 20;
  const history = context.conversationHistory || [];

  return {
    messages: history.slice(-limit),
    count: history.length,
  };
};

/**
 * Context Builder Node
 * Combines multiple context sources into unified context
 */
export const contextBuilderExecutor: NodeExecutor = async (inputs, context) => {
  const query = inputs[0] || inputs[2]?.message || context.userMessage || '';
  const mode = inputs[1] || context.cognitiveMode || 'dual';
  const fallbackMemories = inputs[2]?.memories || inputs[1]?.memories || [];
  const memories = context.contextPackage?.memories || fallbackMemories;
  const conversationHistory = context.contextPackage?.conversationHistory || inputs[3]?.messages || context.conversationHistory || [];

  const contextPayload = context.contextPackage
    ? { ...context.contextPackage, query, mode }
    : {
        query,
        mode,
        memories,
        conversationHistory,
        timestamp: new Date().toISOString(),
      };

  if (context.contextInfo) {
    contextPayload.contextText = context.contextInfo;
  }

  return {
    context: contextPayload,
  };
};

// ============================================================================
// Operator Nodes
// ============================================================================

/**
 * ReAct Planner Node
 * Plans the next action using ReAct reasoning
 */
export const reactPlannerExecutor: NodeExecutor = async (inputs, context) => {
  if (context.useOperator === false) {
    return {};
  }

  const contextData = inputs[0]?.context || inputs[0] || {};
  const scratchpad = inputs[1] || [];

  // Get available skills for planning
  const skills = listSkills();
  const skillDescriptions = skills.map(s => `- ${s.id}: ${s.description}`).join('\n');

  const messages = [
    {
      role: 'system' as const,
      content: `You are a ReAct planner. Your job is to plan the next action to take based on the user's query and available skills.

Available Skills:
${skillDescriptions}

Output your response in this format:
Thought: [your reasoning]
Action: [skill_id]
Action Input: {"param": "value"}

Or if the task is complete:
Thought: [your reasoning]
Final Answer: [your response]`,
    },
    {
      role: 'user' as const,
      content: `Query: ${contextData.query || context.userMessage}

Scratchpad:
${scratchpad.map((s: any) => `${s.thought}\n${s.action}\n${s.observation}`).join('\n\n')}

What should I do next?`,
    },
  ];

  try {
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      cognitiveMode: context.cognitiveMode,
    });

    return {
      plan: response.content,
      scratchpad: [...scratchpad, { plan: response.content }],
    };
  } catch (error) {
    console.error('[ReActPlanner] Error:', error);
    throw new Error(`ReAct planning failed: ${(error as Error).message}`);
  }
};

/**
 * Skill Executor Node
 * Executes a specific skill based on the plan
 */
export const skillExecutorExecutor: NodeExecutor = async (inputs, context) => {
  if (context.useOperator === false) {
    return {};
  }

  const plan = inputs[0] || '';

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

  try {
    const trustLevel: TrustLevel = 'supervised_auto';
    const result = await executeSkill(skillId, skillInputs, trustLevel);

    return {
      success: result.success,
      outputs: result.outputs || {},
      error: result.error,
      skillId,
    };
  } catch (error) {
    console.error('[SkillExecutor] Error executing skill:', error);
    return {
      success: false,
      error: (error as Error).message,
      outputs: {},
      skillId,
    };
  }
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
 * Synthesizes final response from scratchpad
 */
export const responseSynthesizerExecutor: NodeExecutor = async (inputs, context) => {
  if (context.useOperator === false) {
    return {};
  }

  const scratchpad = inputs[0] || [];
  const contextData = inputs[1]?.context || {};

  const messages = [
    {
      role: 'system' as const,
      content: 'You are a response synthesizer. Create a natural, conversational response based on the observations gathered.',
    },
    {
      role: 'user' as const,
      content: `Original Query: ${contextData.query || context.userMessage}

Observations:
${scratchpad.map((s: any) => s.observation || s.plan || '').join('\n\n')}

Provide a clear, helpful response to the user:`,
    },
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      cognitiveMode: context.cognitiveMode,
    });

    return {
      response: response.content,
    };
  } catch (error) {
    console.error('[ResponseSynthesizer] Error:', error);
    return {
      response: 'I encountered an error while processing your request.',
      error: (error as Error).message,
    };
  }
};

// ============================================================================
// Chat Nodes
// ============================================================================

/**
 * Persona LLM Node
 * Generates response using persona with conversation history
 */
export const personaLLMExecutor: NodeExecutor = async (inputs, context) => {
  if (context.useOperator === true) {
    return {};
  }

  const message = inputs[0]?.message || inputs[0] || context.userMessage || '';
  const conversationHistory = inputs[1]?.messages || context.conversationHistory || [];

  try {
    const persona = loadPersonaCore();

    const messages = [
      {
        role: 'system' as const,
        content: `You are ${persona.identity.name}. ${persona.identity.purpose || ''}

${persona.personality ? `Personality: ${JSON.stringify(persona.personality)}` : ''}

Respond naturally as yourself, maintaining your personality and perspective.`,
      },
      ...conversationHistory.slice(-10).map((msg: any) => ({
        role: msg.role || 'user',
        content: msg.content || msg.message || '',
      })).filter((msg: any) => {
        // Only include messages with non-empty string content
        return typeof msg.content === 'string' && msg.content.trim().length > 0;
      }),
      {
        role: 'user' as const,
        content: message,
      },
    ].filter((msg) => {
      // Final filter to ensure all messages have valid content
      return typeof msg.content === 'string' && msg.content.trim().length > 0;
    });

    const response = await callLLM({
      role: 'persona',
      messages,
      cognitiveMode: context.cognitiveMode,
    });

    return {
      response: response.content,
    };
  } catch (error) {
    console.error('[PersonaLLM] Error:', error);
    return {
      response: 'I apologize, but I encountered an error generating a response.',
      error: (error as Error).message,
    };
  }
};

/**
 * Chain of Thought Stripper Node
 * Removes internal reasoning markers from LLM output
 */
export const chainOfThoughtStripperExecutor: NodeExecutor = async (inputs) => {
  // Extract response string from various input formats
  let response = '';
  if (typeof inputs[0] === 'string') {
    response = inputs[0];
  } else if (inputs[0]?.response && typeof inputs[0].response === 'string') {
    response = inputs[0].response;
  } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
    response = inputs[0].content;
  }

  // Remove common CoT markers
  let cleaned = response
    // Remove <think>...</think> blocks (including multiline)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Remove stray closing </think> tags
    .replace(/<\/think>/gi, '')
    // Remove ReAct-style markers
    .replace(/^Thought:.*$/gm, '')
    .replace(/^Action:.*$/gm, '')
    .replace(/^Observation:.*$/gm, '')
    .replace(/^Final Answer:\s*/i, '')
    .trim();

  return {
    cleaned,
    response: cleaned,
  };
};

/**
 * Safety Validator Node
 * Checks response for safety/policy violations
 */
export const safetyValidatorExecutor: NodeExecutor = async (inputs, context) => {
  // Extract response string from various input formats
  let response = '';
  if (typeof inputs[0] === 'string') {
    response = inputs[0];
  } else if (inputs[0]?.response && typeof inputs[0].response === 'string') {
    response = inputs[0].response;
  } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
    response = inputs[0].content;
  } else if (inputs[0]?.cleaned && typeof inputs[0].cleaned === 'string') {
    response = inputs[0].cleaned;
  }

  if (!response || response.trim().length === 0) {
    return {};
  }

  try {
    const safetyResult = await checkResponseSafety(response, {
      cognitiveMode: context?.cognitiveMode || 'emulation',
      userId: context?.userId || 'anonymous',
      logToConsole: false,
      auditIssues: true,
    });

    return {
      response: safetyResult.response,
      isSafe: safetyResult.safe,
      issues: safetyResult.issues || [],
      safetyResult,
    };
  } catch (error) {
    console.error('[SafetyValidator] Error:', error);
    return {
      response,
      isSafe: true,
      issues: [],
    };
  }
};

/**
 * Response Refiner Node
 * Polishes and improves response quality
 */
export const responseRefinerExecutor: NodeExecutor = async (inputs, context) => {
  // Extract response string from various input formats
  let response = '';
  if (typeof inputs[0] === 'string') {
    response = inputs[0];
  } else if (inputs[0]?.response && typeof inputs[0].response === 'string') {
    response = inputs[0].response;
  } else if (inputs[0]?.content && typeof inputs[0].content === 'string') {
    response = inputs[0].content;
  } else if (inputs[0]?.cleaned && typeof inputs[0].cleaned === 'string') {
    response = inputs[0].cleaned;
  }

  const safetyResult = inputs[1]?.safetyResult || inputs[1];

  if (!response || response.trim().length === 0) {
    return {};
  }

  if (!safetyResult || safetyResult.safe) {
    return { response };
  }

  try {
    const refinement = await refineResponseSafely(response, safetyResult, {
      cognitiveMode: context.cognitiveMode,
      logToConsole: false,
      auditChanges: true,
    });

    const finalResponse = refinement.changed ? refinement.refined : response;

    return {
      response: finalResponse,
      refined: refinement.changed,
      changes: refinement.changes || [],
    };
  } catch (error) {
    console.error('[ResponseRefiner] Error:', error);
    return {
      response,
      refined: false,
      error: (error as Error).message,
    };
  }
};

// ============================================================================
// Model Nodes
// ============================================================================

/**
 * Model Resolver Node
 * Resolves which model to use for a given role
 */
export const modelResolverExecutor: NodeExecutor = async (inputs, context) => {
  const role = inputs[0] || 'persona';

  // This would call resolveModel from model-resolver.ts
  // For now, return default mapping
  return {
    modelId: 'default',
    role,
  };
};

/**
 * Model Router Node
 * Routes request to appropriate model
 */
export const modelRouterExecutor: NodeExecutor = async (inputs, context) => {
  const messages = inputs[0] || [];
  const role = inputs[1] || 'persona';

  try {
    const response = await callLLM({
      role,
      messages,
      cognitiveMode: context.cognitiveMode,
    });

    return {
      response: response.content,
    };
  } catch (error) {
    console.error('[ModelRouter] Error:', error);
    return {
      response: 'Error routing to model',
      error: (error as Error).message,
    };
  }
};

// ============================================================================
// Skill Nodes (Individual Skills)
// ============================================================================

/**
 * Generic skill wrapper
 * Wraps any skill for execution in the graph
 */
export const createSkillExecutor = (skillId: string): NodeExecutor => {
  return async (inputs, context) => {
    try {
      const trustLevel: TrustLevel = 'supervised_auto';
      const result = await executeSkill(skillId, inputs, trustLevel);

      return {
        success: result.success,
        ...result.outputs,
        error: result.error,
      };
    } catch (error) {
      console.error(`[Skill:${skillId}] Error:`, error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  };
};

// ============================================================================
// Output Nodes
// ============================================================================

/**
 * Memory Capture Node
 * Saves conversation to episodic memory
 */
export const memoryCaptureExecutor: NodeExecutor = async (inputs, context) => {
  const response = inputs[0]?.response || inputs[0] || '';
  const message = context.userMessage || '';

  if (!response || response.trim().length === 0) {
    return {
      saved: false,
      reason: 'No response to capture',
    };
  }

  if (!context.allowMemoryWrites || !context.userId || context.userId === 'anonymous') {
    // Don't save memory for anonymous users
    return {
      saved: false,
      reason: context.allowMemoryWrites ? 'Anonymous user' : 'Memory writes disabled',
    };
  }

  try {
    const eventId = captureEvent(`User: ${message}\n\nAssistant: ${response}`, {
      type: 'conversation',
      metadata: {
        cognitiveMode: context.cognitiveMode as 'dual' | 'agent' | 'emulation',
        sessionId: context.sessionId,
        userId: context.userId,
      },
    });

    return {
      saved: true,
      type: 'conversation',
      eventId,
    };
  } catch (error) {
    console.error('[MemoryCapture] Error:', error);
    return {
      saved: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Audit Logger Node
 * Logs execution to audit trail
 */
export const auditLoggerExecutor: NodeExecutor = async (inputs, context) => {
  const response = inputs[0]?.response || inputs[0] || '';

  try {
    audit({
      level: 'info',
      category: 'system',
      event: 'node_graph_execution',
      details: {
        response,
        cognitiveMode: context.cognitiveMode,
        sessionId: context.sessionId,
      },
      userId: context.userId,
    });

    return {
      logged: true,
    };
  } catch (error) {
    console.error('[AuditLogger] Error:', error);
    return {
      logged: false,
      error: (error as Error).message,
    };
  }

};

/**
 * Stream Writer Node
 * Outputs response (terminal node)
 */
export const streamWriterExecutor: NodeExecutor = async (inputs, context) => {
  const response = inputs[0]?.response || inputs[0] || '';

  if (!response || response.trim().length === 0) {
    return {
      output: '',
      completed: false,
    };
  }

  console.log('[StreamWriter]', response);

  return {
    output: response,
    completed: true,
  };
};

// ============================================================================
// Executor Registry
// ============================================================================

export const nodeExecutors: Record<string, NodeExecutor> = {
  // Input nodes
  'user_input': userInputExecutor,
  'session_context': sessionContextExecutor,
  'system_settings': systemSettingsExecutor,

  // Router nodes
  'cognitive_mode_router': cognitiveModeRouterExecutor,
  'operator_eligibility': operatorEligibilityExecutor,
  'auth_check': authCheckExecutor,

  // Context nodes
  'semantic_search': semanticSearchExecutor,
  'conversation_history': conversationHistoryExecutor,
  'context_builder': contextBuilderExecutor,

  // Operator nodes
  'react_planner': reactPlannerExecutor,
  'skill_executor': skillExecutorExecutor,
  'observation_formatter': observationFormatterExecutor,
  'completion_checker': completionCheckerExecutor,
  'response_synthesizer': responseSynthesizerExecutor,

  // Chat nodes
  'persona_llm': personaLLMExecutor,
  'chain_of_thought_stripper': chainOfThoughtStripperExecutor,
  'cot_stripper': chainOfThoughtStripperExecutor, // Alias for chain_of_thought_stripper
  'safety_validator': safetyValidatorExecutor,
  'response_refiner': responseRefinerExecutor,

  // Model nodes
  'model_resolver': modelResolverExecutor,
  'model_router': modelRouterExecutor,

  // Output nodes
  'memory_capture': memoryCaptureExecutor,
  'audit_logger': auditLoggerExecutor,
  'stream_writer': streamWriterExecutor,

  // Skill nodes (dynamically created)
  'skill_conversational_response': createSkillExecutor('conversational_response'),
  'skill_fs_read': createSkillExecutor('fs_read'),
  'skill_fs_write': createSkillExecutor('fs_write'),
  'skill_fs_list': createSkillExecutor('fs_list'),
  'skill_task_list': createSkillExecutor('task_list'),
  'skill_task_create': createSkillExecutor('task_create'),
  'skill_task_update': createSkillExecutor('task_update'),
  'skill_search_index': createSkillExecutor('search_index'),
  'skill_memory_search': createSkillExecutor('memory_search'),
};

/**
 * Get executor for a node type
 */
export function getNodeExecutor(nodeType: string): NodeExecutor | null {
  // Remove 'cognitive/' prefix if present
  const cleanType = nodeType.replace('cognitive/', '');
  return nodeExecutors[cleanType] || null;
}

/**
 * Check if a node type has a real implementation
 */
export function hasRealImplementation(nodeType: string): boolean {
  return getNodeExecutor(nodeType) !== null;
}

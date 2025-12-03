/**
 * Browser-safe Node Schemas Export
 *
 * This file exports only the schema data (no executors, no Node.js dependencies)
 * for use by the frontend visual editor.
 *
 * Usage: import { nodeSchemas, getNodeSchema } from '@metahuman/core/nodes/schemas'
 */

import type { NodeCategory, PropertySchema, SlotType } from './types.js';

// Re-export types for convenience
export type { NodeCategory, PropertySchema, SlotType } from './types.js';

export interface NodeSchema {
  id: string;
  name: string;
  category: NodeCategory;
  color: string;
  bgColor: string;
  inputs: { name: string; type: SlotType; optional?: boolean; description?: string }[];
  outputs: { name: string; type: SlotType; optional?: boolean; description?: string }[];
  properties?: Record<string, any>;
  propertySchemas?: Record<string, PropertySchema>;
  description: string;
  size?: [number, number];
}

// Category colors (same as types.ts)
export const categoryColors: Record<NodeCategory, { color: string; bgColor: string }> = {
  input: { color: '#4ade80', bgColor: '#166534' },
  router: { color: '#fbbf24', bgColor: '#92400e' },
  context: { color: '#60a5fa', bgColor: '#1e3a8a' },
  operator: { color: '#a78bfa', bgColor: '#5b21b6' },
  chat: { color: '#f472b6', bgColor: '#9f1239' },
  model: { color: '#fb923c', bgColor: '#9a3412' },
  skill: { color: '#34d399', bgColor: '#065f46' },
  output: { color: '#ef4444', bgColor: '#991b1b' },
  control_flow: { color: '#818cf8', bgColor: '#4338ca' },
  memory: { color: '#c084fc', bgColor: '#7e22ce' },
  utility: { color: '#94a3b8', bgColor: '#475569' },
  agent: { color: '#22d3ee', bgColor: '#155e75' },
  config: { color: '#fde047', bgColor: '#854d0e' },
  persona: { color: '#e879f9', bgColor: '#86198f' },
  thought: { color: '#67e8f9', bgColor: '#0e7490' },
  dreamer: { color: '#d8b4fe', bgColor: '#6b21a8' },
  curiosity: { color: '#fcd34d', bgColor: '#a16207' },
  curator: { color: '#86efac', bgColor: '#14532d' },
  safety: { color: '#fca5a5', bgColor: '#7f1d1d' },
  emulation: { color: '#a5b4fc', bgColor: '#3730a3' },
  agency: { color: '#f59e0b', bgColor: '#78350f' },
};

// Helper to define a schema with category colors
function defineSchema(
  schema: Omit<NodeSchema, 'color' | 'bgColor'> & { color?: string; bgColor?: string }
): NodeSchema {
  const colors = categoryColors[schema.category];
  return {
    ...schema,
    color: schema.color ?? colors.color,
    bgColor: schema.bgColor ?? colors.bgColor,
  };
}

// ============================================================================
// ALL NODE SCHEMAS (no executors, browser-safe)
// ============================================================================

export const nodeSchemas: NodeSchema[] = [
  // INPUT NODES
  defineSchema({
    id: 'mic_input',
    name: 'Mic Input',
    category: 'input',
    inputs: [],
    outputs: [
      { name: 'audioBuffer', type: 'object', description: 'Raw audio buffer from microphone' },
      { name: 'audioFormat', type: 'string', description: 'Audio format (wav/webm/mp3)' },
      { name: 'hasMicInput', type: 'boolean', description: 'Whether mic input is available' },
    ],
    properties: { audioFormat: 'wav' },
    description: 'Captures audio input from microphone for speech recognition',
  }),
  defineSchema({
    id: 'speech_to_text',
    name: 'Speech to Text',
    category: 'input',
    inputs: [
      { name: 'audioBuffer', type: 'object', description: 'Audio buffer to transcribe' },
    ],
    outputs: [
      { name: 'text', type: 'string', description: 'Transcribed text from speech' },
      { name: 'transcribed', type: 'boolean', description: 'Whether transcription succeeded' },
      { name: 'audioFormat', type: 'string', description: 'Audio format used' },
    ],
    properties: { audioFormat: 'wav' },
    description: 'Converts speech audio to text using Whisper STT',
  }),
  defineSchema({
    id: 'text_input',
    name: 'Text Input',
    category: 'input',
    inputs: [],
    outputs: [
      { name: 'text', type: 'string', description: 'Text from chat interface input' },
      { name: 'hasTextInput', type: 'boolean', description: 'Whether text input is available' },
    ],
    properties: { placeholder: 'Enter text...' },
    description: 'Gateway to chat interface text input',
  }),
  defineSchema({
    id: 'user_input',
    name: 'User Input',
    category: 'input',
    inputs: [
      { name: 'speech', type: 'object', optional: true, description: 'Transcribed speech input' },
      { name: 'text', type: 'string', optional: true, description: 'Direct text input' },
    ],
    outputs: [
      { name: 'message', type: 'string', description: 'User message' },
      { name: 'inputSource', type: 'string', description: 'Input source: text, speech, or chat' },
      { name: 'sessionId', type: 'string', description: 'Session identifier' },
    ],
    properties: { message: '', prioritizeChatInterface: true },
    description: 'Unified input node for text and speech',
  }),

  // CONTEXT NODES
  defineSchema({
    id: 'session_context',
    name: 'Session Context',
    category: 'context',
    inputs: [{ name: 'sessionId', type: 'string' }],
    outputs: [
      { name: 'conversationHistory', type: 'array', description: 'Recent conversation messages' },
      { name: 'user', type: 'object', description: 'Current user object' },
    ],
    description: 'Loads session and conversation history',
  }),
  defineSchema({
    id: 'system_settings',
    name: 'System Settings',
    category: 'context',
    inputs: [],
    outputs: [
      { name: 'cognitiveMode', type: 'string', description: 'Current cognitive mode' },
      { name: 'trustLevel', type: 'string', description: 'Current trust level' },
      { name: 'settings', type: 'object', description: 'System settings object' },
    ],
    description: 'Provides system configuration',
  }),
  defineSchema({
    id: 'context_builder',
    name: 'Context Builder',
    category: 'context',
    inputs: [
      { name: 'message', type: 'string' },
      { name: 'cognitiveMode', type: 'string' },
      { name: 'conversationHistory', type: 'array', optional: true },
    ],
    outputs: [{ name: 'context', type: 'object', description: 'Complete context package' }],
    properties: { searchDepth: 'normal', maxMemories: 8, maxContextChars: 8000 },
    propertySchemas: {
      searchDepth: { type: 'select', default: 'normal', label: 'Search Depth', options: ['shallow', 'normal', 'deep', 'exhaustive'] },
      maxMemories: { type: 'slider', default: 8, label: 'Max Memories', min: 1, max: 20, step: 1 },
      maxContextChars: { type: 'number', default: 8000, label: 'Max Context Length', min: 1000, max: 32000, step: 1000 },
    },
    size: [280, 200],
    description: 'Builds context package with memories',
  }),
  defineSchema({
    id: 'semantic_search',
    name: 'Semantic Search',
    category: 'context',
    inputs: [
      { name: 'query', type: 'string' },
      { name: 'similarityThreshold', type: 'number', optional: true },
    ],
    outputs: [{ name: 'memories', type: 'array', description: 'Relevant memories' }],
    properties: { similarityThreshold: 0.6, maxResults: 8 },
    propertySchemas: {
      similarityThreshold: { type: 'slider', default: 0.6, label: 'Similarity Threshold', min: 0, max: 1, step: 0.05 },
      maxResults: { type: 'slider', default: 8, label: 'Max Results', min: 1, max: 20, step: 1 },
    },
    size: [260, 160],
    description: 'Searches memories using embeddings',
  }),
  defineSchema({
    id: 'conversation_history',
    name: 'Conversation History',
    category: 'context',
    inputs: [
      { name: 'sessionId', type: 'string' },
      { name: 'mode', type: 'string', optional: true },
    ],
    outputs: [{ name: 'history', type: 'array', description: 'Conversation messages' }],
    properties: { mode: 'conversation', maxMessages: 20 },
    description: 'Loads conversation history',
  }),

  // ROUTING NODES
  defineSchema({
    id: 'cognitive_mode_router',
    name: 'Cognitive Mode Router',
    category: 'router',
    inputs: [
      { name: 'cognitiveMode', type: 'string' },
      { name: 'message', type: 'string' },
    ],
    outputs: [
      { name: 'useDual', type: 'boolean', description: 'Route to operator (dual mode)' },
      { name: 'useAgent', type: 'boolean', description: 'Conditional routing (agent mode)' },
      { name: 'useEmulation', type: 'boolean', description: 'Chat only (emulation mode)' },
    ],
    description: 'Routes based on cognitive mode',
  }),
  defineSchema({
    id: 'auth_check',
    name: 'Authentication Check',
    category: 'router',
    inputs: [{ name: 'user', type: 'object' }],
    outputs: [
      { name: 'isAuthenticated', type: 'boolean' },
      { name: 'role', type: 'string', description: 'User role' },
    ],
    description: 'Checks user authentication status',
  }),
  defineSchema({
    id: 'operator_eligibility',
    name: 'Operator Eligibility',
    category: 'router',
    inputs: [
      { name: 'cognitiveMode', type: 'string' },
      { name: 'isAuthenticated', type: 'boolean' },
      { name: 'message', type: 'string' },
    ],
    outputs: [{ name: 'useOperator', type: 'boolean', description: 'Should use operator pipeline' }],
    description: 'Determines if operator should be used',
  }),
  defineSchema({
    id: 'smart_router',
    name: 'Smart Router',
    category: 'router',
    inputs: [{ name: 'orchestratorAnalysis', type: 'object', description: 'Analysis from orchestrator LLM' }],
    outputs: [
      { name: 'complexPath', type: 'object', description: 'Output for complex queries' },
      { name: 'simplePath', type: 'object', description: 'Output for simple queries' },
    ],
    properties: { routeOnComplexity: true, simpleThreshold: 0.3 },
    description: 'Routes queries based on complexity analysis',
  }),

  // LLM NODES
  defineSchema({
    id: 'persona_llm',
    name: 'Persona LLM',
    category: 'chat',
    inputs: [
      { name: 'personaText', type: 'object', description: 'Formatted persona text' },
      { name: 'conversationHistory', type: 'array', description: 'Chat history' },
      { name: 'memories', type: 'array', optional: true, description: 'Semantic search memories' },
      { name: 'orchestratorData', type: 'object', optional: true, description: 'Instructions from orchestrator' },
    ],
    outputs: [{ name: 'response', type: 'string' }],
    properties: { model: 'fallback', temperature: 0.7 },
    propertySchemas: {
      model: { type: 'string', default: 'fallback', label: 'Model' },
      temperature: { type: 'slider', default: 0.7, label: 'Temperature', min: 0, max: 1, step: 0.1 },
    },
    size: [240, 200],
    description: 'Generates response using persona',
  }),
  defineSchema({
    id: 'orchestrator_llm',
    name: 'Intent Orchestrator',
    category: 'chat',
    inputs: [
      { name: 'message', type: 'string', description: 'User message to analyze' },
      { name: 'conversationHistory', type: 'array', optional: true, description: 'Recent conversation for context awareness' },
      { name: 'systemSettings', type: 'object', optional: true, description: 'System settings for permission context' },
    ],
    outputs: [
      { name: 'needsMemory', type: 'boolean', description: 'Whether memory search is needed' },
      { name: 'memoryTier', type: 'string', description: 'Memory tier to search' },
      { name: 'memoryQuery', type: 'string', description: 'Optimized search query' },
      { name: 'needsAction', type: 'boolean', description: 'Routes to Big Brother when true' },
      { name: 'actionType', type: 'string', description: 'LLM-interpreted action type' },
      { name: 'actionParams', type: 'object', description: 'Parameters for the action' },
      { name: 'complexity', type: 'number', description: 'Task complexity 0-1' },
      { name: 'responseStyle', type: 'string', description: 'Suggested response style' },
      { name: 'responseLength', type: 'string', description: 'brief/medium/detailed' },
      { name: 'isFollowUp', type: 'boolean', description: 'Is follow-up to previous' },
      { name: 'emotionalTone', type: 'string', description: 'Detected emotional context' },
      { name: 'instructions', type: 'string', description: 'Instructions for persona' },
    ],
    properties: { temperature: 0.2 },
    propertySchemas: { temperature: { type: 'slider', default: 0.2, label: 'Temperature', min: 0, max: 1, step: 0.1 } },
    size: [260, 280],
    description: 'Enhanced intent analysis with action detection and conversation awareness (NO HARDCODING - LLM interprets intent)',
  }),
  defineSchema({
    id: 'reflector_llm',
    name: 'Reflector LLM',
    category: 'chat',
    inputs: [{ name: 'prompt', type: 'string', description: 'Reflection prompt' }],
    outputs: [{ name: 'response', type: 'string' }],
    properties: { role: 'persona', temperature: 0.8, systemPrompt: '' },
    description: 'Generates reflections/summaries',
  }),
  defineSchema({
    id: 'model_resolver',
    name: 'Model Resolver',
    category: 'model',
    inputs: [
      { name: 'role', type: 'string', description: 'Model role' },
      { name: 'cognitiveMode', type: 'string', optional: true },
    ],
    outputs: [{ name: 'modelConfig', type: 'object', description: 'Resolved model configuration' }],
    description: 'Resolves model based on role and mode',
  }),
  defineSchema({
    id: 'model_router',
    name: 'Model Router',
    category: 'model',
    inputs: [
      { name: 'role', type: 'string' },
      { name: 'messages', type: 'array' },
      { name: 'options', type: 'object', optional: true },
    ],
    outputs: [{ name: 'response', type: 'object' }],
    properties: { role: 'persona', temperature: 0.7 },
    description: 'Routes LLM call based on role',
  }),

  // OPERATOR NODES
  defineSchema({
    id: 'react_planner',
    name: 'ReAct Planner',
    category: 'operator',
    inputs: [
      { name: 'goal', type: 'string', description: 'User goal/request' },
      { name: 'context', type: 'object' },
      { name: 'scratchpad', type: 'array', optional: true },
    ],
    outputs: [
      { name: 'thought', type: 'string', description: 'Reasoning about next step' },
      { name: 'action', type: 'object', description: 'Skill to execute' },
    ],
    properties: { model: 'default.coder', temperature: 0.2 },
    propertySchemas: {
      model: { type: 'string', default: 'default.coder', label: 'Model' },
      temperature: { type: 'slider', default: 0.2, label: 'Temperature', min: 0, max: 1, step: 0.1 },
    },
    size: [240, 180],
    description: 'Plans next action in ReAct loop',
  }),
  defineSchema({
    id: 'skill_executor',
    name: 'Skill Executor',
    category: 'operator',
    inputs: [
      { name: 'skillName', type: 'string' },
      { name: 'arguments', type: 'object' },
    ],
    outputs: [
      { name: 'result', type: 'object', description: 'Skill execution result' },
      { name: 'success', type: 'boolean' },
      { name: 'error', type: 'object', optional: true },
    ],
    description: 'Executes a skill with arguments',
  }),
  defineSchema({
    id: 'observation_formatter',
    name: 'Observation Formatter',
    category: 'operator',
    inputs: [
      { name: 'result', type: 'object' },
      { name: 'mode', type: 'string', optional: true },
    ],
    outputs: [{ name: 'observation', type: 'string', description: 'Formatted observation text' }],
    properties: { mode: 'narrative' },
    propertySchemas: { mode: { type: 'select', default: 'narrative', label: 'Format Mode', options: ['narrative', 'structured', 'verbatim'] } },
    size: [240, 140],
    description: 'Formats skill results for LLM',
  }),
  defineSchema({
    id: 'completion_checker',
    name: 'Completion Checker',
    category: 'operator',
    inputs: [
      { name: 'goal', type: 'string' },
      { name: 'scratchpad', type: 'array' },
    ],
    outputs: [
      { name: 'isComplete', type: 'boolean' },
      { name: 'reason', type: 'string', optional: true },
    ],
    description: 'Checks if goal is achieved',
  }),
  defineSchema({
    id: 'response_synthesizer',
    name: 'Response Synthesizer',
    category: 'operator',
    inputs: [
      { name: 'goal', type: 'string' },
      { name: 'scratchpad', type: 'array' },
      { name: 'context', type: 'object' },
    ],
    outputs: [{ name: 'response', type: 'string', description: 'Final natural language response' }],
    properties: { model: 'persona', style: 'default' },
    propertySchemas: {
      model: { type: 'string', default: 'persona', label: 'Model' },
      style: { type: 'select', default: 'default', label: 'Response Style', options: ['default', 'strict', 'summary'] },
    },
    size: [260, 180],
    description: 'Synthesizes final response from scratchpad',
  }),
  defineSchema({
    id: 'iteration_counter',
    name: 'Iteration Counter',
    category: 'operator',
    inputs: [
      { name: 'scratchpad', type: 'object', description: 'Initial scratchpad' },
      { name: 'loopBack', type: 'object', optional: true, description: 'Loop-back data' },
    ],
    outputs: [{ name: 'iterationData', type: 'object', description: 'Object with iteration, maxIterations, scratchpad' }],
    properties: { maxIterations: 10 },
    description: 'Tracks iteration count in ReAct loop',
  }),
  defineSchema({
    id: 'scratchpad_completion_checker',
    name: 'Completion Checker',
    category: 'operator',
    inputs: [{ name: 'scratchpad', type: 'object', description: 'Scratchpad with iteration data' }],
    outputs: [{ name: 'result', type: 'object', description: 'Object with isComplete, reason, scratchpad' }],
    description: 'Checks if ReAct task is complete',
  }),
  defineSchema({
    id: 'scratchpad_formatter',
    name: 'Scratchpad Formatter',
    category: 'operator',
    inputs: [{ name: 'scratchpad', type: 'object', description: 'Scratchpad to format' }],
    outputs: [{ name: 'formatted', type: 'string', description: 'Formatted scratchpad text' }],
    properties: { format: 'text' },
    description: 'Formats scratchpad for display',
  }),
  defineSchema({
    id: 'plan_parser',
    name: 'Plan Parser',
    category: 'operator',
    inputs: [{ name: 'plan', type: 'string', description: 'ReAct-style planning text' }],
    outputs: [
      { name: 'thought', type: 'string' },
      { name: 'action', type: 'string' },
      { name: 'actionInput', type: 'string' },
      { name: 'respond', type: 'string', description: 'Final answer if present' },
      { name: 'parsed', type: 'boolean' },
    ],
    properties: { format: 'react' },
    description: 'Parses ReAct-style planning output',
  }),
  defineSchema({
    id: 'scratchpad_manager',
    name: 'Scratchpad Manager',
    category: 'operator',
    inputs: [{ name: 'step', type: 'object', optional: true, description: 'Step to append' }],
    outputs: [
      { name: 'scratchpad', type: 'array', description: 'Current scratchpad state' },
      { name: 'stepCount', type: 'number' },
    ],
    properties: { operation: 'append', maxSteps: 10 },
    description: 'Manages ReAct scratchpad state',
  }),
  defineSchema({
    id: 'error_recovery',
    name: 'Error Recovery',
    category: 'operator',
    inputs: [
      { name: 'error', type: 'string' },
      { name: 'skillId', type: 'string', optional: true },
    ],
    outputs: [
      { name: 'errorType', type: 'string', description: 'Categorized error type' },
      { name: 'suggestions', type: 'array', description: 'Recovery suggestions' },
      { name: 'shouldRetry', type: 'boolean' },
    ],
    properties: { maxRetries: 3 },
    description: 'Provides smart retry suggestions',
  }),
  defineSchema({
    id: 'stuck_detector',
    name: 'Stuck Detector',
    category: 'operator',
    inputs: [{ name: 'scratchpad', type: 'array' }],
    outputs: [
      { name: 'isStuck', type: 'boolean' },
      { name: 'consecutiveFailures', type: 'number' },
      { name: 'diagnosis', type: 'string' },
      { name: 'suggestion', type: 'string' },
    ],
    properties: { threshold: 3 },
    description: 'Detects failure loops',
  }),
  defineSchema({
    id: 'big_brother',
    name: 'Big Brother',
    category: 'operator',
    inputs: [
      { name: 'goal', type: 'string', description: 'The goal the operator is trying to achieve' },
      { name: 'scratchpad', type: 'array', description: 'Full scratchpad' },
      { name: 'errorType', type: 'string', optional: true },
      { name: 'context', type: 'object', optional: true },
    ],
    outputs: [
      { name: 'suggestions', type: 'array', description: 'Recovery suggestions' },
      { name: 'reasoning', type: 'string', description: 'Root cause analysis' },
      { name: 'alternativeApproach', type: 'string', description: 'Alternative strategy' },
      { name: 'success', type: 'boolean' },
    ],
    properties: { provider: 'claude-code', maxRetries: 1, autoApplySuggestions: false },
    description: 'Escalates stuck states to Claude CLI',
  }),
  defineSchema({
    id: 'big_brother_executor',
    name: 'Big Brother Executor',
    category: 'operator',
    inputs: [
      { name: 'skillName', type: 'string', description: 'Skill to execute' },
      { name: 'arguments', type: 'object', description: 'Skill arguments' },
    ],
    outputs: [
      { name: 'result', type: 'object', description: 'Skill execution result' },
      { name: 'success', type: 'boolean' },
      { name: 'error', type: 'object', optional: true },
    ],
    properties: { timeout: 60000, autoStartSession: true },
    description: 'Executes skills via Claude CLI',
  }),
  defineSchema({
    id: 'claude_full_task',
    name: 'Claude Full Task',
    category: 'operator',
    inputs: [
      { name: 'orchestratorAnalysis', type: 'object', optional: true },
      { name: 'userMessage', type: 'string', description: 'User request' },
      { name: 'contextPackage', type: 'object', optional: true },
    ],
    outputs: [{ name: 'result', type: 'object', description: 'Execution result' }],
    properties: { timeout: 120000 },
    description: 'Delegates entire task to Claude Code',
  }),

  // SAFETY NODES
  defineSchema({
    id: 'cot_stripper',
    name: 'Chain-of-Thought Stripper',
    category: 'safety',
    inputs: [{ name: 'response', type: 'string' }],
    outputs: [
      { name: 'cleaned', type: 'string', description: 'Response with <think> blocks removed' },
      { name: 'response', type: 'string', description: 'Alias for cleaned output', optional: true },
    ],
    description: 'Removes internal reasoning blocks',
  }),
  defineSchema({
    id: 'safety_validator',
    name: 'Safety Validator',
    category: 'safety',
    inputs: [{ name: 'response', type: 'string' }],
    outputs: [
      { name: 'response', type: 'string' },
      { name: 'isSafe', type: 'boolean' },
      { name: 'issues', type: 'array', optional: true },
      { name: 'safetyResult', type: 'object', optional: true },
    ],
    properties: { threshold: 0.7 },
    description: 'Validates response safety',
  }),
  defineSchema({
    id: 'response_refiner',
    name: 'Response Refiner',
    category: 'safety',
    inputs: [
      { name: 'response', type: 'string' },
      { name: 'safetyResult', type: 'object', optional: true },
    ],
    outputs: [
      { name: 'response', type: 'string' },
      { name: 'refined', type: 'boolean', optional: true },
    ],
    description: 'Refines response to address safety issues',
  }),

  // OUTPUT NODES
  defineSchema({
    id: 'memory_capture',
    name: 'Memory Capture',
    category: 'output',
    inputs: [
      { name: 'userMessage', type: 'string' },
      { name: 'assistantResponse', type: 'string' },
      { name: 'cognitiveMode', type: 'string' },
      { name: 'metadata', type: 'object', optional: true },
    ],
    outputs: [{ name: 'eventPath', type: 'string', description: 'Path to saved event file' }],
    description: 'Saves conversation to episodic memory',
  }),
  defineSchema({
    id: 'inner_dialogue_capture',
    name: 'Inner Dialogue Capture',
    category: 'output',
    inputs: [
      { name: 'text', type: 'string', description: 'Reflection or thought text' },
      { name: 'metadata', type: 'object', optional: true },
    ],
    outputs: [{ name: 'result', type: 'object', description: 'Save result with path' }],
    properties: { tags: ['idle-thought', 'self-reflection', 'inner'] },
    description: 'Saves inner dialogue to episodic memory',
  }),
  defineSchema({
    id: 'audit_logger',
    name: 'Audit Logger',
    category: 'output',
    inputs: [
      { name: 'eventType', type: 'string' },
      { name: 'details', type: 'object' },
    ],
    outputs: [{ name: 'logged', type: 'boolean' }],
    description: 'Logs to audit trail',
  }),
  defineSchema({
    id: 'stream_writer',
    name: 'Stream Writer',
    category: 'output',
    inputs: [{ name: 'response', type: 'string' }],
    outputs: [{ name: 'output', type: 'string', description: 'Output text' }],
    description: 'Streams response to client',
  }),
  defineSchema({
    id: 'chat_view',
    name: 'Chat View',
    category: 'output',
    inputs: [
      { name: 'message', type: 'string', optional: true },
      { name: 'trigger', type: 'any', optional: true },
    ],
    outputs: [],
    properties: { mode: 'direct', maxMessages: 5 },
    description: 'Displays chat messages visually',
  }),
  defineSchema({
    id: 'tts',
    name: 'Text to Speech',
    category: 'output',
    inputs: [{ name: 'text', type: 'string', description: 'Text to speak' }],
    outputs: [],
    properties: { provider: '', autoPlay: true },
    description: 'Converts text to speech',
  }),

  // SKILL NODES
  defineSchema({
    id: 'skill_fs_read',
    name: 'Read File',
    category: 'skill',
    inputs: [{ name: 'filePath', type: 'string' }],
    outputs: [
      { name: 'content', type: 'string' },
      { name: 'success', type: 'boolean' },
    ],
    description: 'Reads file contents',
  }),
  defineSchema({
    id: 'skill_fs_write',
    name: 'Write File',
    category: 'skill',
    inputs: [
      { name: 'filePath', type: 'string' },
      { name: 'content', type: 'string' },
    ],
    outputs: [{ name: 'success', type: 'boolean' }],
    description: 'Writes file contents',
  }),
  defineSchema({
    id: 'skill_fs_list',
    name: 'List Files',
    category: 'skill',
    inputs: [{ name: 'directory', type: 'string' }],
    outputs: [{ name: 'files', type: 'array' }],
    description: 'Lists directory contents',
  }),
  defineSchema({
    id: 'skill_task_create',
    name: 'Create Task',
    category: 'skill',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string', optional: true },
    ],
    outputs: [{ name: 'taskId', type: 'string' }],
    description: 'Creates a new task',
  }),
  defineSchema({
    id: 'skill_task_list',
    name: 'List Tasks',
    category: 'skill',
    inputs: [],
    outputs: [{ name: 'tasks', type: 'array' }],
    description: 'Lists active tasks',
  }),
  defineSchema({
    id: 'skill_task_update',
    name: 'Update Task',
    category: 'skill',
    inputs: [
      { name: 'taskId', type: 'string' },
      { name: 'status', type: 'string' },
    ],
    outputs: [{ name: 'success', type: 'boolean' }],
    description: 'Updates task status',
  }),
  defineSchema({
    id: 'skill_search_index',
    name: 'Search Index',
    category: 'skill',
    inputs: [
      { name: 'query', type: 'string' },
      { name: 'maxResults', type: 'number', optional: true },
    ],
    outputs: [{ name: 'results', type: 'array' }],
    description: 'Semantic memory search',
  }),
  defineSchema({
    id: 'skill_web_search',
    name: 'Web Search',
    category: 'skill',
    inputs: [{ name: 'query', type: 'string' }],
    outputs: [{ name: 'results', type: 'array' }],
    description: 'Searches the web',
  }),
  defineSchema({
    id: 'skill_conversational_response',
    name: 'Conversational Response',
    category: 'skill',
    inputs: [
      { name: 'message', type: 'string' },
      { name: 'context', type: 'object', optional: true },
      { name: 'style', type: 'string', optional: true },
    ],
    outputs: [{ name: 'response', type: 'string' }],
    properties: { style: 'default' },
    propertySchemas: { style: { type: 'select', default: 'default', label: 'Response Style', options: ['default', 'strict', 'summary'] } },
    size: [260, 160],
    description: 'Generates conversational response',
  }),

  // CONTROL FLOW NODES
  defineSchema({
    id: 'loop_controller',
    name: 'Loop Controller',
    category: 'control_flow',
    inputs: [{ name: 'input', type: 'any' }],
    outputs: [
      { name: 'iterations', type: 'array', description: 'Array of iteration results' },
      { name: 'finalOutput', type: 'any', description: 'Final output after loop completes' },
      { name: 'completed', type: 'boolean' },
    ],
    properties: { maxIterations: 10, completionCheck: 'completed' },
    description: 'Iterative execution with max iterations',
  }),
  defineSchema({
    id: 'conditional_branch',
    name: 'Conditional Branch',
    category: 'control_flow',
    inputs: [{ name: 'input', type: 'any' }],
    outputs: [
      { name: 'conditionMet', type: 'boolean' },
      { name: 'trueOutput', type: 'any' },
      { name: 'falseOutput', type: 'any' },
    ],
    properties: { condition: 'value', operator: '==', compareValue: null },
    description: 'Routes execution based on a condition',
  }),
  defineSchema({
    id: 'conditional_router',
    name: 'Conditional Router',
    category: 'control_flow',
    inputs: [
      { name: 'condition', type: 'any', description: 'Condition data' },
      { name: 'trueData', type: 'any', description: 'Data if condition is true' },
      { name: 'falseData', type: 'any', description: 'Data if condition is false' },
    ],
    outputs: [
      { name: 'exitOutput', type: 'any', description: 'Output when condition is true' },
      { name: 'loopOutput', type: 'any', description: 'Output when condition is false' },
    ],
    properties: { conditionField: 'isComplete' },
    description: 'Routes data based on condition for loop control',
  }),
  defineSchema({
    id: 'switch',
    name: 'Switch',
    category: 'control_flow',
    inputs: [{ name: 'input', type: 'any' }],
    outputs: [
      { name: 'switchValue', type: 'any' },
      { name: 'matchedCase', type: 'string' },
      { name: 'output', type: 'any' },
    ],
    properties: { switchField: 'mode', cases: {}, defaultCase: 'default' },
    description: 'Multi-way routing based on a value',
  }),
  defineSchema({
    id: 'for_each',
    name: 'For Each',
    category: 'control_flow',
    inputs: [{ name: 'input', type: 'object' }],
    outputs: [
      { name: 'results', type: 'array' },
      { name: 'count', type: 'number' },
    ],
    properties: { arrayField: 'items' },
    description: 'Iterates over an array',
  }),

  // UTILITY NODES
  defineSchema({
    id: 'json_parser',
    name: 'JSON Parser',
    category: 'utility',
    inputs: [{ name: 'text', type: 'string', description: 'Text containing JSON' }],
    outputs: [
      { name: 'data', type: 'object', description: 'Parsed JSON object' },
      { name: 'success', type: 'boolean' },
    ],
    properties: { fallback: null },
    description: 'Extracts JSON from text',
  }),
  defineSchema({
    id: 'text_template',
    name: 'Text Template',
    category: 'utility',
    inputs: [{ name: 'variables', type: 'object', description: 'Variables for interpolation' }],
    outputs: [{ name: 'text', type: 'string', description: 'Interpolated text' }],
    properties: { template: '' },
    description: 'String interpolation with {{variable}} substitution',
  }),
  defineSchema({
    id: 'data_transform',
    name: 'Data Transform',
    category: 'utility',
    inputs: [{ name: 'data', type: 'array' }],
    outputs: [
      { name: 'result', type: 'any', description: 'Transformed data' },
      { name: 'count', type: 'number' },
    ],
    properties: { operation: 'map', field: null, condition: null, reduceOperation: 'count' },
    description: 'Map/filter/reduce operations on arrays',
  }),
  defineSchema({
    id: 'cache',
    name: 'Cache',
    category: 'utility',
    inputs: [{ name: 'value', type: 'any' }],
    outputs: [
      { name: 'value', type: 'any' },
      { name: 'hit', type: 'boolean', description: 'Whether cache was hit' },
    ],
    properties: { key: 'default', ttl: 60000, operation: 'get' },
    propertySchemas: {
      key: { type: 'string', default: 'default', label: 'Cache Key' },
      ttl: { type: 'number', default: 60000, label: 'TTL (ms)', min: 1000, max: 3600000, step: 1000 },
      operation: { type: 'select', default: 'get', label: 'Operation', options: ['get', 'set', 'clear', 'clear_all'] },
    },
    size: [240, 200],
    description: 'Stores intermediate results with TTL',
  }),

  // AGENT NODES
  defineSchema({
    id: 'memory_loader',
    name: 'Memory Loader',
    category: 'agent',
    inputs: [],
    outputs: [
      { name: 'memories', type: 'array', description: 'Loaded memory objects' },
      { name: 'count', type: 'number' },
      { name: 'hasMore', type: 'boolean' },
    ],
    properties: { limit: 10, onlyUnprocessed: true },
    description: 'Loads episodic memories from disk',
  }),
  defineSchema({
    id: 'memory_saver',
    name: 'Memory Saver',
    category: 'agent',
    inputs: [{ name: 'memory', type: 'object', description: 'Memory object to save' }],
    outputs: [
      { name: 'success', type: 'boolean' },
      { name: 'path', type: 'string' },
      { name: 'error', type: 'string', optional: true },
    ],
    properties: { updateOnly: true },
    description: 'Saves enriched memory data',
  }),
  defineSchema({
    id: 'llm_enricher',
    name: 'LLM Enricher',
    category: 'agent',
    inputs: [{ name: 'memory', type: 'object', description: 'Memory to enrich' }],
    outputs: [
      { name: 'memory', type: 'object', description: 'Enriched memory with tags and entities' },
      { name: 'success', type: 'boolean' },
      { name: 'error', type: 'string', optional: true },
    ],
    description: 'Uses LLM to extract tags and entities',
  }),
  defineSchema({
    id: 'agent_timer',
    name: 'Agent Timer',
    category: 'agent',
    inputs: [],
    outputs: [
      { name: 'currentTime', type: 'number' },
      { name: 'interval', type: 'number' },
      { name: 'nextRun', type: 'number' },
    ],
    properties: { intervalMs: 60000 },
    description: 'Provides timing for scheduled agent execution',
  }),

  // PERSONA NODES
  defineSchema({
    id: 'persona_loader',
    name: 'Persona Loader',
    category: 'persona',
    inputs: [],
    outputs: [
      { name: 'persona', type: 'object' },
      { name: 'identity', type: 'object' },
      { name: 'values', type: 'object' },
      { name: 'goals', type: 'object' },
      { name: 'success', type: 'boolean' },
    ],
    description: 'Loads persona core configuration',
  }),
  defineSchema({
    id: 'persona_formatter',
    name: 'Persona Formatter',
    category: 'persona',
    inputs: [{ name: 'personaData', type: 'object' }],
    outputs: [{ name: 'formatted', type: 'object', description: 'Formatted persona text' }],
    properties: { includePersonality: true, includeValues: true, includeGoals: true },
    description: 'Formats persona data into system prompt text',
  }),
  defineSchema({
    id: 'persona_saver',
    name: 'Persona Saver',
    category: 'persona',
    inputs: [{ name: 'persona', type: 'object' }],
    outputs: [
      { name: 'success', type: 'boolean' },
      { name: 'timestamp', type: 'string' },
    ],
    description: 'Saves persona core configuration',
  }),
  defineSchema({
    id: 'trust_level_reader',
    name: 'Trust Level Reader',
    category: 'persona',
    inputs: [],
    outputs: [
      { name: 'trustLevel', type: 'string' },
      { name: 'availableModes', type: 'array' },
      { name: 'description', type: 'string' },
      { name: 'success', type: 'boolean' },
    ],
    description: 'Reads current trust level',
  }),
  defineSchema({
    id: 'trust_level_writer',
    name: 'Trust Level Writer',
    category: 'persona',
    inputs: [{ name: 'trustLevel', type: 'string' }],
    outputs: [
      { name: 'success', type: 'boolean' },
      { name: 'trustLevel', type: 'string' },
      { name: 'timestamp', type: 'string' },
    ],
    description: 'Sets trust level',
  }),
  defineSchema({
    id: 'decision_rules_loader',
    name: 'Decision Rules Loader',
    category: 'persona',
    inputs: [],
    outputs: [
      { name: 'rules', type: 'object' },
      { name: 'trustLevel', type: 'string' },
      { name: 'hardRules', type: 'array' },
      { name: 'softPreferences', type: 'array' },
      { name: 'success', type: 'boolean' },
    ],
    description: 'Loads decision rules configuration',
  }),
  defineSchema({
    id: 'decision_rules_saver',
    name: 'Decision Rules Saver',
    category: 'persona',
    inputs: [{ name: 'rules', type: 'object' }],
    outputs: [
      { name: 'success', type: 'boolean' },
      { name: 'timestamp', type: 'string' },
    ],
    description: 'Saves decision rules configuration',
  }),
  defineSchema({
    id: 'identity_extractor',
    name: 'Identity Extractor',
    category: 'persona',
    inputs: [{ name: 'persona', type: 'object', optional: true }],
    outputs: [
      { name: 'value', type: 'any', description: 'Extracted field value' },
      { name: 'success', type: 'boolean' },
    ],
    properties: { field: 'all' },
    description: 'Extracts specific identity fields',
  }),
  defineSchema({
    id: 'value_manager',
    name: 'Value Manager',
    category: 'persona',
    inputs: [{ name: 'valueData', type: 'object', optional: true }],
    outputs: [
      { name: 'values', type: 'array' },
      { name: 'success', type: 'boolean' },
    ],
    properties: { operation: 'get' },
    description: 'Manages core values (CRUD operations)',
  }),
  defineSchema({
    id: 'goal_manager',
    name: 'Goal Manager',
    category: 'persona',
    inputs: [{ name: 'goalData', type: 'object', optional: true }],
    outputs: [
      { name: 'goals', type: 'array' },
      { name: 'success', type: 'boolean' },
    ],
    properties: { operation: 'get', scope: 'shortTerm' },
    description: 'Manages goals (CRUD operations)',
  }),

  // THOUGHT NODES
  defineSchema({
    id: 'thought_generator',
    name: 'Thought Generator',
    category: 'thought',
    inputs: [
      { name: 'context', type: 'object' },
      { name: 'seedMemory', type: 'string', optional: true },
    ],
    outputs: [{ name: 'result', type: 'object', description: 'Generated thought with keywords and confidence' }],
    properties: { temperature: 0.75, extractKeywords: true },
    description: 'Generates a single reasoning step',
  }),
  defineSchema({
    id: 'thought_evaluator',
    name: 'Thought Evaluator',
    category: 'thought',
    inputs: [
      { name: 'thought', type: 'object' },
      { name: 'iteration', type: 'object', optional: true },
      { name: 'history', type: 'object', optional: true },
    ],
    outputs: [{ name: 'evaluation', type: 'object', description: 'Evaluation result' }],
    properties: { minConfidence: 0.4, maxIterations: 7, repetitionThreshold: 0.8 },
    description: 'Decides if thought chain should continue',
  }),
  defineSchema({
    id: 'thought_aggregator',
    name: 'Thought Aggregator',
    category: 'thought',
    inputs: [{ name: 'scratchpad', type: 'object' }],
    outputs: [{ name: 'result', type: 'object', description: 'Consolidated chain, insight, summary' }],
    properties: { summaryStyle: 'narrative', maxLength: 200 },
    description: 'Combines all thoughts into a coherent chain',
  }),
  defineSchema({
    id: 'agent_trigger',
    name: 'Agent Trigger',
    category: 'thought',
    inputs: [{ name: 'inputData', type: 'object' }],
    outputs: [{ name: 'result', type: 'object' }],
    properties: { agentName: '', waitForCompletion: true, timeout: 30000 },
    description: 'Triggers another agent from within a graph',
  }),
  defineSchema({
    id: 'loop_memory_search',
    name: 'Loop Memory Search',
    category: 'thought',
    inputs: [
      { name: 'searchTerms', type: 'array' },
      { name: 'seenIds', type: 'array', optional: true },
    ],
    outputs: [{ name: 'result', type: 'object', description: 'Found memories, memoryIds, searchTermsUsed' }],
    properties: { maxResults: 3, excludeSeen: true },
    description: 'Searches for memories, avoiding already-seen ones',
  }),

  // DREAMER NODES
  defineSchema({
    id: 'dreamer_memory_curator',
    name: 'Curate Dream Memories',
    category: 'dreamer',
    inputs: [],
    outputs: [
      { name: 'memories', type: 'array' },
      { name: 'count', type: 'number' },
      { name: 'avgAgeDays', type: 'number' },
      { name: 'oldestAgeDays', type: 'number' },
      { name: 'username', type: 'string' },
    ],
    properties: { sampleSize: 15, decayDays: 227 },
    description: 'Curates weighted sample of memories for dreams',
  }),
  defineSchema({
    id: 'dreamer_dream_generator',
    name: 'Generate Dream',
    category: 'dreamer',
    inputs: [
      { name: 'memories', type: 'array' },
      { name: 'personaPrompt', type: 'string', optional: true },
    ],
    outputs: [
      { name: 'dream', type: 'string' },
      { name: 'memoryCount', type: 'number' },
      { name: 'sourceIds', type: 'array' },
      { name: 'username', type: 'string' },
    ],
    properties: { temperature: 1.0, role: 'persona' },
    description: 'Generates surreal dream narratives',
  }),
  defineSchema({
    id: 'dreamer_dream_saver',
    name: 'Save Dream',
    category: 'dreamer',
    inputs: [
      { name: 'dreamData', type: 'object' },
      { name: 'memoriesData', type: 'object', optional: true },
    ],
    outputs: [
      { name: 'saved', type: 'boolean' },
      { name: 'eventId', type: 'string' },
      { name: 'dream', type: 'string' },
      { name: 'sourceCount', type: 'number' },
      { name: 'username', type: 'string' },
    ],
    properties: { type: 'dream' },
    description: 'Saves generated dream to episodic memory',
  }),
  defineSchema({
    id: 'dreamer_continuation_generator',
    name: 'Generate Continuation Dreams',
    category: 'dreamer',
    inputs: [{ name: 'previousDream', type: 'object' }],
    outputs: [
      { name: 'dreams', type: 'array' },
      { name: 'count', type: 'number' },
      { name: 'username', type: 'string' },
    ],
    properties: { temperature: 1.0, continuationChance: 0.75, maxContinuations: 4, delaySeconds: 60 },
    description: 'Generates continuation dreams',
  }),
  defineSchema({
    id: 'dreamer_learnings_extractor',
    name: 'Extract Learnings',
    category: 'dreamer',
    inputs: [{ name: 'memoriesData', type: 'object' }],
    outputs: [
      { name: 'preferences', type: 'array' },
      { name: 'heuristics', type: 'array' },
      { name: 'styleNotes', type: 'array' },
      { name: 'avoidances', type: 'array' },
      { name: 'memoryCount', type: 'number' },
      { name: 'username', type: 'string' },
    ],
    properties: { temperature: 0.3, role: 'persona' },
    description: 'Extracts learnings from memories',
  }),
  defineSchema({
    id: 'dreamer_learnings_writer',
    name: 'Write Overnight Learnings',
    category: 'dreamer',
    inputs: [
      { name: 'learningsData', type: 'object' },
      { name: 'memoriesData', type: 'object', optional: true },
    ],
    outputs: [
      { name: 'written', type: 'boolean' },
      { name: 'filepath', type: 'string' },
      { name: 'filename', type: 'string' },
      { name: 'date', type: 'string' },
      { name: 'username', type: 'string' },
    ],
    description: 'Writes overnight learnings to procedural memory',
  }),

  // CURIOSITY NODES
  defineSchema({
    id: 'curiosity_weighted_sampler',
    name: 'Curiosity Weighted Sampler',
    category: 'curiosity',
    inputs: [],
    outputs: [
      { name: 'memories', type: 'array' },
      { name: 'count', type: 'number' },
      { name: 'username', type: 'string' },
      { name: 'decayFactor', type: 'number' },
    ],
    properties: { sampleSize: 5, decayFactor: 14 },
    description: 'Samples memories with exponential decay',
  }),
  defineSchema({
    id: 'curiosity_question_generator',
    name: 'Curiosity Question Generator',
    category: 'curiosity',
    inputs: [{ name: 'memories', type: 'array' }],
    outputs: [
      { name: 'question', type: 'string' },
      { name: 'rawQuestion', type: 'string' },
      { name: 'username', type: 'string' },
      { name: 'memoriesConsidered', type: 'number' },
    ],
    properties: { temperature: 0.6 },
    description: 'Generates natural curiosity questions',
  }),
  defineSchema({
    id: 'curiosity_question_saver',
    name: 'Curiosity Question Saver',
    category: 'curiosity',
    inputs: [
      { name: 'question', type: 'string' },
      { name: 'memories', type: 'array', optional: true },
    ],
    outputs: [
      { name: 'questionId', type: 'string' },
      { name: 'saved', type: 'boolean' },
      { name: 'username', type: 'string' },
      { name: 'askedAt', type: 'string' },
    ],
    description: 'Saves question to audit log',
  }),
  defineSchema({
    id: 'curiosity_activity_check',
    name: 'Curiosity Activity Check',
    category: 'curiosity',
    inputs: [],
    outputs: [
      { name: 'canAsk', type: 'boolean' },
      { name: 'timeSinceLastQuestion', type: 'number', optional: true },
      { name: 'questionInterval', type: 'number' },
      { name: 'username', type: 'string' },
    ],
    properties: { questionIntervalSeconds: 1800 },
    description: 'Checks if enough time has passed since last question',
  }),

  // CURATOR NODES
  defineSchema({
    id: 'uncurated_memory_loader',
    name: 'Load Uncurated Memories',
    category: 'curator',
    inputs: [],
    outputs: [{ name: 'memories', type: 'array', description: 'Uncurated episodic memories' }],
    properties: { limit: 5 },
    description: 'Loads uncurated episodic memories',
  }),
  defineSchema({
    id: 'persona_summary_loader',
    name: 'Load Persona Context',
    category: 'curator',
    inputs: [],
    outputs: [{ name: 'personaSummary', type: 'string', description: 'Persona identity summary' }],
    description: 'Loads persona identity summary',
  }),
  defineSchema({
    id: 'curator_llm',
    name: 'Curate Memories (LLM)',
    category: 'curator',
    inputs: [
      { name: 'memories', type: 'array' },
      { name: 'personaSummary', type: 'string', optional: true },
    ],
    outputs: [{ name: 'curatedMemories', type: 'array', description: 'LLM-curated conversational exchanges' }],
    properties: { temperature: 0.3, timeout: 300000 },
    description: 'Uses LLM to transform memories into training data',
  }),
  defineSchema({
    id: 'curated_memory_saver',
    name: 'Save Curated Memories',
    category: 'curator',
    inputs: [{ name: 'curatedMemories', type: 'array' }],
    outputs: [{ name: 'savedCount', type: 'number' }],
    description: 'Saves curated memories to training data directory',
  }),
  defineSchema({
    id: 'training_pair_generator',
    name: 'Generate Training Pairs',
    category: 'curator',
    inputs: [{ name: 'curatedMemories', type: 'array' }],
    outputs: [{ name: 'trainingPairs', type: 'array', description: 'User/assistant message pairs' }],
    description: 'Converts curated memories into training pairs',
  }),
  defineSchema({
    id: 'training_pair_appender',
    name: 'Append to JSONL',
    category: 'curator',
    inputs: [{ name: 'trainingPairs', type: 'array' }],
    outputs: [{ name: 'appendedCount', type: 'number' }],
    description: 'Appends training pairs to JSONL file',
  }),
  defineSchema({
    id: 'memory_marker',
    name: 'Mark as Curated',
    category: 'curator',
    inputs: [{ name: 'curatedMemories', type: 'array' }],
    outputs: [{ name: 'markedCount', type: 'number' }],
    description: 'Marks memories as curated',
  }),

  // EMULATION NODES
  defineSchema({
    id: 'reply_to_handler',
    name: 'Reply-To Handler',
    category: 'emulation',
    inputs: [
      { name: 'conversationHistory', type: 'array' },
      { name: 'replyToId', type: 'string', optional: true },
    ],
    outputs: [
      { name: 'relevantHistory', type: 'array' },
      { name: 'targetMessage', type: 'object', optional: true },
    ],
    description: 'Handles reply-to threading in conversation',
  }),
  defineSchema({
    id: 'buffer_manager',
    name: 'Buffer Manager',
    category: 'emulation',
    inputs: [
      { name: 'conversationHistory', type: 'array', optional: true },
      { name: 'response', type: 'any', optional: true },
    ],
    outputs: [
      { name: 'persisted', type: 'boolean' },
      { name: 'messageCount', type: 'number' },
      { name: 'bufferPath', type: 'string' },
    ],
    description: 'Persists conversation buffer to disk',
  }),
  defineSchema({
    id: 'scratchpad_initializer',
    name: 'Scratchpad Initializer',
    category: 'emulation',
    inputs: [],
    outputs: [
      { name: 'scratchpad', type: 'array' },
      { name: 'iteration', type: 'number' },
      { name: 'maxIterations', type: 'number' },
      { name: 'isComplete', type: 'boolean' },
    ],
    description: 'Creates or resets the scratchpad for ReAct iteration',
  }),
  defineSchema({
    id: 'scratchpad_updater',
    name: 'Scratchpad Updater',
    category: 'emulation',
    inputs: [
      { name: 'iterationState', type: 'object' },
      { name: 'observation', type: 'any' },
      { name: 'plan', type: 'any' },
    ],
    outputs: [
      { name: 'scratchpad', type: 'array' },
      { name: 'iteration', type: 'number' },
      { name: 'maxIterations', type: 'number' },
      { name: 'isComplete', type: 'boolean' },
    ],
    description: 'Appends new thought/action/observation to scratchpad',
  }),

  // MEMORY NODES
  defineSchema({
    id: 'weighted_sampler',
    name: 'Weighted Sampler',
    category: 'memory',
    inputs: [],
    outputs: [
      { name: 'memoryPaths', type: 'array', description: 'Sampled memory file paths' },
      { name: 'count', type: 'number' },
    ],
    properties: { decayFactor: 14, sampleSize: 5 },
    description: 'Samples memories using exponential decay weighting',
  }),
  defineSchema({
    id: 'memory_router',
    name: 'Memory Router',
    category: 'memory',
    inputs: [
      { name: 'orchestratorHints', type: 'object', description: 'Memory routing hints from orchestrator' },
      { name: 'userMessage', type: 'string', description: 'User message as fallback query' },
    ],
    outputs: [{ name: 'memories', type: 'object', description: 'Retrieved memories with searchPerformed flag' }],
    properties: { topK: 8, threshold: 0.5 },
    propertySchemas: {
      topK: { type: 'slider', default: 8, label: 'Top K Results', min: 1, max: 20, step: 1 },
      threshold: { type: 'slider', default: 0.5, label: 'Similarity Threshold', min: 0, max: 1, step: 0.05 },
    },
    size: [220, 100],
    description: 'AI-driven memory routing using orchestrator hints',
  }),
];

// Helper function to get schema by ID
export function getNodeSchema(id: string): NodeSchema | undefined {
  return nodeSchemas.find((schema) => schema.id === id);
}

// Helper function to get schemas by category
export function getNodesByCategory(category: NodeCategory): NodeSchema[] {
  return nodeSchemas.filter((schema) => schema.category === category);
}

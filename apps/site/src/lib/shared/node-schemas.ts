/**
 * Node type schemas for the cognitive system visual editor
 *
 * This file defines all node types, their inputs/outputs, and metadata
 * for the LiteGraph-based visual programming interface.
 */

export type NodeCategory =
  | 'input'
  | 'router'
  | 'context'
  | 'operator'
  | 'chat'
  | 'model'
  | 'skill'
  | 'output'
  | 'control_flow'
  | 'memory'
  | 'utility'
  | 'agent'
  | 'config';

export type SlotType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'message'
  | 'context'
  | 'cognitiveMode'
  | 'user'
  | 'memory'
  | 'skill_result'
  | 'llm_response'
  | 'decision'
  | 'any';

export interface NodeSlot {
  name: string;
  type: SlotType;
  optional?: boolean;
  description?: string;
}

/**
 * Property schema for rich node configuration
 * Defines metadata for auto-generating widgets and validation
 */
export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'slider'
  | 'color'
  | 'json'
  | 'text_multiline';

export interface PropertySchema {
  type: PropertyType;
  default: any;
  label?: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[] | { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  rows?: number; // For multiline text
  validation?: (value: any) => boolean | string; // Return true or error message
}

export interface NodeSchema {
  id: string;
  name: string;
  category: NodeCategory;
  color: string;
  bgColor: string;
  inputs: NodeSlot[];
  outputs: NodeSlot[];
  properties?: Record<string, any>;
  propertySchemas?: Record<string, PropertySchema>; // Rich property definitions
  description: string;
  size?: [number, number]; // Optional default size [width, height]
}

// Color scheme for node categories
export const categoryColors = {
  input: { color: '#4ade80', bgColor: '#166534' },      // Green
  router: { color: '#fbbf24', bgColor: '#92400e' },     // Amber
  context: { color: '#60a5fa', bgColor: '#1e3a8a' },    // Blue
  operator: { color: '#a78bfa', bgColor: '#5b21b6' },   // Purple
  chat: { color: '#f472b6', bgColor: '#9f1239' },       // Pink
  model: { color: '#fb923c', bgColor: '#9a3412' },      // Orange
  skill: { color: '#34d399', bgColor: '#065f46' },      // Emerald
  output: { color: '#ef4444', bgColor: '#991b1b' },     // Red
  control_flow: { color: '#818cf8', bgColor: '#4338ca' }, // Indigo
  memory: { color: '#c084fc', bgColor: '#7e22ce' },     // Violet
  utility: { color: '#94a3b8', bgColor: '#475569' },    // Slate
  agent: { color: '#22d3ee', bgColor: '#155e75' },      // Cyan
  config: { color: '#fde047', bgColor: '#854d0e' },     // Yellow
};

// ============================================================================
// INPUT NODES
// ============================================================================

export const MicInputNode: NodeSchema = {
  id: 'mic_input',
  name: 'Mic Input',
  category: 'input',
  ...categoryColors.input,
  inputs: [],
  outputs: [
    { name: 'audioBuffer', type: 'object', description: 'Raw audio buffer from microphone' },
    { name: 'audioFormat', type: 'string', description: 'Audio format (wav/webm/mp3)' },
    { name: 'hasMicInput', type: 'boolean', description: 'Whether mic input is available' },
  ],
  properties: {
    audioFormat: 'wav',
  },
  description: 'Captures audio input from microphone for speech recognition',
};

export const SpeechToTextNode: NodeSchema = {
  id: 'speech_to_text',
  name: 'Speech to Text',
  category: 'input',
  ...categoryColors.input,
  inputs: [
    { name: 'audioBuffer', type: 'object', description: 'Audio buffer to transcribe' },
  ],
  outputs: [
    { name: 'text', type: 'string', description: 'Transcribed text from speech' },
    { name: 'transcribed', type: 'boolean', description: 'Whether transcription succeeded' },
    { name: 'audioFormat', type: 'string', description: 'Audio format used' },
  ],
  properties: {
    audioFormat: 'wav',
  },
  description: 'Converts speech audio to text using Whisper STT',
};

export const TextInputNode: NodeSchema = {
  id: 'text_input',
  name: 'Text Input',
  category: 'input',
  ...categoryColors.input,
  inputs: [],
  outputs: [
    { name: 'text', type: 'string', description: 'Text from chat interface input' },
    { name: 'hasTextInput', type: 'boolean', description: 'Whether text input is available' },
  ],
  properties: {
    placeholder: 'Enter text...',
  },
  description: 'Gateway to chat interface text input - connects to main page text field',
};

export const UserInputNode: NodeSchema = {
  id: 'user_input',
  name: 'User Input',
  category: 'input',
  ...categoryColors.input,
  inputs: [
    { name: 'speech', type: 'object', optional: true, description: 'Transcribed speech input from mic node' },
    { name: 'text', type: 'string', optional: true, description: 'Direct text input from text input node' },
  ],
  outputs: [
    { name: 'message', type: 'string', description: 'User message (text or transcribed speech)' },
    { name: 'inputSource', type: 'string', description: 'Input source: "text", "speech", or "chat"' },
    { name: 'sessionId', type: 'string', description: 'Session identifier' },
  ],
  properties: {
    message: '',
    prioritizeChatInterface: true, // When true, use context.userMessage from chat, when false use inputs
  },
  description: 'Unified input node - prioritizes chat interface by default, can accept text/speech from nodes',
};

export const SessionContextNode: NodeSchema = {
  id: 'session_context',
  name: 'Session Context',
  category: 'input',
  ...categoryColors.input,
  inputs: [
    { name: 'sessionId', type: 'string' },
  ],
  outputs: [
    { name: 'conversationHistory', type: 'array', description: 'Recent conversation messages' },
    { name: 'user', type: 'user', description: 'Current user object' },
  ],
  description: 'Loads session and conversation history',
};

export const SystemSettingsNode: NodeSchema = {
  id: 'system_settings',
  name: 'System Settings',
  category: 'input',
  ...categoryColors.input,
  inputs: [],
  outputs: [
    { name: 'cognitiveMode', type: 'cognitiveMode', description: 'Current cognitive mode (dual/agent/emulation)' },
    { name: 'trustLevel', type: 'string', description: 'Current trust level' },
    { name: 'settings', type: 'object', description: 'System settings object' },
  ],
  description: 'Provides system configuration',
};

// ============================================================================
// ROUTER NODES
// ============================================================================

export const CognitiveModeRouterNode: NodeSchema = {
  id: 'cognitive_mode_router',
  name: 'Cognitive Mode Router',
  category: 'router',
  ...categoryColors.router,
  inputs: [
    { name: 'cognitiveMode', type: 'cognitiveMode' },
    { name: 'message', type: 'string' },
  ],
  outputs: [
    { name: 'useDual', type: 'decision', description: 'Route to operator (dual mode)' },
    { name: 'useAgent', type: 'decision', description: 'Conditional routing (agent mode)' },
    { name: 'useEmulation', type: 'decision', description: 'Chat only (emulation mode)' },
  ],
  description: 'Routes based on cognitive mode',
};

export const AuthCheckNode: NodeSchema = {
  id: 'auth_check',
  name: 'Authentication Check',
  category: 'router',
  ...categoryColors.router,
  inputs: [
    { name: 'user', type: 'user' },
  ],
  outputs: [
    { name: 'isAuthenticated', type: 'boolean' },
    { name: 'role', type: 'string', description: 'User role (owner/guest/anonymous)' },
  ],
  description: 'Checks user authentication status',
};

export const OperatorEligibilityNode: NodeSchema = {
  id: 'operator_eligibility',
  name: 'Operator Eligibility',
  category: 'router',
  ...categoryColors.router,
  inputs: [
    { name: 'cognitiveMode', type: 'cognitiveMode' },
    { name: 'isAuthenticated', type: 'boolean' },
    { name: 'message', type: 'string' },
  ],
  outputs: [
    { name: 'useOperator', type: 'boolean', description: 'Should use operator pipeline' },
  ],
  description: 'Determines if operator should be used',
};

export const SmartRouterNode: NodeSchema = {
  id: 'smart_router',
  name: 'Smart Router',
  category: 'router',
  ...categoryColors.router,
  inputs: [
    { name: 'orchestratorAnalysis', type: 'object', description: 'Analysis from orchestrator LLM' },
  ],
  outputs: [
    { name: 'complexPath', type: 'object', description: 'Output for complex queries (to operator)' },
    { name: 'simplePath', type: 'object', description: 'Output for simple queries (direct to response)' },
  ],
  properties: {
    routeOnComplexity: true,
    simpleThreshold: 0.3,
  },
  description: 'Routes queries based on complexity analysis - simple queries skip operator overhead',
};

// ============================================================================
// CONTEXT NODES
// ============================================================================

export const ContextBuilderNode: NodeSchema = {
  id: 'context_builder',
  name: 'Context Builder',
  category: 'context',
  ...categoryColors.context,
  inputs: [
    { name: 'message', type: 'string' },
    { name: 'cognitiveMode', type: 'cognitiveMode' },
    { name: 'conversationHistory', type: 'array', optional: true },
  ],
  outputs: [
    { name: 'context', type: 'context', description: 'Complete context package' },
  ],
  properties: {
    searchDepth: 'normal',
    maxMemories: 8,
    maxContextChars: 8000,
  },
  propertySchemas: {
    searchDepth: {
      type: 'select',
      default: 'normal',
      label: 'Search Depth',
      description: 'How deeply to search memory',
      options: ['shallow', 'normal', 'deep', 'exhaustive']
    },
    maxMemories: {
      type: 'slider',
      default: 8,
      label: 'Max Memories',
      description: 'Maximum number of memories to include',
      min: 1,
      max: 20,
      step: 1
    },
    maxContextChars: {
      type: 'number',
      default: 8000,
      label: 'Max Context Length',
      description: 'Maximum character count for context',
      min: 1000,
      max: 32000,
      step: 1000
    }
  },
  size: [280, 200],
  description: 'Builds context package with memories',
};

export const SemanticSearchNode: NodeSchema = {
  id: 'semantic_search',
  name: 'Semantic Search',
  category: 'context',
  ...categoryColors.context,
  inputs: [
    { name: 'query', type: 'string' },
    { name: 'similarityThreshold', type: 'number', optional: true },
  ],
  outputs: [
    { name: 'memories', type: 'array', description: 'Relevant memories' },
  ],
  properties: {
    similarityThreshold: 0.6,
    maxResults: 8,
  },
  propertySchemas: {
    similarityThreshold: {
      type: 'slider',
      default: 0.6,
      label: 'Similarity Threshold',
      description: 'Minimum similarity score (0-1)',
      min: 0,
      max: 1,
      step: 0.05
    },
    maxResults: {
      type: 'slider',
      default: 8,
      label: 'Max Results',
      description: 'Maximum number of results to return',
      min: 1,
      max: 20,
      step: 1
    }
  },
  size: [260, 160],
  description: 'Searches memories using embeddings',
};

export const ConversationHistoryNode: NodeSchema = {
  id: 'conversation_history',
  name: 'Conversation History',
  category: 'context',
  ...categoryColors.context,
  inputs: [
    { name: 'sessionId', type: 'string' },
    { name: 'mode', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'history', type: 'array', description: 'Conversation messages' },
  ],
  properties: {
    mode: 'conversation',
    maxMessages: 20,
  },
  description: 'Loads conversation history',
};

export const BufferManagerNode: NodeSchema = {
  id: 'buffer_manager',
  name: 'Buffer Manager',
  category: 'context',
  ...categoryColors.context,
  inputs: [
    { name: 'history', type: 'array', description: 'Existing conversation history' },
    { name: 'response', type: 'string', description: 'New assistant response to append' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Persistence result with persisted, mode, messageCount' },
  ],
  properties: {
    mode: 'conversation',
  },
  description: 'Persists conversation buffer to disk',
};

// ============================================================================
// OPERATOR NODES
// ============================================================================

export const ReActPlannerNode: NodeSchema = {
  id: 'react_planner',
  name: 'ReAct Planner',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'goal', type: 'string', description: 'User goal/request' },
    { name: 'context', type: 'context' },
    { name: 'scratchpad', type: 'array', optional: true },
  ],
  outputs: [
    { name: 'thought', type: 'string', description: 'Reasoning about next step' },
    { name: 'action', type: 'object', description: 'Skill to execute' },
  ],
  properties: {
    model: 'default.coder',
    temperature: 0.2,
  },
  propertySchemas: {
    model: {
      type: 'string',
      default: 'default.coder',
      label: 'Model',
      description: 'LLM model to use for planning'
    },
    temperature: {
      type: 'slider',
      default: 0.2,
      label: 'Temperature',
      description: 'Sampling temperature for creativity',
      min: 0,
      max: 1,
      step: 0.1
    }
  },
  size: [240, 180],
  description: 'Plans next action in ReAct loop',
};

export const SkillExecutorNode: NodeSchema = {
  id: 'skill_executor',
  name: 'Skill Executor',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'skillName', type: 'string' },
    { name: 'arguments', type: 'object' },
  ],
  outputs: [
    { name: 'result', type: 'skill_result', description: 'Skill execution result' },
    { name: 'success', type: 'boolean' },
    { name: 'error', type: 'object', optional: true },
  ],
  description: 'Executes a skill with arguments',
};

export const ObservationFormatterNode: NodeSchema = {
  id: 'observation_formatter',
  name: 'Observation Formatter',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'result', type: 'skill_result' },
    { name: 'mode', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'observation', type: 'string', description: 'Formatted observation text' },
  ],
  properties: {
    mode: 'narrative',
  },
  propertySchemas: {
    mode: {
      type: 'select',
      default: 'narrative',
      label: 'Format Mode',
      description: 'How to format observation',
      options: ['narrative', 'structured', 'verbatim']
    }
  },
  size: [240, 140],
  description: 'Formats skill results for LLM',
};

export const CompletionCheckerNode: NodeSchema = {
  id: 'completion_checker',
  name: 'Completion Checker',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'goal', type: 'string' },
    { name: 'scratchpad', type: 'array' },
  ],
  outputs: [
    { name: 'isComplete', type: 'boolean' },
    { name: 'reason', type: 'string', optional: true },
  ],
  description: 'Checks if goal is achieved',
};

export const ResponseSynthesizerNode: NodeSchema = {
  id: 'response_synthesizer',
  name: 'Response Synthesizer',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'goal', type: 'string' },
    { name: 'scratchpad', type: 'array' },
    { name: 'context', type: 'context' },
  ],
  outputs: [
    { name: 'response', type: 'string', description: 'Final natural language response' },
  ],
  properties: {
    model: 'persona',
    style: 'default',
  },
  propertySchemas: {
    model: {
      type: 'string',
      default: 'persona',
      label: 'Model',
      description: 'LLM model for synthesis'
    },
    style: {
      type: 'select',
      default: 'default',
      label: 'Response Style',
      description: 'How to synthesize the response',
      options: ['default', 'strict', 'summary']
    }
  },
  size: [260, 180],
  description: 'Synthesizes final response from scratchpad',
};

// ============================================================================
// CHAT NODES
// ============================================================================

export const PersonaLLMNode: NodeSchema = {
  id: 'persona_llm',
  name: 'Persona LLM',
  category: 'chat',
  ...categoryColors.chat,
  inputs: [
    { name: 'personaText', type: 'object', description: 'Formatted persona text from persona_formatter' },
    { name: 'conversationHistory', type: 'array', description: 'Chat history' },
    { name: 'memories', type: 'array', optional: true, description: 'Semantic search memories' },
    { name: 'orchestratorData', type: 'object', optional: true, description: 'Instructions from orchestrator' },
  ],
  outputs: [
    { name: 'response', type: 'string' },
  ],
  properties: {
    model: 'fallback',
    temperature: 0.7,
  },
  propertySchemas: {
    model: {
      type: 'string',
      default: 'fallback',
      label: 'Model',
      description: 'LLM model for persona responses'
    },
    temperature: {
      type: 'slider',
      default: 0.7,
      label: 'Temperature',
      description: 'Sampling temperature',
      min: 0,
      max: 1,
      step: 0.1
    }
  },
  size: [240, 200],
  description: 'Generates response using persona with orchestrator instructions',
};

export const OrchestratorLLMNode: NodeSchema = {
  id: 'orchestrator_llm',
  name: 'Intent Orchestrator',
  category: 'chat',
  ...categoryColors.chat,
  inputs: [
    { name: 'userMessage', type: 'string', description: 'User message to analyze' },
  ],
  outputs: [
    { name: 'decision', type: 'object', description: 'Object with needsMemory, responseStyle, instructions' },
  ],
  properties: {
    temperature: 0.3,
  },
  propertySchemas: {
    temperature: {
      type: 'slider',
      default: 0.3,
      label: 'Temperature',
      description: 'Analysis temperature',
      min: 0,
      max: 1,
      step: 0.1
    }
  },
  size: [240, 150],
  description: 'Analyzes user intent to determine memory needs and response style',
};

export const PersonaFormatterNode: NodeSchema = {
  id: 'persona_formatter',
  name: 'Persona Formatter',
  category: 'config',
  ...categoryColors.config,
  inputs: [
    { name: 'personaData', type: 'object', description: 'Persona data from persona_loader' },
  ],
  outputs: [
    { name: 'formatted', type: 'object', description: 'Object with formatted persona text' },
  ],
  properties: {
    includePersonality: true,
    includeValues: true,
    includeGoals: true,
  },
  description: 'Formats persona data into system prompt text',
};

export const ReflectorLLMNode: NodeSchema = {
  id: 'reflector_llm',
  name: 'Reflector LLM',
  category: 'chat',
  ...categoryColors.chat,
  inputs: [
    { name: 'prompt', type: 'string', description: 'User prompt or reflection text' },
  ],
  outputs: [
    { name: 'response', type: 'string' },
  ],
  properties: {
    role: 'persona',
    temperature: 0.8,
    systemPrompt: '',
  },
  description: 'Generates reflections/summaries with custom prompts',
};

export const InnerDialogueCaptureNode: NodeSchema = {
  id: 'inner_dialogue_capture',
  name: 'Inner Dialogue Capture',
  category: 'output',
  ...categoryColors.output,
  inputs: [
    { name: 'text', type: 'string', description: 'Reflection or thought text' },
    { name: 'metadata', type: 'object', optional: true },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Save result with path' },
  ],
  properties: {
    tags: ['idle-thought', 'self-reflection', 'inner'],
  },
  description: 'Saves inner dialogue to episodic memory (never shown in main chat)',
};

export const ChainOfThoughtStripperNode: NodeSchema = {
  id: 'cot_stripper',
  name: 'Chain-of-Thought Stripper',
  category: 'chat',
  ...categoryColors.chat,
  inputs: [
    { name: 'response', type: 'llm_response' },
  ],
  outputs: [
    { name: 'cleaned', type: 'string', description: 'Response with <think> blocks removed' },
    { name: 'response', type: 'string', description: 'Alias for cleaned output', optional: true },
  ],
  description: 'Removes internal reasoning blocks',
};

export const SafetyValidatorNode: NodeSchema = {
  id: 'safety_validator',
  name: 'Safety Validator',
  category: 'chat',
  ...categoryColors.chat,
  inputs: [
    { name: 'response', type: 'string' },
  ],
  outputs: [
    { name: 'response', type: 'string' },
    { name: 'isSafe', type: 'boolean' },
    { name: 'issues', type: 'array', optional: true },
    { name: 'safetyResult', type: 'object', optional: true },
  ],
  properties: {
    threshold: 0.7,
  },
  description: 'Validates response safety',
};

export const ResponseRefinerNode: NodeSchema = {
  id: 'response_refiner',
  name: 'Response Refiner',
  category: 'chat',
  ...categoryColors.chat,
  inputs: [
    { name: 'response', type: 'string' },
    { name: 'safetyResult', type: 'object', optional: true },
  ],
  outputs: [
    { name: 'response', type: 'string' },
    { name: 'refined', type: 'boolean', optional: true },
  ],
  description: 'Refines response to address safety issues',
};

// ============================================================================
// MODEL NODES
// ============================================================================

export const ModelResolverNode: NodeSchema = {
  id: 'model_resolver',
  name: 'Model Resolver',
  category: 'model',
  ...categoryColors.model,
  inputs: [
    { name: 'role', type: 'string', description: 'Model role (orchestrator/persona/coder/etc)' },
    { name: 'cognitiveMode', type: 'cognitiveMode', optional: true },
  ],
  outputs: [
    { name: 'modelConfig', type: 'object', description: 'Resolved model configuration' },
  ],
  description: 'Resolves model based on role and mode',
};

export const ModelRouterNode: NodeSchema = {
  id: 'model_router',
  name: 'Model Router',
  category: 'model',
  ...categoryColors.model,
  inputs: [
    { name: 'role', type: 'string' },
    { name: 'messages', type: 'array' },
    { name: 'options', type: 'object', optional: true },
  ],
  outputs: [
    { name: 'response', type: 'llm_response' },
  ],
  properties: {
    role: 'persona',
    temperature: 0.7,
  },
  description: 'Routes LLM call based on role',
};

// ============================================================================
// OUTPUT NODES
// ============================================================================

export const MemoryCaptureNode: NodeSchema = {
  id: 'memory_capture',
  name: 'Memory Capture',
  category: 'output',
  ...categoryColors.output,
  inputs: [
    { name: 'userMessage', type: 'string' },
    { name: 'assistantResponse', type: 'string' },
    { name: 'cognitiveMode', type: 'cognitiveMode' },
    { name: 'metadata', type: 'object', optional: true },
  ],
  outputs: [
    { name: 'eventPath', type: 'string', description: 'Path to saved event file' },
  ],
  description: 'Saves conversation to episodic memory',
};

export const AuditLoggerNode: NodeSchema = {
  id: 'audit_logger',
  name: 'Audit Logger',
  category: 'output',
  ...categoryColors.output,
  inputs: [
    { name: 'eventType', type: 'string' },
    { name: 'details', type: 'object' },
  ],
  outputs: [
    { name: 'logged', type: 'boolean' },
  ],
  description: 'Logs to audit trail',
};

export const StreamWriterNode: NodeSchema = {
  id: 'stream_writer',
  name: 'Stream Writer',
  category: 'output',
  ...categoryColors.output,
  inputs: [
    { name: 'response', type: 'string' },
  ],
  outputs: [
    { name: 'output', type: 'string', description: 'Output text (for chaining to chat view)' },
  ],
  description: 'Streams response to client (terminal node)',
};

export const ChatViewNode: NodeSchema = {
  id: 'chat_view',
  name: 'Chat View',
  category: 'output',
  ...categoryColors.output,
  inputs: [
    { name: 'message', type: 'string', optional: true, description: 'Direct message to display' },
    { name: 'trigger', type: 'any', optional: true, description: 'Trigger to refresh from conversation' },
  ],
  outputs: [],
  properties: {
    mode: 'direct', // 'direct' | 'trigger'
    maxMessages: 5,
  },
  description: 'Displays chat messages visually - direct input or triggered refresh from conversation history',
};

export const TTSNode: NodeSchema = {
  id: 'tts',
  name: 'Text to Speech',
  category: 'output',
  ...categoryColors.output,
  inputs: [
    { name: 'text', type: 'string', description: 'Text to speak' },
  ],
  outputs: [],
  properties: {
    provider: '', // Empty = use default
    autoPlay: true,
  },
  description: 'Converts text to speech using the main interface TTS system',
};

// ============================================================================
// SKILL NODES (25 total)
// ============================================================================

// Filesystem skills
export const FsReadNode: NodeSchema = {
  id: 'skill_fs_read',
  name: 'Read File',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [
    { name: 'filePath', type: 'string' },
  ],
  outputs: [
    { name: 'content', type: 'string' },
    { name: 'success', type: 'boolean' },
  ],
  description: 'Reads file contents',
};

export const FsWriteNode: NodeSchema = {
  id: 'skill_fs_write',
  name: 'Write File',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [
    { name: 'filePath', type: 'string' },
    { name: 'content', type: 'string' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
  ],
  description: 'Writes file contents',
};

export const FsListNode: NodeSchema = {
  id: 'skill_fs_list',
  name: 'List Files',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [
    { name: 'directory', type: 'string' },
  ],
  outputs: [
    { name: 'files', type: 'array' },
  ],
  description: 'Lists directory contents',
};

// Task skills
export const TaskCreateNode: NodeSchema = {
  id: 'skill_task_create',
  name: 'Create Task',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'taskId', type: 'string' },
  ],
  description: 'Creates a new task',
};

export const TaskListNode: NodeSchema = {
  id: 'skill_task_list',
  name: 'List Tasks',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [],
  outputs: [
    { name: 'tasks', type: 'array' },
  ],
  description: 'Lists active tasks',
};

export const TaskUpdateNode: NodeSchema = {
  id: 'skill_task_update',
  name: 'Update Task',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [
    { name: 'taskId', type: 'string' },
    { name: 'status', type: 'string' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
  ],
  description: 'Updates task status',
};

// Search skills
export const SearchIndexNode: NodeSchema = {
  id: 'skill_search_index',
  name: 'Search Index',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [
    { name: 'query', type: 'string' },
    { name: 'maxResults', type: 'number', optional: true },
  ],
  outputs: [
    { name: 'results', type: 'array' },
  ],
  description: 'Semantic memory search',
};

export const WebSearchNode: NodeSchema = {
  id: 'skill_web_search',
  name: 'Web Search',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [
    { name: 'query', type: 'string' },
  ],
  outputs: [
    { name: 'results', type: 'array' },
  ],
  description: 'Searches the web',
};

// Conversational skill
export const ConversationalResponseNode: NodeSchema = {
  id: 'skill_conversational_response',
  name: 'Conversational Response',
  category: 'skill',
  ...categoryColors.skill,
  inputs: [
    { name: 'message', type: 'string' },
    { name: 'context', type: 'context', optional: true },
    { name: 'style', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'response', type: 'string' },
  ],
  properties: {
    style: 'default',
  },
  propertySchemas: {
    style: {
      type: 'select',
      default: 'default',
      label: 'Response Style',
      description: 'Style of conversational response',
      options: ['default', 'strict', 'summary']
    }
  },
  size: [260, 160],
  description: 'Generates conversational response (terminal skill)',
};

// ============================================================================
// CONTROL FLOW NODES
// ============================================================================

export const LoopControllerNode: NodeSchema = {
  id: 'loop_controller',
  name: 'Loop Controller',
  category: 'control_flow',
  ...categoryColors.control_flow,
  inputs: [
    { name: 'input', type: 'any' },
  ],
  outputs: [
    { name: 'iterations', type: 'array', description: 'Array of iteration results' },
    { name: 'finalOutput', type: 'any', description: 'Final output after loop completes' },
    { name: 'completed', type: 'boolean', description: 'Whether loop completed normally' },
  ],
  properties: {
    maxIterations: 10,
    completionCheck: 'completed',
  },
  description: 'Iterative execution with max iterations and completion detection',
};

export const ConditionalBranchNode: NodeSchema = {
  id: 'conditional_branch',
  name: 'Conditional Branch',
  category: 'control_flow',
  ...categoryColors.control_flow,
  inputs: [
    { name: 'input', type: 'any' },
  ],
  outputs: [
    { name: 'conditionMet', type: 'boolean' },
    { name: 'trueOutput', type: 'any', description: 'Output if condition is true' },
    { name: 'falseOutput', type: 'any', description: 'Output if condition is false' },
  ],
  properties: {
    condition: 'value',
    operator: '==', // ==, !=, >, <, exists, truthy, falsy
    compareValue: null,
  },
  description: 'Routes execution based on a condition (if/else logic)',
};

export const ConditionalRouterNode: NodeSchema = {
  id: 'conditional_router',
  name: 'Conditional Router',
  category: 'control_flow',
  ...categoryColors.control_flow,
  inputs: [
    { name: 'condition', type: 'any', description: 'Condition data (boolean or object with isComplete/shouldContinue)' },
    { name: 'trueData', type: 'any', description: 'Data to route if condition is true (exit path)' },
    { name: 'falseData', type: 'any', description: 'Data to route if condition is false (loop-back path)' },
  ],
  outputs: [
    { name: 'exitOutput', type: 'any', description: 'Output when condition is true (exit loop)' },
    { name: 'loopOutput', type: 'any', description: 'Output when condition is false (continue loop)' },
  ],
  properties: {
    conditionField: 'isComplete', // Field to check in condition object
  },
  description: 'Routes data based on condition - designed for loop control with exit and loop-back paths',
};

export const ConditionalRerouteNode: NodeSchema = {
  id: 'conditional_reroute',
  name: 'Conditional Reroute',
  category: 'control_flow',
  ...categoryColors.control_flow,
  inputs: [
    { name: 'primaryInput', type: 'any', description: 'Primary input (checked for validity)' },
    { name: 'fallbackInput', type: 'any', description: 'Fallback input (used if primary is empty)' },
  ],
  outputs: [
    { name: 'output', type: 'any', description: 'Selected input (primary or fallback)' },
    { name: 'usedFallback', type: 'boolean', description: 'Whether fallback was used' },
  ],
  properties: {},
  description: 'Intelligently routes between primary and fallback inputs - detects empty/muted node data and uses fallback',
};

export const SwitchNode: NodeSchema = {
  id: 'switch',
  name: 'Switch',
  category: 'control_flow',
  ...categoryColors.control_flow,
  inputs: [
    { name: 'input', type: 'any' },
  ],
  outputs: [
    { name: 'switchValue', type: 'any' },
    { name: 'matchedCase', type: 'string' },
    { name: 'output', type: 'any' },
  ],
  properties: {
    switchField: 'mode',
    cases: {},
    defaultCase: 'default',
  },
  description: 'Multi-way routing based on a value',
};

export const ForEachNode: NodeSchema = {
  id: 'for_each',
  name: 'For Each',
  category: 'control_flow',
  ...categoryColors.control_flow,
  inputs: [
    { name: 'input', type: 'object' },
  ],
  outputs: [
    { name: 'results', type: 'array', description: 'Array of iteration results' },
    { name: 'count', type: 'number', description: 'Number of items processed' },
  ],
  properties: {
    arrayField: 'items',
  },
  description: 'Iterates over an array, executing logic for each element',
};

// ============================================================================
// MEMORY CURATION NODES
// ============================================================================

export const WeightedSamplerNode: NodeSchema = {
  id: 'weighted_sampler',
  name: 'Weighted Sampler',
  category: 'memory',
  ...categoryColors.memory,
  inputs: [],
  outputs: [
    { name: 'memoryPaths', type: 'array', description: 'Sampled memory file paths' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    decayFactor: 14, // Days for 50% weight reduction
    sampleSize: 5,
  },
  description: 'Samples memories using exponential decay weighting',
};

export const AssociativeChainNode: NodeSchema = {
  id: 'associative_chain',
  name: 'Associative Chain',
  category: 'memory',
  ...categoryColors.memory,
  inputs: [
    { name: 'startMemory', type: 'memory', description: 'Starting memory object' },
  ],
  outputs: [
    { name: 'chain', type: 'array', description: 'Chain of associated memories' },
    { name: 'keywords', type: 'array', description: 'Keywords used for chaining' },
  ],
  properties: {
    chainLength: 5,
  },
  description: 'Follows keyword connections between memories',
};

export const MemoryFilterNode: NodeSchema = {
  id: 'memory_filter',
  name: 'Memory Filter',
  category: 'memory',
  ...categoryColors.memory,
  inputs: [
    { name: 'memories', type: 'array' },
  ],
  outputs: [
    { name: 'memories', type: 'array', description: 'Filtered memories' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    filterType: null,
    filterTags: [],
    startDate: null,
    endDate: null,
    limit: 100,
  },
  propertySchemas: {
    filterType: {
      type: 'select',
      default: null,
      label: 'Filter Type',
      description: 'Memory type to filter by',
      options: ['all', 'conversation', 'inner_dialogue', 'observation', 'dream']
    },
    limit: {
      type: 'slider',
      default: 100,
      label: 'Max Results',
      description: 'Maximum memories to return',
      min: 1,
      max: 500,
      step: 10
    }
  },
  size: [260, 160],
  description: 'Filters memories by type, tags, or date range',
};

export const MemoryRouterNode: NodeSchema = {
  id: 'memory_router',
  name: 'Memory Router',
  category: 'memory',
  ...categoryColors.memory,
  inputs: [
    { name: 'orchestratorHints', type: 'object', description: 'Memory routing hints from orchestrator (needsMemory, memoryTier, memoryQuery)' },
    { name: 'userMessage', type: 'string', description: 'User message as fallback query' },
  ],
  outputs: [
    { name: 'memories', type: 'object', description: 'Retrieved memories with searchPerformed flag' },
  ],
  properties: {
    topK: 8,
    threshold: 0.5,
  },
  propertySchemas: {
    topK: {
      type: 'slider',
      default: 8,
      label: 'Top K Results',
      description: 'Maximum number of memories to retrieve',
      min: 1,
      max: 20,
      step: 1
    },
    threshold: {
      type: 'slider',
      default: 0.5,
      label: 'Similarity Threshold',
      description: 'Minimum similarity score (0-1)',
      min: 0,
      max: 1,
      step: 0.05
    }
  },
  size: [220, 100],
  description: 'AI-driven memory routing - uses orchestrator hints to determine tier and performs intelligent retrieval',
};

// ============================================================================
// UTILITY NODES
// ============================================================================

export const JSONParserNode: NodeSchema = {
  id: 'json_parser',
  name: 'JSON Parser',
  category: 'utility',
  ...categoryColors.utility,
  inputs: [
    { name: 'text', type: 'string', description: 'Text containing JSON' },
  ],
  outputs: [
    { name: 'data', type: 'object', description: 'Parsed JSON object' },
    { name: 'success', type: 'boolean' },
  ],
  properties: {
    fallback: null,
  },
  description: 'Extracts JSON from text (useful for parsing LLM responses)',
};

export const TextTemplateNode: NodeSchema = {
  id: 'text_template',
  name: 'Text Template',
  category: 'utility',
  ...categoryColors.utility,
  inputs: [
    { name: 'variables', type: 'object', description: 'Variables for interpolation' },
  ],
  outputs: [
    { name: 'text', type: 'string', description: 'Interpolated text' },
  ],
  properties: {
    template: '',
  },
  description: 'String interpolation with {{variable}} substitution',
};

export const DataTransformNode: NodeSchema = {
  id: 'data_transform',
  name: 'Data Transform',
  category: 'utility',
  ...categoryColors.utility,
  inputs: [
    { name: 'data', type: 'array' },
  ],
  outputs: [
    { name: 'result', type: 'any', description: 'Transformed data' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    operation: 'map', // map, filter, reduce, unique, sort
    field: null,
    condition: null,
    reduceOperation: 'count',
  },
  description: 'Map/filter/reduce operations on arrays',
};

export const CacheNode: NodeSchema = {
  id: 'cache',
  name: 'Cache',
  category: 'utility',
  ...categoryColors.utility,
  inputs: [
    { name: 'value', type: 'any' },
  ],
  outputs: [
    { name: 'value', type: 'any' },
    { name: 'hit', type: 'boolean', description: 'Whether cache was hit' },
  ],
  properties: {
    key: 'default',
    ttl: 60000,
    operation: 'get',
  },
  propertySchemas: {
    key: {
      type: 'string',
      default: 'default',
      label: 'Cache Key',
      description: 'Key for cache storage'
    },
    ttl: {
      type: 'number',
      default: 60000,
      label: 'TTL (ms)',
      description: 'Time-to-live in milliseconds',
      min: 1000,
      max: 3600000,
      step: 1000
    },
    operation: {
      type: 'select',
      default: 'get',
      label: 'Operation',
      description: 'Cache operation type',
      options: ['get', 'set', 'clear', 'clear_all']
    }
  },
  size: [240, 200],
  description: 'Stores intermediate results with TTL',
};

// ============================================================================
// ADVANCED OPERATOR NODES
// ============================================================================

export const PlanParserNode: NodeSchema = {
  id: 'plan_parser',
  name: 'Plan Parser',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'plan', type: 'string', description: 'ReAct-style planning text' },
  ],
  outputs: [
    { name: 'thought', type: 'string' },
    { name: 'action', type: 'string' },
    { name: 'actionInput', type: 'string' },
    { name: 'respond', type: 'string', description: 'Final answer if present' },
    { name: 'parsed', type: 'boolean' },
  ],
  properties: {
    format: 'react', // react, json, freeform
  },
  description: 'Parses ReAct-style planning output into structured components',
};

export const ScratchpadManagerNode: NodeSchema = {
  id: 'scratchpad_manager',
  name: 'Scratchpad Manager',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'step', type: 'object', optional: true, description: 'Step to append' },
  ],
  outputs: [
    { name: 'scratchpad', type: 'array', description: 'Current scratchpad state' },
    { name: 'stepCount', type: 'number' },
  ],
  properties: {
    operation: 'append', // append, get, clear, trim
    maxSteps: 10,
  },
  description: 'Manages ReAct scratchpad state',
};

export const ErrorRecoveryNode: NodeSchema = {
  id: 'error_recovery',
  name: 'Error Recovery',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'error', type: 'string' },
    { name: 'skillId', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'errorType', type: 'string', description: 'Categorized error type' },
    { name: 'suggestions', type: 'array', description: 'Recovery suggestions' },
    { name: 'shouldRetry', type: 'boolean' },
  ],
  properties: {
    maxRetries: 3,
  },
  description: 'Provides smart retry suggestions based on error type',
};

export const StuckDetectorNode: NodeSchema = {
  id: 'stuck_detector',
  name: 'Stuck Detector',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'scratchpad', type: 'array' },
  ],
  outputs: [
    { name: 'isStuck', type: 'boolean' },
    { name: 'consecutiveFailures', type: 'number' },
    { name: 'diagnosis', type: 'string' },
    { name: 'suggestion', type: 'string' },
  ],
  properties: {
    threshold: 3, // Number of consecutive failures
  },
  description: 'Detects failure loops and repeated unsuccessful actions',
};

export const BigBrotherNode: NodeSchema = {
  id: 'big_brother',
  name: 'Big Brother',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'goal', type: 'string', description: 'The goal the operator is trying to achieve' },
    { name: 'scratchpad', type: 'array', description: 'Full scratchpad with actions and observations' },
    { name: 'errorType', type: 'string', optional: true, description: 'Type of error (repeated_failures, no_progress, etc.)' },
    { name: 'context', type: 'object', optional: true, description: 'Additional context about the stuck state' },
  ],
  outputs: [
    { name: 'suggestions', type: 'array', description: 'Array of actionable recovery suggestions' },
    { name: 'reasoning', type: 'string', description: 'Root cause analysis and reasoning' },
    { name: 'alternativeApproach', type: 'string', description: 'Suggested alternative strategy' },
    { name: 'success', type: 'boolean', description: 'Whether escalation succeeded' },
  ],
  properties: {
    provider: 'claude-code',
    maxRetries: 1,
    autoApplySuggestions: false,
  },
  description: 'Escalates stuck states to Claude CLI for expert analysis and recovery guidance',
};

export const BigBrotherRouterNode: NodeSchema = {
  id: 'big_brother_router',
  name: 'Big Brother Router',
  category: 'router',
  ...categoryColors.router,
  inputs: [
    { name: 'skillName', type: 'string', description: 'Name of skill to execute' },
    { name: 'arguments', type: 'object', description: 'Skill arguments' },
  ],
  outputs: [
    { name: 'localPath', type: 'object', description: 'Route to local SkillExecutor' },
    { name: 'claudePath', type: 'object', description: 'Route to BigBrotherExecutor (Claude CLI)' },
  ],
  properties: {
    checkConfig: true,
    checkSession: true,
  },
  description: 'Routes skill execution to local executor or Claude CLI based on Big Brother mode',
};

export const BigBrotherExecutorNode: NodeSchema = {
  id: 'big_brother_executor',
  name: 'Big Brother Executor',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'skillName', type: 'string', description: 'Name of skill to execute' },
    { name: 'arguments', type: 'object', description: 'Skill arguments' },
  ],
  outputs: [
    { name: 'result', type: 'skill_result', description: 'Skill execution result from Claude CLI' },
    { name: 'success', type: 'boolean', description: 'Whether execution succeeded' },
    { name: 'error', type: 'object', optional: true, description: 'Error details if failed' },
  ],
  properties: {
    timeout: 60000,
    autoStartSession: true,
  },
  description: 'Executes skills via Claude CLI - delegates to Claude Code for intelligent execution',
};

export const ClaudeFullTaskNode: NodeSchema = {
  id: 'claude_full_task',
  name: 'Claude Full Task',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'orchestratorAnalysis', type: 'object', optional: true, description: 'Intent analysis from orchestrator' },
    { name: 'userMessage', type: 'string', description: 'The user\'s request to complete' },
    { name: 'contextPackage', type: 'context', optional: true, description: 'Memory context and conversation history' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Execution result from Claude Code (scratchpad, finalResponse, success)' },
  ],
  properties: {
    timeout: 120000, // 2 minutes for full task completion
  },
  description: 'Delegates entire task to Claude Code for autonomous completion - bypasses local ReAct loop',
};

// ============================================================================
// AGENT NODES
// ============================================================================

export const MemoryLoaderNode: NodeSchema = {
  id: 'memory_loader',
  name: 'Memory Loader',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Array of loaded memory objects' },
    { name: 'count', type: 'number', description: 'Number of memories loaded' },
    { name: 'hasMore', type: 'boolean', description: 'Whether more memories exist' },
  ],
  properties: {
    limit: 10,
    onlyUnprocessed: true,
  },
  description: 'Loads episodic memories from disk, optionally filtering for unprocessed items',
};

export const MemorySaverNode: NodeSchema = {
  id: 'memory_saver',
  name: 'Memory Saver',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'memory', type: 'memory', description: 'Memory object to save (must include path)' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'path', type: 'string', description: 'Path where memory was saved' },
    { name: 'error', type: 'string', optional: true },
  ],
  properties: {
    updateOnly: true, // Merge with existing data
  },
  description: 'Saves enriched memory data back to disk',
};

export const LLMEnricherNode: NodeSchema = {
  id: 'llm_enricher',
  name: 'LLM Enricher',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'memory', type: 'memory', description: 'Memory object to enrich' },
  ],
  outputs: [
    { name: 'memory', type: 'memory', description: 'Enriched memory with tags and entities' },
    { name: 'success', type: 'boolean' },
    { name: 'error', type: 'string', optional: true },
  ],
  properties: {
    promptTemplate: `Analyze this memory and extract relevant tags and entities.

Memory: {content}

Return a JSON object with:
- tags: array of relevant keyword tags (3-7 tags)
- entities: array of entities mentioned (people, places, things)

Format: {"tags": [...], "entities": [...]}`,
  },
  description: 'Uses LLM to extract tags and entities from memory content',
};

export const AgentTimerNode: NodeSchema = {
  id: 'agent_timer',
  name: 'Agent Timer',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [],
  outputs: [
    { name: 'currentTime', type: 'number', description: 'Current timestamp in milliseconds' },
    { name: 'interval', type: 'number', description: 'Configured interval in milliseconds' },
    { name: 'nextRun', type: 'number', description: 'Timestamp for next scheduled run' },
  ],
  properties: {
    intervalMs: 60000, // Default 1 minute
  },
  description: 'Provides timing information for scheduled agent execution',
};

// ============================================================================
// CURIOSITY SERVICE NODES (User-Aware Question Generation)
// ============================================================================

export const CuriosityWeightedSamplerNode: NodeSchema = {
  id: 'curiosity_weighted_sampler',
  name: 'Curiosity Weighted Sampler',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Array of sampled memory objects' },
    { name: 'count', type: 'number', description: 'Number of memories sampled' },
    { name: 'username', type: 'string', description: 'User whose memories were sampled' },
    { name: 'decayFactor', type: 'number', description: 'Decay factor used (days)' },
  ],
  properties: {
    sampleSize: 5,
    decayFactor: 14, // Days for exponential decay
  },
  description: 'Samples user-specific memories using weighted selection with exponential decay (14-day half-life). SECURITY: Uses explicit user path isolation.',
};

export const CuriosityQuestionGeneratorNode: NodeSchema = {
  id: 'curiosity_question_generator',
  name: 'Curiosity Question Generator',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'memories', type: 'array', description: 'Array of memory objects to base question on' },
  ],
  outputs: [
    { name: 'question', type: 'string', description: 'Generated curiosity question' },
    { name: 'rawQuestion', type: 'string', description: 'Same as question (for compatibility)' },
    { name: 'username', type: 'string', description: 'User for whom question was generated' },
    { name: 'memoriesConsidered', type: 'number', description: 'Number of memories used' },
  ],
  properties: {
    temperature: 0.6,
  },
  description: 'Generates natural, conversational curiosity questions via LLM using persona-aware prompt construction',
};

export const CuriosityQuestionSaverNode: NodeSchema = {
  id: 'curiosity_question_saver',
  name: 'Curiosity Question Saver',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'question', type: 'string', description: 'Generated question to save' },
    { name: 'memories', type: 'array', optional: true, description: 'Seed memories (for metadata)' },
  ],
  outputs: [
    { name: 'questionId', type: 'string', description: 'Unique question ID' },
    { name: 'saved', type: 'boolean', description: 'Whether save was successful' },
    { name: 'username', type: 'string', description: 'User for whom question was saved' },
    { name: 'askedAt', type: 'string', description: 'ISO timestamp when question was asked' },
  ],
  properties: {},
  description: 'Saves question to audit log (for SSE streaming) and pending directory (for researcher agent). SECURITY: Uses user-specific paths.',
};

export const CuriosityActivityCheckNode: NodeSchema = {
  id: 'curiosity_activity_check',
  name: 'Curiosity Activity Check',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [],
  outputs: [
    { name: 'canAsk', type: 'boolean', description: 'Whether enough time has passed to ask' },
    { name: 'timeSinceLastQuestion', type: 'number', optional: true, description: 'Seconds since last question (null if never asked)' },
    { name: 'questionInterval', type: 'number', description: 'Required interval in seconds' },
    { name: 'username', type: 'string', description: 'User being checked' },
  ],
  properties: {
    questionIntervalSeconds: 1800, // Default 30 minutes
  },
  description: 'Checks if enough time has passed since last curiosity question to prevent rapid-fire questions',
};

// ============================================================================
// CONFIGURATION NODES
// ============================================================================

export const PersonaLoaderNode: NodeSchema = {
  id: 'persona_loader',
  name: 'Persona Loader',
  category: 'config',
  ...categoryColors.config,
  inputs: [],
  outputs: [
    { name: 'persona', type: 'object', description: 'Full persona object' },
    { name: 'identity', type: 'object', description: 'Identity information' },
    { name: 'values', type: 'object', description: 'Core values' },
    { name: 'goals', type: 'object', description: 'Goals' },
    { name: 'success', type: 'boolean' },
  ],
  properties: {},
  description: 'Loads persona core configuration from disk',
};

export const PersonaSaverNode: NodeSchema = {
  id: 'persona_saver',
  name: 'Persona Saver',
  category: 'config',
  ...categoryColors.config,
  inputs: [
    { name: 'persona', type: 'object', description: 'Persona object to save' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'timestamp', type: 'string', description: 'Save timestamp' },
  ],
  properties: {},
  description: 'Saves persona core configuration to disk',
};

export const TrustLevelReaderNode: NodeSchema = {
  id: 'trust_level_reader',
  name: 'Trust Level Reader',
  category: 'config',
  ...categoryColors.config,
  inputs: [],
  outputs: [
    { name: 'trustLevel', type: 'string', description: 'Current trust level' },
    { name: 'availableModes', type: 'array', description: 'Available trust levels' },
    { name: 'description', type: 'string', description: 'Mode description' },
    { name: 'success', type: 'boolean' },
  ],
  properties: {},
  description: 'Reads current trust level from decision rules',
};

export const TrustLevelWriterNode: NodeSchema = {
  id: 'trust_level_writer',
  name: 'Trust Level Writer',
  category: 'config',
  ...categoryColors.config,
  inputs: [
    { name: 'trustLevel', type: 'string', description: 'New trust level' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'trustLevel', type: 'string' },
    { name: 'timestamp', type: 'string' },
  ],
  properties: {},
  description: 'Sets trust level in decision rules',
};

export const DecisionRulesLoaderNode: NodeSchema = {
  id: 'decision_rules_loader',
  name: 'Decision Rules Loader',
  category: 'config',
  ...categoryColors.config,
  inputs: [],
  outputs: [
    { name: 'rules', type: 'object', description: 'Full decision rules object' },
    { name: 'trustLevel', type: 'string' },
    { name: 'hardRules', type: 'array' },
    { name: 'softPreferences', type: 'array' },
    { name: 'success', type: 'boolean' },
  ],
  properties: {},
  description: 'Loads decision rules configuration',
};

export const DecisionRulesSaverNode: NodeSchema = {
  id: 'decision_rules_saver',
  name: 'Decision Rules Saver',
  category: 'config',
  ...categoryColors.config,
  inputs: [
    { name: 'rules', type: 'object', description: 'Decision rules object to save' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'timestamp', type: 'string' },
  ],
  properties: {},
  description: 'Saves decision rules configuration',
};

export const IdentityExtractorNode: NodeSchema = {
  id: 'identity_extractor',
  name: 'Identity Extractor',
  category: 'config',
  ...categoryColors.config,
  inputs: [
    { name: 'persona', type: 'object', optional: true, description: 'Persona object (loads if not provided)' },
  ],
  outputs: [
    { name: 'value', type: 'any', description: 'Extracted field value' },
    { name: 'success', type: 'boolean' },
  ],
  properties: {
    field: 'all', // Specific field to extract (name, role, etc.) or 'all'
  },
  description: 'Extracts specific identity fields from persona',
};

export const ValueManagerNode: NodeSchema = {
  id: 'value_manager',
  name: 'Value Manager',
  category: 'config',
  ...categoryColors.config,
  inputs: [
    { name: 'valueData', type: 'object', optional: true, description: 'Value data for add/remove/update' },
  ],
  outputs: [
    { name: 'values', type: 'array', description: 'Current values array' },
    { name: 'success', type: 'boolean' },
  ],
  properties: {
    operation: 'get', // get, add, remove, update
  },
  description: 'Manages core values (CRUD operations)',
};

export const GoalManagerNode: NodeSchema = {
  id: 'goal_manager',
  name: 'Goal Manager',
  category: 'config',
  ...categoryColors.config,
  inputs: [
    { name: 'goalData', type: 'object', optional: true, description: 'Goal data for add/remove/update' },
  ],
  outputs: [
    { name: 'goals', type: 'array', description: 'Current goals array' },
    { name: 'success', type: 'boolean' },
  ],
  properties: {
    operation: 'get', // get, add, remove, update
    scope: 'shortTerm', // shortTerm, longTerm
  },
  description: 'Manages goals (CRUD operations)',
};

// ============================================================================
// TRAIN OF THOUGHT NODES (Recursive reasoning)
// ============================================================================

export const ScratchpadInitializerNode: NodeSchema = {
  id: 'scratchpad_initializer',
  name: 'Scratchpad Initializer',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'seedMemory', type: 'string', description: 'Initial memory content to seed the thought chain' },
  ],
  outputs: [
    { name: 'scratchpad', type: 'object', description: 'Initialized scratchpad with empty fields' },
  ],
  properties: {
    fields: ['thoughts', 'keywords', 'seenMemoryIds'], // Fields to initialize
  },
  description: 'Initializes a scratchpad object for tracking thought chain state',
};

export const ScratchpadUpdaterNode: NodeSchema = {
  id: 'scratchpad_updater',
  name: 'Scratchpad Updater',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'iterationData', type: 'object', description: 'Iteration data with scratchpad' },
    { name: 'observation', type: 'string', description: 'Observation from skill execution' },
    { name: 'plan', type: 'object', description: 'Thought and action from planner' },
  ],
  outputs: [
    { name: 'scratchpad', type: 'object', description: 'Updated scratchpad with iteration, maxIterations, scratchpad array' },
  ],
  properties: {},
  description: 'Updates scratchpad with new thought, action, observation for ReAct loop',
};

export const IterationCounterNode: NodeSchema = {
  id: 'iteration_counter',
  name: 'Iteration Counter',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'scratchpad', type: 'object', description: 'Initial scratchpad from initializer' },
    { name: 'loopBack', type: 'object', optional: true, description: 'Loop-back data from conditional router' },
  ],
  outputs: [
    { name: 'iterationData', type: 'object', description: 'Object with iteration, maxIterations, scratchpad' },
  ],
  properties: {
    maxIterations: 10,
  },
  description: 'Tracks iteration count in ReAct loop',
};

export const ScratchpadCompletionCheckerNode: NodeSchema = {
  id: 'scratchpad_completion_checker',
  name: 'Completion Checker',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'scratchpad', type: 'object', description: 'Scratchpad with iteration data' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Object with isComplete, reason, scratchpad' },
  ],
  properties: {},
  description: 'Checks if ReAct task is complete based on scratchpad content',
};

export const ScratchpadFormatterNode: NodeSchema = {
  id: 'scratchpad_formatter',
  name: 'Scratchpad Formatter',
  category: 'operator',
  ...categoryColors.operator,
  inputs: [
    { name: 'scratchpad', type: 'object', description: 'Scratchpad to format' },
  ],
  outputs: [
    { name: 'formatted', type: 'string', description: 'Formatted scratchpad text' },
  ],
  properties: {
    format: 'text', // 'text' | 'json' | 'markdown'
  },
  description: 'Formats scratchpad for display or LLM consumption',
};

export const ThoughtGeneratorNode: NodeSchema = {
  id: 'thought_generator',
  name: 'Thought Generator',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'context', type: 'object', description: 'Memory context or scratchpad from previous iteration' },
    { name: 'seedMemory', type: 'string', optional: true, description: 'Seed memory text' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Generated thought with keywords and confidence' },
  ],
  properties: {
    temperature: 0.75,
    extractKeywords: true,
  },
  description: 'Generates a single reasoning step from memory context using LLM',
};

export const ThoughtEvaluatorNode: NodeSchema = {
  id: 'thought_evaluator',
  name: 'Thought Evaluator',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'thought', type: 'object', description: 'Current thought from thought_generator' },
    { name: 'iteration', type: 'object', optional: true, description: 'Iteration info' },
    { name: 'history', type: 'object', optional: true, description: 'Scratchpad history' },
  ],
  outputs: [
    { name: 'evaluation', type: 'object', description: 'Evaluation result with isComplete, reason, nextSearchTerms' },
  ],
  properties: {
    minConfidence: 0.4,
    maxIterations: 7,
    repetitionThreshold: 0.8,
  },
  description: 'Decides if the train of thought should continue or conclude',
};

export const ThoughtAggregatorNode: NodeSchema = {
  id: 'thought_aggregator',
  name: 'Thought Aggregator',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'scratchpad', type: 'object', description: 'Scratchpad with all thoughts' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Consolidated chain, insight, summary, and thoughtCount' },
  ],
  properties: {
    summaryStyle: 'narrative', // 'narrative' | 'bullets' | 'insight'
    maxLength: 200,
  },
  description: 'Combines all thoughts into a coherent reasoning chain',
};

export const LoopMemorySearchNode: NodeSchema = {
  id: 'loop_memory_search',
  name: 'Loop Memory Search',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'searchTerms', type: 'array', description: 'Keywords to search for' },
    { name: 'seenIds', type: 'array', optional: true, description: 'Already seen memory IDs to exclude' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Found memories, memoryIds, searchTermsUsed' },
  ],
  properties: {
    maxResults: 3,
    excludeSeen: true,
  },
  description: 'Searches for memories based on keywords, avoiding already-seen memories',
};

export const AgentTriggerNode: NodeSchema = {
  id: 'agent_trigger',
  name: 'Agent Trigger',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'inputData', type: 'object', description: 'Data to pass to the triggered agent' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Triggered status and agent result' },
  ],
  properties: {
    agentName: '', // Name of agent to trigger
    waitForCompletion: true,
    timeout: 30000,
  },
  description: 'Triggers another agent/workflow from within a graph',
};

// ============================================================================
// CURATOR WORKFLOW NODES
// ============================================================================

export const UncuratedMemoryLoaderNode: NodeSchema = {
  id: 'uncurated_memory_loader',
  name: 'Load Uncurated Memories',
  category: 'memory',
  ...categoryColors.memory,
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Array of uncurated episodic memories' },
  ],
  properties: {
    limit: 5,
  },
  description: 'Loads episodic memories that have not been curated yet',
};

export const PersonaSummaryLoaderNode: NodeSchema = {
  id: 'persona_summary_loader',
  name: 'Load Persona Context',
  category: 'config',
  ...categoryColors.config,
  inputs: [],
  outputs: [
    { name: 'personaSummary', type: 'string', description: 'Persona identity summary for context' },
  ],
  properties: {},
  description: 'Loads persona identity summary to provide context for curation',
};

export const CuratorLLMNode: NodeSchema = {
  id: 'curator_llm',
  name: 'Curate Memories (LLM)',
  category: 'model',
  ...categoryColors.model,
  inputs: [
    { name: 'memories', type: 'array', description: 'Uncurated memories to process' },
    { name: 'personaSummary', type: 'string', description: 'Persona context', optional: true },
  ],
  outputs: [
    { name: 'curatedMemories', type: 'array', description: 'LLM-curated conversational exchanges' },
  ],
  properties: {
    temperature: 0.3,
    timeout: 300000,
  },
  description: 'Uses LLM to transform raw memories into conversational training data',
};

export const CuratedMemorySaverNode: NodeSchema = {
  id: 'curated_memory_saver',
  name: 'Save Curated Memories',
  category: 'memory',
  ...categoryColors.memory,
  inputs: [
    { name: 'curatedMemories', type: 'array', description: 'Curated memories to save' },
  ],
  outputs: [
    { name: 'savedCount', type: 'number', description: 'Number of memories saved' },
  ],
  properties: {},
  description: 'Saves curated memories to the training data directory',
};

export const TrainingPairGeneratorNode: NodeSchema = {
  id: 'training_pair_generator',
  name: 'Generate Training Pairs',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'curatedMemories', type: 'array', description: 'Curated conversational data' },
  ],
  outputs: [
    { name: 'trainingPairs', type: 'array', description: 'User/assistant message pairs for training' },
  ],
  properties: {},
  description: 'Converts curated memories into training pairs for fine-tuning',
};

export const TrainingPairAppenderNode: NodeSchema = {
  id: 'training_pair_appender',
  name: 'Append to JSONL',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'trainingPairs', type: 'array', description: 'Training pairs to append' },
  ],
  outputs: [
    { name: 'appendedCount', type: 'number', description: 'Number of pairs appended' },
  ],
  properties: {},
  description: 'Appends training pairs to the JSONL training data file',
};

export const MemoryMarkerNode: NodeSchema = {
  id: 'memory_marker',
  name: 'Mark as Curated',
  category: 'memory',
  ...categoryColors.memory,
  inputs: [
    { name: 'curatedMemories', type: 'array', description: 'Memories to mark as curated' },
  ],
  outputs: [
    { name: 'markedCount', type: 'number', description: 'Number of memories marked' },
  ],
  properties: {},
  description: 'Marks memories as curated to prevent reprocessing',
};

// ============================================================================
// DREAMER WORKFLOW NODES (Dream Generation and Overnight Learning)
// ============================================================================

export const DreamerMemoryCuratorNode: NodeSchema = {
  id: 'dreamer_memory_curator',
  name: 'Curate Dream Memories',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Array of curated memory objects' },
    { name: 'count', type: 'number', description: 'Number of memories curated' },
    { name: 'avgAgeDays', type: 'number', description: 'Average age of curated memories in days' },
    { name: 'oldestAgeDays', type: 'number', description: 'Age of oldest curated memory in days' },
    { name: 'username', type: 'string', description: 'User whose memories were curated' },
  ],
  properties: {
    sampleSize: 15,
    decayDays: 227, // ~20% weight at 1 year
  },
  description: 'Curates weighted sample of memories from entire lifetime using exponential decay. Older memories retain meaningful probability like human dream formation.',
};

export const DreamerDreamGeneratorNode: NodeSchema = {
  id: 'dreamer_dream_generator',
  name: 'Generate Dream',
  category: 'model',
  ...categoryColors.model,
  inputs: [
    { name: 'memories', type: 'array', description: 'Curated memory objects from dreamer_memory_curator' },
    { name: 'personaPrompt', type: 'string', optional: true, description: 'Formatted persona string from persona_formatter' },
  ],
  outputs: [
    { name: 'dream', type: 'string', description: 'Generated surreal dream narrative' },
    { name: 'memoryCount', type: 'number', description: 'Number of memories used' },
    { name: 'sourceIds', type: 'array', description: 'IDs of source memories' },
    { name: 'username', type: 'string', description: 'User for whom dream was generated' },
  ],
  properties: {
    temperature: 1.0, // Maximum creativity for dreams
    role: 'persona',
  },
  description: 'Generates surreal, metaphorical dream narratives from memory fragments using LLM. Dreams break logic and merge impossible things.',
};

export const DreamerDreamSaverNode: NodeSchema = {
  id: 'dreamer_dream_saver',
  name: 'Save Dream',
  category: 'memory',
  ...categoryColors.memory,
  inputs: [
    { name: 'dreamData', type: 'object', description: 'Object with dream text from dreamer_dream_generator' },
    { name: 'memoriesData', type: 'object', optional: true, description: 'Object with source memories for citations' },
  ],
  outputs: [
    { name: 'saved', type: 'boolean', description: 'Whether save was successful' },
    { name: 'eventId', type: 'string', description: 'ID of saved event' },
    { name: 'dream', type: 'string', description: 'The saved dream text' },
    { name: 'sourceCount', type: 'number', description: 'Number of source citations' },
    { name: 'username', type: 'string', description: 'User for whom dream was saved' },
  ],
  properties: {
    type: 'dream',
  },
  description: 'Saves generated dream to episodic memory and emits audit event for SSE streaming to web UI.',
};

export const DreamerContinuationGeneratorNode: NodeSchema = {
  id: 'dreamer_continuation_generator',
  name: 'Generate Continuation Dreams',
  category: 'model',
  ...categoryColors.model,
  inputs: [
    { name: 'previousDream', type: 'object', description: 'Object with dream text from previous node' },
  ],
  outputs: [
    { name: 'dreams', type: 'array', description: 'Array of continuation dreams' },
    { name: 'count', type: 'number', description: 'Number of continuations generated' },
    { name: 'username', type: 'string', description: 'User for whom dreams were generated' },
  ],
  properties: {
    temperature: 1.0,
    continuationChance: 0.75, // 75% probability to continue
    maxContinuations: 4,
    delaySeconds: 60, // Delay between continuations for streaming effect
  },
  description: 'Generates continuation dreams that build on previous dream narrative. Uses probability-based decision to continue or stop.',
};

export const DreamerLearningsExtractorNode: NodeSchema = {
  id: 'dreamer_learnings_extractor',
  name: 'Extract Learnings',
  category: 'agent',
  ...categoryColors.agent,
  inputs: [
    { name: 'memoriesData', type: 'object', description: 'Object with curated memories from dreamer_memory_curator' },
  ],
  outputs: [
    { name: 'preferences', type: 'array', description: 'Array of preference strings' },
    { name: 'heuristics', type: 'array', description: 'Array of decision heuristic strings' },
    { name: 'styleNotes', type: 'array', description: 'Array of style note strings' },
    { name: 'avoidances', type: 'array', description: 'Array of avoidance strings' },
    { name: 'memoryCount', type: 'number', description: 'Number of memories analyzed' },
    { name: 'username', type: 'string', description: 'User whose learnings were extracted' },
  ],
  properties: {
    temperature: 0.3,
    role: 'persona',
  },
  description: 'Extracts preferences, heuristics, style notes, and avoidances from memories using LLM analysis.',
};

export const DreamerLearningsWriterNode: NodeSchema = {
  id: 'dreamer_learnings_writer',
  name: 'Write Overnight Learnings',
  category: 'memory',
  ...categoryColors.memory,
  inputs: [
    { name: 'learningsData', type: 'object', description: 'Object with preferences, heuristics, etc from extractor' },
    { name: 'memoriesData', type: 'object', optional: true, description: 'Object with memories for citations' },
  ],
  outputs: [
    { name: 'written', type: 'boolean', description: 'Whether write was successful' },
    { name: 'filepath', type: 'string', description: 'Path to written file' },
    { name: 'filename', type: 'string', description: 'Name of written file' },
    { name: 'date', type: 'string', description: 'Date of learnings' },
    { name: 'username', type: 'string', description: 'User for whom learnings were written' },
  ],
  properties: {},
  description: 'Writes overnight learnings to procedural memory as markdown file for morning-loader agent.',
};

// Export all schemas as a registry
export const nodeSchemas: NodeSchema[] = [
  // Input
  MicInputNode,
  SpeechToTextNode,
  TextInputNode,
  UserInputNode,
  SessionContextNode,
  SystemSettingsNode,

  // Router
  CognitiveModeRouterNode,
  AuthCheckNode,
  OperatorEligibilityNode,
  SmartRouterNode,

  // Context
  ContextBuilderNode,
  SemanticSearchNode,
  ConversationHistoryNode,
  BufferManagerNode,

  // Operator
  ReActPlannerNode,
  SkillExecutorNode,
  ObservationFormatterNode,
  CompletionCheckerNode,
  ResponseSynthesizerNode,
  IterationCounterNode,
  ScratchpadCompletionCheckerNode,
  ScratchpadFormatterNode,

  // Chat
  PersonaLLMNode,
  OrchestratorLLMNode,
  ReflectorLLMNode,
  ChainOfThoughtStripperNode,
  SafetyValidatorNode,
  ResponseRefinerNode,

  // Model
  ModelResolverNode,
  ModelRouterNode,

  // Output
  MemoryCaptureNode,
  InnerDialogueCaptureNode,
  AuditLoggerNode,
  StreamWriterNode,
  ChatViewNode,
  TTSNode,

  // Skills
  FsReadNode,
  FsWriteNode,
  FsListNode,
  TaskCreateNode,
  TaskListNode,
  TaskUpdateNode,
  SearchIndexNode,
  WebSearchNode,
  ConversationalResponseNode,

  // Control Flow
  LoopControllerNode,
  ConditionalBranchNode,
  ConditionalRouterNode,
  ConditionalRerouteNode,
  SwitchNode,
  ForEachNode,

  // Memory Curation
  WeightedSamplerNode,
  AssociativeChainNode,
  MemoryFilterNode,
  MemoryRouterNode,

  // Utility
  JSONParserNode,
  TextTemplateNode,
  DataTransformNode,
  CacheNode,

  // Advanced Operator
  PlanParserNode,
  ScratchpadManagerNode,
  ErrorRecoveryNode,
  StuckDetectorNode,
  BigBrotherNode,
  BigBrotherRouterNode,
  BigBrotherExecutorNode,
  ClaudeFullTaskNode,

  // Agent
  MemoryLoaderNode,
  MemorySaverNode,
  LLMEnricherNode,
  AgentTimerNode,

  // Curiosity Service (User-Aware Question Generation)
  CuriosityWeightedSamplerNode,
  CuriosityQuestionGeneratorNode,
  CuriosityQuestionSaverNode,
  CuriosityActivityCheckNode,

  // Train of Thought (Recursive Reasoning)
  ScratchpadInitializerNode,
  ScratchpadUpdaterNode,
  ThoughtGeneratorNode,
  ThoughtEvaluatorNode,
  ThoughtAggregatorNode,
  LoopMemorySearchNode,
  AgentTriggerNode,

  // Curator Workflow
  UncuratedMemoryLoaderNode,
  PersonaSummaryLoaderNode,
  CuratorLLMNode,
  CuratedMemorySaverNode,
  TrainingPairGeneratorNode,
  TrainingPairAppenderNode,
  MemoryMarkerNode,

  // Dreamer Workflow (Dream Generation and Overnight Learning)
  DreamerMemoryCuratorNode,
  DreamerDreamGeneratorNode,
  DreamerDreamSaverNode,
  DreamerContinuationGeneratorNode,
  DreamerLearningsExtractorNode,
  DreamerLearningsWriterNode,

  // Configuration
  PersonaLoaderNode,
  PersonaFormatterNode,
  PersonaSaverNode,
  TrustLevelReaderNode,
  TrustLevelWriterNode,
  DecisionRulesLoaderNode,
  DecisionRulesSaverNode,
  IdentityExtractorNode,
  ValueManagerNode,
  GoalManagerNode,
];

// Helper to get schema by ID
export function getNodeSchema(id: string): NodeSchema | undefined {
  return nodeSchemas.find(schema => schema.id === id);
}

// Helper to get all schemas by category
export function getNodesByCategory(category: NodeCategory): NodeSchema[] {
  return nodeSchemas.filter(schema => schema.category === category);
}

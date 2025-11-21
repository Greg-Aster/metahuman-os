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

export interface NodeSchema {
  id: string;
  name: string;
  category: NodeCategory;
  color: string;
  bgColor: string;
  inputs: NodeSlot[];
  outputs: NodeSlot[];
  properties?: Record<string, any>;
  description: string;
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
    mode: 'narrative', // 'narrative' | 'structured' | 'verbatim'
  },
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
    style: 'default', // 'default' | 'strict' | 'summary'
  },
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
    { name: 'messages', type: 'array', description: 'Chat history' },
    { name: 'context', type: 'context', optional: true },
  ],
  outputs: [
    { name: 'response', type: 'llm_response' },
  ],
  properties: {
    model: 'persona',
    temperature: 0.8,
  },
  description: 'Generates response using persona model',
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
    style: 'default', // 'default' | 'strict' | 'summary'
  },
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
    filterType: null, // e.g., 'conversation', 'inner_dialogue'
    filterTags: [],
    startDate: null,
    endDate: null,
    limit: 100,
  },
  description: 'Filters memories by type, tags, or date range',
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
    ttl: 60000, // 1 minute in milliseconds
    operation: 'get', // get, set, clear, clear_all
  },
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
    { name: 'data', type: 'object', description: 'Data to append/update in scratchpad' },
  ],
  outputs: [
    { name: 'scratchpad', type: 'object', description: 'Updated scratchpad' },
  ],
  properties: {
    appendTo: 'thoughts', // Field to append to
    trackField: 'seenMemoryIds', // Field to track unique IDs
  },
  description: 'Updates scratchpad state by appending data to specified fields',
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

  // Context
  ContextBuilderNode,
  SemanticSearchNode,
  ConversationHistoryNode,

  // Operator
  ReActPlannerNode,
  SkillExecutorNode,
  ObservationFormatterNode,
  CompletionCheckerNode,
  ResponseSynthesizerNode,

  // Chat
  PersonaLLMNode,
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
  SwitchNode,
  ForEachNode,

  // Memory Curation
  WeightedSamplerNode,
  AssociativeChainNode,
  MemoryFilterNode,

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

  // Agent
  MemoryLoaderNode,
  MemorySaverNode,
  LLMEnricherNode,
  AgentTimerNode,

  // Train of Thought (Recursive Reasoning)
  ScratchpadInitializerNode,
  ScratchpadUpdaterNode,
  ThoughtGeneratorNode,
  ThoughtEvaluatorNode,
  ThoughtAggregatorNode,
  LoopMemorySearchNode,
  AgentTriggerNode,

  // Configuration
  PersonaLoaderNode,
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

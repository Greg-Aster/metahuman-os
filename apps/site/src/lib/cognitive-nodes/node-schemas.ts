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
  | 'output';

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
};

// ============================================================================
// INPUT NODES
// ============================================================================

export const UserInputNode: NodeSchema = {
  id: 'user_input',
  name: 'User Input',
  category: 'input',
  ...categoryColors.input,
  inputs: [],
  outputs: [
    { name: 'message', type: 'string', description: 'Raw user message text' },
    { name: 'sessionId', type: 'string', description: 'Session identifier' },
  ],
  properties: {
    message: '',
  },
  description: 'Entry point for user messages',
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
    { name: 'isSafe', type: 'boolean' },
    { name: 'issues', type: 'array', optional: true },
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
    { name: 'issues', type: 'array' },
  ],
  outputs: [
    { name: 'refined', type: 'string' },
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
  outputs: [],
  description: 'Streams response to client (terminal node)',
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

// Export all schemas as a registry
export const nodeSchemas: NodeSchema[] = [
  // Input
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
  ChainOfThoughtStripperNode,
  SafetyValidatorNode,
  ResponseRefinerNode,

  // Model
  ModelResolverNode,
  ModelRouterNode,

  // Output
  MemoryCaptureNode,
  AuditLoggerNode,
  StreamWriterNode,

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
];

// Helper to get schema by ID
export function getNodeSchema(id: string): NodeSchema | undefined {
  return nodeSchemas.find(schema => schema.id === id);
}

// Helper to get all schemas by category
export function getNodesByCategory(category: NodeCategory): NodeSchema[] {
  return nodeSchemas.filter(schema => schema.category === category);
}

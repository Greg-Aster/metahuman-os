/**
 * LiteGraph node registry and implementations
 *
 * This file registers all cognitive system nodes with LiteGraph
 * and implements their execution logic.
 */

// LiteGraph will be passed as a parameter to avoid SSR issues
// @ts-ignore
let LiteGraph: any;
// @ts-ignore
let LGraphNode: any;
import {
  nodeSchemas,
  type NodeSchema,
  ConversationHistoryNode,
  ObservationFormatterNode,
  CompletionCheckerNode,
  ResponseSynthesizerNode,
  ChainOfThoughtStripperNode,
  SafetyValidatorNode,
  ResponseRefinerNode,
  ModelRouterNode,
  AuditLoggerNode,
  FsWriteNode,
  FsListNode,
  TaskCreateNode,
  TaskUpdateNode,
  SearchIndexNode,
  WebSearchNode
} from './node-schemas';

/**
 * Factory function to create the base CognitiveNode class
 * This is called after LGraphNode is available
 */
function createCognitiveNodeClass(LGraphNodeRef: any) {
  return class CognitiveNode extends LGraphNodeRef {
    schema: NodeSchema;

    constructor(schema: NodeSchema) {
      super();
      this.schema = schema;
      this.title = schema.name;
      this.desc = schema.description;
      this.color = schema.color;
      this.bgcolor = schema.bgColor;

      // Add inputs
      schema.inputs.forEach((input: any) => {
        this.addInput(input.name, input.type);
      });

      // Add outputs
      schema.outputs.forEach((output: any) => {
        this.addOutput(output.name, output.type);
      });

      // Initialize properties
      if (schema.properties) {
        this.properties = { ...schema.properties };
      }
    }

    /**
     * Execute the node logic
     * Override this in subclasses for custom behavior
     */
    onExecute() {
      // Default: pass through first input to first output
      if (this.inputs.length > 0 && this.outputs.length > 0) {
        const value = this.getInputData(0);
        this.setOutputData(0, value);
      }
    }

    /**
     * Helper to get all input data as an object
     */
    getInputsData(): Record<string, any> {
      const data: Record<string, any> = {};
    this.schema.inputs.forEach((input, index) => {
      data[input.name] = this.getInputData(index);
    });
    return data;
  }

  /**
   * Helper to set all output data from an object
   */
  setOutputsData(data: Record<string, any>) {
    this.schema.outputs.forEach((output, index) => {
      if (data[output.name] !== undefined) {
        this.setOutputData(index, data[output.name]);
      }
    });
  }

  /**
   * Serialize node state
   */
  serialize(): any {
    const data = super.serialize();
    data.schema_id = this.schema.id;
    return data;
  }

  /**
   * Display node info in UI
   */
  getTitle(): string {
    return this.schema.name;
  }
  };
}

// ============================================================================
// NODE IMPLEMENTATION FACTORY
// ============================================================================

/**
 * Creates all node implementation classes dynamically
 * This must be called after LGraphNode is available
 */
function createNodeImplementations(CognitiveNodeBase: any) {

  // ============================================================================
  // INPUT NODE IMPLEMENTATIONS
  // ============================================================================

  class UserInputNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'user_input')!;

  constructor() {
    super(UserInputNodeImpl.schema);
    if (typeof (this as any).addWidget === 'function') {
      this.addWidget('text', 'message', this.properties.message, (value: string) => {
        this.properties.message = value;
      });
    }
  }

  onExecute() {
    this.setOutputData(0, this.properties.message);
    this.setOutputData(1, `session-${Date.now()}`); // Mock session ID
  }
}

class SessionContextNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'session_context')!;

  constructor() {
    super(SessionContextNodeImpl.schema);
  }

  onExecute() {
    const sessionId = this.getInputData(0);
    // Mock data - in real implementation, would fetch from API
    this.setOutputData(0, []); // conversation history
    this.setOutputData(1, { id: 'user-1', username: 'greggles', role: 'owner' });
  }
}

class SystemSettingsNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'system_settings')!;

  constructor() {
    super(SystemSettingsNodeImpl.schema);
  }

  onExecute() {
    // Mock data - in real implementation, would fetch from API
    this.setOutputData(0, 'dual'); // cognitive mode
    this.setOutputData(1, 'supervised_auto'); // trust level
    this.setOutputData(2, {}); // settings object
  }
}

// ============================================================================
// ROUTER NODE IMPLEMENTATIONS
// ============================================================================

class CognitiveModeRouterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'cognitive_mode_router')!;

  constructor() {
    super(CognitiveModeRouterNodeImpl.schema);
  }

  onExecute() {
    const mode = this.getInputData(0);

    // Output true/false for each route
    this.setOutputData(0, mode === 'dual');
    this.setOutputData(1, mode === 'agent');
    this.setOutputData(2, mode === 'emulation');
  }
}

class AuthCheckNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'auth_check')!;

  constructor() {
    super(AuthCheckNodeImpl.schema);
  }

  onExecute() {
    const user = this.getInputData(0);

    this.setOutputData(0, user && user.role !== 'anonymous');
    this.setOutputData(1, user?.role || 'anonymous');
  }
}

class OperatorEligibilityNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'operator_eligibility')!;

  constructor() {
    super(OperatorEligibilityNodeImpl.schema);
  }

  onExecute() {
    const mode = this.getInputData(0);
    const isAuth = this.getInputData(1);
    const message = this.getInputData(2);

    // Logic: dual always uses operator, emulation never, agent is conditional
    let useOperator = false;
    if (mode === 'dual' && isAuth) {
      useOperator = true;
    } else if (mode === 'agent' && isAuth) {
      // Simple heuristic: action verbs suggest operator use
      const actionWords = ['create', 'update', 'delete', 'search', 'find', 'list', 'show'];
      useOperator = actionWords.some(word => message?.toLowerCase().includes(word));
    }

    this.setOutputData(0, useOperator);
  }
}

// ============================================================================
// CONTEXT NODE IMPLEMENTATIONS
// ============================================================================

class ContextBuilderNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'context_builder')!;

  constructor() {
    super(ContextBuilderNodeImpl.schema);
  }

  async onExecute() {
    const inputs = this.getInputsData();

    // In real implementation, would call buildContextPackage()
    const contextPackage = {
      query: inputs.message,
      mode: inputs.cognitiveMode,
      memories: [],
      conversationHistory: inputs.conversationHistory || [],
      shortTermState: {},
    };

    this.setOutputData(0, contextPackage);
  }
}

class SemanticSearchNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'semantic_search')!;

  constructor() {
    super(SemanticSearchNodeImpl.schema);
  }

  async onExecute() {
    const query = this.getInputData(0);
    const threshold = this.getInputData(1) || this.properties.similarityThreshold;

    // In real implementation, would call semantic search API
    const memories: any[] = [];

    this.setOutputData(0, memories);
  }
}

// ============================================================================
// OPERATOR NODE IMPLEMENTATIONS
// ============================================================================

class ReActPlannerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'react_planner')!;

  constructor() {
    super(ReActPlannerNodeImpl.schema);
  }

  async onExecute() {
    const goal = this.getInputData(0);
    const context = this.getInputData(1);
    const scratchpad = this.getInputData(2) || [];

    // In real implementation, would call LLM for planning
    this.setOutputData(0, `Thinking about: ${goal}`);
    this.setOutputData(1, { skill: 'conversational_response', args: { message: goal } });
  }
}

class SkillExecutorNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'skill_executor')!;

  constructor() {
    super(SkillExecutorNodeImpl.schema);
  }

  async onExecute() {
    const skillName = this.getInputData(0);
    const args = this.getInputData(1);

    // In real implementation, would call executeSkill()
    try {
      const result = { output: `Executed ${skillName}`, data: args };
      this.setOutputData(0, result);
      this.setOutputData(1, true);
    } catch (error) {
      this.setOutputData(1, false);
      this.setOutputData(2, { message: (error as Error).message });
    }
  }
}

// ============================================================================
// CHAT NODE IMPLEMENTATIONS
// ============================================================================

class PersonaLLMNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'persona_llm')!;

  constructor() {
    super(PersonaLLMNodeImpl.schema);
  }

  async onExecute() {
    const messages = this.getInputData(0);
    const context = this.getInputData(1);

    // In real implementation, would call LLM
    const response = 'This is a mock persona response';

    this.setOutputData(0, response);
  }
}

// ============================================================================
// MODEL NODE IMPLEMENTATIONS
// ============================================================================

class ModelResolverNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'model_resolver')!;

  constructor() {
    super(ModelResolverNodeImpl.schema);
  }

  onExecute() {
    const role = this.getInputData(0);
    const mode = this.getInputData(1);

    // In real implementation, would call resolveModel()
    const config = {
      model: 'qwen3:14b',
      role,
      temperature: 0.7,
    };

    this.setOutputData(0, config);
  }
}

// ============================================================================
// OUTPUT NODE IMPLEMENTATIONS
// ============================================================================

class MemoryCaptureNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'memory_capture')!;

  constructor() {
    super(MemoryCaptureNodeImpl.schema);
  }

  async onExecute() {
    const inputs = this.getInputsData();

    // In real implementation, would call captureEvent()
    const eventPath = `memory/episodic/2025/2025-11-18-${Date.now()}.json`;

    this.setOutputData(0, eventPath);
  }
}

class StreamWriterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'stream_writer')!;

  constructor() {
    super(StreamWriterNodeImpl.schema);
  }

  onExecute() {
    const response = this.getInputData(0);

    // In real implementation, would stream to client
    console.log('[StreamWriter]', response);

    // Mark node as executed (visual feedback)
    this.boxcolor = '#2d5';
  }
}

// ============================================================================
// SKILL NODE IMPLEMENTATIONS
// ============================================================================

class FsReadNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'skill_fs_read')!;

  constructor() {
    super(FsReadNodeImpl.schema);
  }

  async onExecute() {
    const filePath = this.getInputData(0);

    try {
      // In real implementation, would call fs_read skill
      this.setOutputData(0, `Contents of ${filePath}`);
      this.setOutputData(1, true);
    } catch (error) {
      this.setOutputData(0, '');
      this.setOutputData(1, false);
    }
  }
}

class TaskListNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'skill_task_list')!;

  constructor() {
    super(TaskListNodeImpl.schema);
  }

  async onExecute() {
    // In real implementation, would call task_list skill
    const tasks = [
      { id: '1', title: 'Example task', status: 'active' },
    ];

    this.setOutputData(0, tasks);
  }
}

class ConversationalResponseNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'skill_conversational_response')!;

  constructor() {
    super(ConversationalResponseNodeImpl.schema);
  }

  async onExecute() {
    const message = this.getInputData(0);
    const context = this.getInputData(1);
    const style = this.getInputData(2) || this.properties.style;

    // In real implementation, would call conversational_response skill
    const response = `Response to: ${message}`;

    this.setOutputData(0, response);
  }
}

// ============================================================================
// Additional Node Implementations
// ============================================================================

class ConversationHistoryNodeImpl extends CognitiveNodeBase {
  constructor() { super(ConversationHistoryNode); }
}

class ObservationFormatterNodeImpl extends CognitiveNodeBase {
  constructor() { super(ObservationFormatterNode); }
}

class CompletionCheckerNodeImpl extends CognitiveNodeBase {
  constructor() { super(CompletionCheckerNode); }
}

class ResponseSynthesizerNodeImpl extends CognitiveNodeBase {
  constructor() { super(ResponseSynthesizerNode); }
}

class ChainOfThoughtStripperNodeImpl extends CognitiveNodeBase {
  constructor() { super(ChainOfThoughtStripperNode); }
}

class SafetyValidatorNodeImpl extends CognitiveNodeBase {
  constructor() { super(SafetyValidatorNode); }
}

class ResponseRefinerNodeImpl extends CognitiveNodeBase {
  constructor() { super(ResponseRefinerNode); }
}

class ModelRouterNodeImpl extends CognitiveNodeBase {
  constructor() { super(ModelRouterNode); }
}

class AuditLoggerNodeImpl extends CognitiveNodeBase {
  constructor() { super(AuditLoggerNode); }
}

class FsWriteNodeImpl extends CognitiveNodeBase {
  constructor() { super(FsWriteNode); }
}

class FsListNodeImpl extends CognitiveNodeBase {
  constructor() { super(FsListNode); }
}

class TaskCreateNodeImpl extends CognitiveNodeBase {
  constructor() { super(TaskCreateNode); }
}

class TaskUpdateNodeImpl extends CognitiveNodeBase {
  constructor() { super(TaskUpdateNode); }
}

class SearchIndexNodeImpl extends CognitiveNodeBase {
  constructor() { super(SearchIndexNode); }
}

class WebSearchNodeImpl extends CognitiveNodeBase {
  constructor() { super(WebSearchNode); }
}

  // Return all node implementation classes
  return {
    UserInputNodeImpl,
    SessionContextNodeImpl,
    SystemSettingsNodeImpl,
    CognitiveModeRouterNodeImpl,
    AuthCheckNodeImpl,
    OperatorEligibilityNodeImpl,
    ContextBuilderNodeImpl,
    SemanticSearchNodeImpl,
    ConversationHistoryNodeImpl,
    ReActPlannerNodeImpl,
    SkillExecutorNodeImpl,
    ObservationFormatterNodeImpl,
    CompletionCheckerNodeImpl,
    ResponseSynthesizerNodeImpl,
    PersonaLLMNodeImpl,
    ChainOfThoughtStripperNodeImpl,
    SafetyValidatorNodeImpl,
    ResponseRefinerNodeImpl,
    ModelResolverNodeImpl,
    ModelRouterNodeImpl,
    MemoryCaptureNodeImpl,
    AuditLoggerNodeImpl,
    StreamWriterNodeImpl,
    FsReadNodeImpl,
    FsWriteNodeImpl,
    FsListNodeImpl,
    TaskCreateNodeImpl,
    TaskListNodeImpl,
    TaskUpdateNodeImpl,
    SearchIndexNodeImpl,
    WebSearchNodeImpl,
    ConversationalResponseNodeImpl,
  };
}

// ============================================================================
// REGISTRATION FUNCTION
// ============================================================================

/**
 * Register all cognitive nodes with LiteGraph
 * Call this before creating the graph
 * @param LiteGraphRef - The LiteGraph library instance
 */
export function registerCognitiveNodes(LiteGraphRef?: any, LGraphNodeRef?: any) {
  // Set the global references for this module
  if (LiteGraphRef) {
    LiteGraph = LiteGraphRef;
    LGraphNode = LGraphNodeRef;
  }

  console.log('[CognitiveNodes] Registration starting...', {
    hasLiteGraph: !!LiteGraph,
    hasLGraphNode: !!LGraphNode,
    hasRegisterMethod: typeof LiteGraph?.registerNodeType === 'function'
  });

  // Create the base class and all node implementations
  const CognitiveNodeBase = createCognitiveNodeClass(LGraphNode);
  const nodeImpls = createNodeImplementations(CognitiveNodeBase);

  console.log('[CognitiveNodes] Created node implementations:', Object.keys(nodeImpls).length);

  try {
    // Test registration with first node
    console.log('[CognitiveNodes] Testing registration with user_input node...');
    console.log('[CognitiveNodes] Before registration, registered_node_types:', LiteGraph.registered_node_types);
    LiteGraph.registerNodeType('cognitive/user_input', nodeImpls.UserInputNodeImpl);
    console.log('[CognitiveNodes] After first registration, registered_node_types:', LiteGraph.registered_node_types);

    // Input nodes
    LiteGraph.registerNodeType('cognitive/session_context', nodeImpls.SessionContextNodeImpl);
    LiteGraph.registerNodeType('cognitive/system_settings', nodeImpls.SystemSettingsNodeImpl);

    // Router nodes
    LiteGraph.registerNodeType('cognitive/cognitive_mode_router', nodeImpls.CognitiveModeRouterNodeImpl);
    LiteGraph.registerNodeType('cognitive/auth_check', nodeImpls.AuthCheckNodeImpl);
    LiteGraph.registerNodeType('cognitive/operator_eligibility', nodeImpls.OperatorEligibilityNodeImpl);

    // Context nodes
    LiteGraph.registerNodeType('cognitive/context_builder', nodeImpls.ContextBuilderNodeImpl);
    LiteGraph.registerNodeType('cognitive/semantic_search', nodeImpls.SemanticSearchNodeImpl);
    LiteGraph.registerNodeType('cognitive/conversation_history', nodeImpls.ConversationHistoryNodeImpl);

    // Operator nodes
    LiteGraph.registerNodeType('cognitive/react_planner', nodeImpls.ReActPlannerNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_executor', nodeImpls.SkillExecutorNodeImpl);
    LiteGraph.registerNodeType('cognitive/observation_formatter', nodeImpls.ObservationFormatterNodeImpl);
    LiteGraph.registerNodeType('cognitive/completion_checker', nodeImpls.CompletionCheckerNodeImpl);
    LiteGraph.registerNodeType('cognitive/response_synthesizer', nodeImpls.ResponseSynthesizerNodeImpl);

    // Chat nodes
    LiteGraph.registerNodeType('cognitive/persona_llm', nodeImpls.PersonaLLMNodeImpl);
    LiteGraph.registerNodeType('cognitive/chain_of_thought_stripper', nodeImpls.ChainOfThoughtStripperNodeImpl);
    LiteGraph.registerNodeType('cognitive/safety_validator', nodeImpls.SafetyValidatorNodeImpl);
    LiteGraph.registerNodeType('cognitive/response_refiner', nodeImpls.ResponseRefinerNodeImpl);

    // Model nodes
    LiteGraph.registerNodeType('cognitive/model_resolver', nodeImpls.ModelResolverNodeImpl);
    LiteGraph.registerNodeType('cognitive/model_router', nodeImpls.ModelRouterNodeImpl);

    // Output nodes
    LiteGraph.registerNodeType('cognitive/memory_capture', nodeImpls.MemoryCaptureNodeImpl);
    LiteGraph.registerNodeType('cognitive/audit_logger', nodeImpls.AuditLoggerNodeImpl);
    LiteGraph.registerNodeType('cognitive/stream_writer', nodeImpls.StreamWriterNodeImpl);

    // Skill nodes
    LiteGraph.registerNodeType('cognitive/skill_fs_read', nodeImpls.FsReadNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_fs_write', nodeImpls.FsWriteNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_fs_list', nodeImpls.FsListNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_task_create', nodeImpls.TaskCreateNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_task_list', nodeImpls.TaskListNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_task_update', nodeImpls.TaskUpdateNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_search_index', nodeImpls.SearchIndexNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_web_search', nodeImpls.WebSearchNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_conversational_response', nodeImpls.ConversationalResponseNodeImpl);

    console.log('[CognitiveNodes] Registration completed successfully');
  } catch (error) {
    console.error('[CognitiveNodes] Registration error:', error);
    throw error;
  }

  const registeredTypes = LiteGraph?.registered_node_types
    ? Object.keys(LiteGraph.registered_node_types).filter(k => k.startsWith('cognitive/'))
    : [];
  console.log('[CognitiveNodes] Registered', registeredTypes.length, 'node types');
  console.log('[CognitiveNodes] All registered types:',
    LiteGraph?.registered_node_types ? Object.keys(LiteGraph.registered_node_types) : 'N/A'
  );
}

/**
 * Get list of all registered cognitive nodes for the UI
 */
export function getCognitiveNodesList() {
  return nodeSchemas.map(schema => ({
    type: `cognitive/${schema.id}`,
    name: schema.name,
    category: schema.category,
    description: schema.description,
  }));
}

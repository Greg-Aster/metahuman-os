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
  TextInputNode,
  ConversationHistoryNode,
  BufferManagerNode,
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
  WebSearchNode,
  ChatViewNode,
  TTSNode,
  OrchestratorLLMNode,
  PersonaFormatterNode,
  IterationCounterNode,
  ScratchpadCompletionCheckerNode,
  ScratchpadFormatterNode,
  CuriosityWeightedSamplerNode,
  CuriosityQuestionGeneratorNode,
  CuriosityQuestionSaverNode,
  CuriosityActivityCheckNode,
  SmartRouterNode,
  UncuratedMemoryLoaderNode,
  PersonaSummaryLoaderNode,
  CuratorLLMNode,
  CuratedMemorySaverNode,
  TrainingPairGeneratorNode,
  TrainingPairAppenderNode,
  MemoryMarkerNode,
  BigBrotherNode
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

  class MicInputNodeImpl extends CognitiveNodeBase {
    static schema = nodeSchemas.find((s) => s.id === 'mic_input')!;

    constructor() {
      super(MicInputNodeImpl.schema);
    }

    onExecute() {
      // Captures audio from microphone
      // In browser, this would interface with Web Audio API
      this.setOutputData(0, null); // audioBuffer (null in visual editor)
      this.setOutputData(1, false); // isRecording = false
    }
  }

  class SpeechToTextNodeImpl extends CognitiveNodeBase {
    static schema = nodeSchemas.find((s) => s.id === 'speech_to_text')!;

    constructor() {
      super(SpeechToTextNodeImpl.schema);
    }

    onExecute() {
      // Converts audio buffer to text using speech recognition
      // In real execution, this would call Whisper or browser SpeechRecognition API
      this.setOutputData(0, ''); // Empty text (placeholder in visual editor)
      this.setOutputData(1, false); // isProcessing = false
    }
  }

  class TextInputNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'text_input')!;

  constructor() {
    super(TextInputNodeImpl.schema);
  }

  onExecute() {
    // This node is a gateway - it signals to the system that text input is needed
    // In the real execution context, this will read from the chat interface
    // For visual editor, we show it's ready
    this.setOutputData(0, ''); // Empty text (will be populated from chat interface at runtime)
    this.setOutputData(1, true); // hasTextInput = true
  }
}

class UserInputNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'user_input')!;

  constructor() {
    super(UserInputNodeImpl.schema);
    if (typeof (this as any).addWidget === 'function') {
      this.addWidget('text', 'message', this.properties.message, (value: string) => {
        this.properties.message = value;
      });
      this.addWidget('toggle', 'prioritizeChatInterface', this.properties.prioritizeChatInterface, (value: boolean) => {
        this.properties.prioritizeChatInterface = value;
      });
    }
  }

  onExecute() {
    // Priority logic:
    // 1. If prioritizeChatInterface is true (default), use properties.message (from chat context)
    // 2. Otherwise, check inputs: speech first, then text

    let message = '';
    let inputSource = 'chat';

    if (this.properties.prioritizeChatInterface) {
      // Use chat interface (context will provide this at runtime)
      message = this.properties.message || '';
      inputSource = 'chat';
    } else {
      // Check inputs
      const speechInput = this.getInputData(0);
      const textInput = this.getInputData(1);

      if (speechInput?.text && speechInput?.transcribed) {
        message = speechInput.text;
        inputSource = 'speech';
      } else if (textInput) {
        message = textInput;
        inputSource = 'text';
      } else {
        message = this.properties.message || '';
        inputSource = 'chat';
      }
    }

    this.setOutputData(0, message);
    this.setOutputData(1, inputSource);
    this.setOutputData(2, `session-${Date.now()}`); // Mock session ID
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

class SmartRouterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'smart_router')!;

  constructor() {
    super(SmartRouterNodeImpl.schema);
  }

  onExecute() {
    const orchestratorAnalysis = this.getInputData(0);

    // Extract complexity and other metadata from orchestrator analysis
    const complexity = orchestratorAnalysis?.complexity || 0.5;
    const needsMemory = orchestratorAnalysis?.needsMemory || false;
    const simpleThreshold = this.properties.simpleThreshold || 0.3;

    // Route based on complexity threshold
    const isSimple = complexity < simpleThreshold && !needsMemory;

    if (isSimple) {
      // Simple path: Output on slot 1 (simplePath)
      this.setOutputData(0, null); // complexPath = null
      this.setOutputData(1, orchestratorAnalysis); // simplePath = analysis
    } else {
      // Complex path: Output on slot 0 (complexPath)
      this.setOutputData(0, orchestratorAnalysis); // complexPath = analysis
      this.setOutputData(1, null); // simplePath = null
    }
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

class BufferManagerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'buffer_manager')!;

  constructor() {
    super(BufferManagerNodeImpl.schema);
  }

  async onExecute() {
    const messages = this.getInputData(0);

    // In real implementation, would call bufferManagerExecutor to persist conversation buffer
    const result = {
      persisted: true,
      mode: 'conversation',
      messageCount: messages?.length || 0,
    };

    this.setOutputData(0, result);
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
    const personaText = this.getInputData(0);
    const conversationHistory = this.getInputData(1);
    const memories = this.getInputData(2);
    const orchestratorData = this.getInputData(3);

    // In real implementation, would call LLM with formatted persona, history, memories, and orchestrator instructions
    const response = 'This is a mock persona response';

    this.setOutputData(0, response);
  }
}

class OrchestratorLLMNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'orchestrator_llm')!;

  constructor() {
    super(OrchestratorLLMNodeImpl.schema);
  }

  async onExecute() {
    const userMessage = this.getInputData(0);

    // In real implementation, would call orchestratorLLMExecutor
    const decision = {
      needsMemory: false,
      responseStyle: 'conversational',
      instructions: 'Respond naturally to the greeting.',
    };

    this.setOutputData(0, decision);
  }
}

class ReflectorLLMNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'reflector_llm')!;

  constructor() {
    super(ReflectorLLMNodeImpl.schema);
  }

  async onExecute() {
    const prompt = this.getInputData(0);

    // In real implementation, would call reflectorLLMExecutor
    const response = 'This is a mock reflector response';

    this.setOutputData(0, response);
  }
}

class InnerDialogueCaptureNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'inner_dialogue_capture')!;

  constructor() {
    super(InnerDialogueCaptureNodeImpl.schema);
  }

  async onExecute() {
    const text = this.getInputData(0);
    const metadata = this.getInputData(1);

    // In real implementation, would call innerDialogueCaptureExecutor
    const result = {
      saved: true,
      type: 'inner_dialogue',
      eventPath: 'memory/episodic/mock-path.json',
      textLength: text?.length || 0,
    };

    this.setOutputData(0, result);
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

    // Output the response for chaining to chat view
    this.setOutputData(0, response);

    // Mark node as executed (visual feedback)
    this.boxcolor = '#2d5';
  }
}

class ChatViewNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'chat_view')!;

  constructor() {
    super(ChatViewNodeImpl.schema);

    // Add mode selector widget
    if (typeof (this as any).addWidget === 'function') {
      this.addWidget('combo', 'mode', this.properties.mode, (value: string) => {
        this.properties.mode = value;
      }, { values: ['direct', 'trigger'] });

      this.addWidget('number', 'maxMessages', this.properties.maxMessages, (value: number) => {
        this.properties.maxMessages = value;
      });
    }

    // Set custom size for visual display
    this.size = [300, 200];
  }

  onExecute() {
    const mode = this.properties.mode || 'direct';
    const directMessage = this.getInputData(0);
    const trigger = this.getInputData(1);

    if (mode === 'direct' && directMessage) {
      // Display direct message
      this.displayMessage(directMessage);
    } else if (mode === 'trigger' && trigger) {
      // Trigger mode: refresh from conversation history
      // In a real implementation, this would fetch from the conversation API
      this.displayMessage(`[Trigger received: ${typeof trigger}]`);
    }

    // Mark as executed
    this.boxcolor = mode === 'direct' && directMessage ? '#2d5' : '#555';
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    if (!this.flags.collapsed) {
      // Draw chat messages inside the node
      const message = this.getInputData(0);
      if (message) {
        ctx.save();
        ctx.fillStyle = '#ddd';
        ctx.font = '12px monospace';

        // Word wrap the message
        const maxWidth = this.size[0] - 20;
        const lines = this.wrapText(ctx, message, maxWidth);
        const maxMessages = Math.min(lines.length, this.properties.maxMessages || 5);

        let y = 60;
        for (let i = 0; i < maxMessages; i++) {
          ctx.fillText(lines[i], 10, y);
          y += 16;
        }

        if (lines.length > maxMessages) {
          ctx.fillStyle = '#888';
          ctx.fillText(`... (${lines.length - maxMessages} more lines)`, 10, y);
        }

        ctx.restore();
      }
    }
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  private displayMessage(message: string) {
    // Store for rendering
    this.title = `Chat View (${this.properties.mode})`;

    // Trigger redraw
    if (this.graph && (this.graph as any).canvas) {
      (this.graph as any).canvas.setDirty(true, true);
    }
  }

  getTitle(): string {
    return `Chat View (${this.properties.mode || 'direct'})`;
  }
}

class TTSNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'tts')!;
  private currentAudio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private isPlaying = false;

  constructor() {
    super(TTSNodeImpl.schema);

    // Add provider widget
    if (typeof (this as any).addWidget === 'function') {
      this.addWidget('text', 'provider', this.properties.provider || '', (value: string) => {
        this.properties.provider = value;
      });

      this.addWidget('toggle', 'autoPlay', this.properties.autoPlay !== false, (value: boolean) => {
        this.properties.autoPlay = value;
      });
    }
  }

  onExecute() {
    const text = this.getInputData(0);

    if (!text || typeof text !== 'string') {
      this.boxcolor = '#555';
      return;
    }

    // Only play if autoPlay is enabled
    if (this.properties.autoPlay !== false) {
      this.speakText(text);
    }
  }

  async speakText(text: string) {
    // Stop any currently playing audio
    this.stopAudio();

    this.isPlaying = true;
    this.boxcolor = '#25d'; // Blue while processing

    try {
      // Use exact same TTS API call as ChatInterface.svelte
      const ttsBody: any = { text };

      // Include provider if specified
      if (this.properties.provider && this.properties.provider.trim() !== '') {
        ttsBody.provider = this.properties.provider;
      }

      console.log('[TTS Node] Fetching TTS from /api/tts...');

      const ttsRes = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ttsBody),
      });

      if (!ttsRes.ok) {
        console.warn('[TTS Node] TTS request failed:', ttsRes.status);
        this.boxcolor = '#d52'; // Red for error
        this.isPlaying = false;
        return;
      }

      const blob = await ttsRes.blob();
      const url = URL.createObjectURL(blob);
      this.currentObjectUrl = url;

      // Create and play audio (same as ChatInterface.svelte)
      const audio = new Audio(url);
      this.currentAudio = audio;

      const cleanup = () => {
        this.stopAudio();
        this.isPlaying = false;
        this.boxcolor = '#2d5'; // Green when complete
      };

      audio.onended = cleanup;
      audio.onerror = cleanup;

      this.boxcolor = '#2d5'; // Green while playing

      await audio.play().catch((err) => {
        console.warn('[TTS Node] Audio playback failed:', err);
        cleanup();
      });

    } catch (e) {
      console.error('[TTS Node] Error:', e);
      this.boxcolor = '#d52'; // Red for error
      this.isPlaying = false;
    }
  }

  stopAudio() {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
      } catch {}
      this.currentAudio = null;
    }
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }

  onRemoved() {
    // Clean up when node is removed from graph
    this.stopAudio();
  }

  getTitle(): string {
    return this.isPlaying ? 'TTS (Playing...)' : 'Text to Speech';
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

class IterationCounterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'iteration_counter')!;

  constructor() {
    super(IterationCounterNodeImpl.schema);
  }

  onExecute() {
    const scratchpad = this.getInputData(0);
    const loopBack = this.getInputData(1);

    // Use loop-back data if available, otherwise use initial scratchpad
    const data = loopBack || scratchpad || {};
    const iteration = data.iteration || 0;
    const maxIterations = this.properties.maxIterations || 10;

    this.setOutputData(0, {
      iteration,
      maxIterations,
      scratchpad: data.scratchpad || [],
    });
  }
}

class ScratchpadCompletionCheckerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'scratchpad_completion_checker')!;

  constructor() {
    super(ScratchpadCompletionCheckerNodeImpl.schema);
  }

  onExecute() {
    const scratchpadData = this.getInputData(0) || {};
    const scratchpad = scratchpadData.scratchpad || [];
    const iteration = scratchpadData.iteration || 0;
    const maxIterations = scratchpadData.maxIterations || 10;

    // Check for completion
    const latestEntry = scratchpad[scratchpad.length - 1] || {};
    const combinedText = `${latestEntry.thought || ''} ${latestEntry.observation || ''}`;
    const hasFinalAnswer = /Final Answer:|FINAL_ANSWER|Task Complete/i.test(combinedText);
    const hasExceededMax = iteration >= maxIterations;

    const isComplete = hasFinalAnswer || hasExceededMax;

    this.setOutputData(0, {
      isComplete,
      reason: hasFinalAnswer ? 'Final answer detected' : hasExceededMax ? 'Max iterations reached' : 'Continue',
      scratchpad: scratchpadData,
    });
  }
}

class ScratchpadFormatterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'scratchpad_formatter')!;

  constructor() {
    super(ScratchpadFormatterNodeImpl.schema);
  }

  onExecute() {
    const scratchpadData = this.getInputData(0) || {};
    const scratchpad = scratchpadData.scratchpad || [];
    const format = this.properties.format || 'text';

    let formatted = '';
    if (format === 'json') {
      formatted = JSON.stringify(scratchpad, null, 2);
    } else if (format === 'markdown') {
      formatted = scratchpad
        .map((entry: any, idx: number) =>
          `### Iteration ${idx + 1}\n\n**Thought:** ${entry.thought}\n\n**Action:** ${entry.action}\n\n**Observation:** ${entry.observation}\n`
        )
        .join('\n---\n\n');
    } else {
      formatted = scratchpad
        .map((entry: any) => `Thought: ${entry.thought}\nAction: ${entry.action}\nObservation: ${entry.observation}`)
        .join('\n\n');
    }

    this.setOutputData(0, formatted);
  }
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

// ============================================================================
// Control Flow Node Implementations
// ============================================================================

class LoopControllerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'loop_controller')!;
  constructor() { super(LoopControllerNodeImpl.schema); }
}

class ConditionalBranchNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'conditional_branch')!;
  constructor() { super(ConditionalBranchNodeImpl.schema); }
}

class ConditionalRouterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'conditional_router')!;
  constructor() { super(ConditionalRouterNodeImpl.schema); }
  onExecute() {
    const condition = this.getInputData(0);
    const trueData = this.getInputData(1);
    const falseData = this.getInputData(2);
    const conditionMet = condition?.isComplete || condition?.isDone || condition?.shouldContinue || Boolean(condition);
    this.setOutputData(0, conditionMet ? trueData : null); // exitOutput
    this.setOutputData(1, conditionMet ? null : falseData); // loopOutput
  }
}

class SwitchNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'switch')!;
  constructor() { super(SwitchNodeImpl.schema); }
}

class ForEachNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'for_each')!;
  constructor() { super(ForEachNodeImpl.schema); }
}

// ============================================================================
// Memory Curation Node Implementations
// ============================================================================

class WeightedSamplerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'weighted_sampler')!;
  constructor() { super(WeightedSamplerNodeImpl.schema); }
}

class AssociativeChainNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'associative_chain')!;
  constructor() { super(AssociativeChainNodeImpl.schema); }
}

class MemoryFilterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'memory_filter')!;
  constructor() { super(MemoryFilterNodeImpl.schema); }
}

// ============================================================================
// Utility Node Implementations
// ============================================================================

class JSONParserNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'json_parser')!;
  constructor() { super(JSONParserNodeImpl.schema); }
}

class TextTemplateNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'text_template')!;
  constructor() { super(TextTemplateNodeImpl.schema); }
}

class DataTransformNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'data_transform')!;
  constructor() { super(DataTransformNodeImpl.schema); }
}

class CacheNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'cache')!;
  constructor() { super(CacheNodeImpl.schema); }
}

// ============================================================================
// Advanced Operator Node Implementations
// ============================================================================

class PlanParserNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'plan_parser')!;
  constructor() { super(PlanParserNodeImpl.schema); }
}

class ScratchpadManagerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'scratchpad_manager')!;
  constructor() { super(ScratchpadManagerNodeImpl.schema); }
}

class ErrorRecoveryNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'error_recovery')!;
  constructor() { super(ErrorRecoveryNodeImpl.schema); }
}

class StuckDetectorNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'stuck_detector')!;
  constructor() { super(StuckDetectorNodeImpl.schema); }
}

class BigBrotherNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'big_brother')!;

  constructor() {
    super(BigBrotherNodeImpl.schema);
  }

  async onExecute() {
    const goal = this.getInputData(0);
    const scratchpad = this.getInputData(1);
    const errorType = this.getInputData(2);
    const context = this.getInputData(3);

    if (!goal || !scratchpad) {
      this.setOutputData(0, []);
      this.setOutputData(1, 'Missing required inputs');
      this.setOutputData(2, '');
      this.setOutputData(3, false);
      this.boxcolor = '#d52'; // Red for error
      return;
    }

    try {
      this.boxcolor = '#25d'; // Blue while processing

      // Call the Big Brother executor
      const response = await fetch('/api/big-brother-escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal,
          scratchpad,
          errorType,
          context,
          stuckReason: context?.reason || 'Unknown',
          suggestions: context?.suggestions || []
        })
      });

      if (!response.ok) {
        throw new Error(`Big Brother escalation failed: ${response.statusText}`);
      }

      const data = await response.json();

      this.setOutputData(0, data.suggestions || []);
      this.setOutputData(1, data.reasoning || '');
      this.setOutputData(2, data.alternativeApproach || '');
      this.setOutputData(3, data.success || false);

      this.boxcolor = data.success ? '#2d5' : '#d52'; // Green if success, red if failed
    } catch (error) {
      console.error('[BigBrotherNode] Error:', error);
      this.setOutputData(0, []);
      this.setOutputData(1, (error as Error).message);
      this.setOutputData(2, '');
      this.setOutputData(3, false);
      this.boxcolor = '#d52'; // Red for error
    }
  }
}

// ============================================================================
// AGENT NODE IMPLEMENTATIONS
// ============================================================================

class MemoryLoaderNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'memory_loader')!;
  constructor() { super(MemoryLoaderNodeImpl.schema); }
}

class MemorySaverNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'memory_saver')!;
  constructor() { super(MemorySaverNodeImpl.schema); }
}

class LLMEnricherNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'llm_enricher')!;
  constructor() { super(LLMEnricherNodeImpl.schema); }
}

class AgentTimerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'agent_timer')!;
  constructor() { super(AgentTimerNodeImpl.schema); }
}

// ============================================================================
// CURIOSITY SERVICE NODE IMPLEMENTATIONS
// ============================================================================

class CuriosityWeightedSamplerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'curiosity_weighted_sampler')!;
  constructor() { super(CuriosityWeightedSamplerNodeImpl.schema); }
}

class CuriosityQuestionGeneratorNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'curiosity_question_generator')!;
  constructor() { super(CuriosityQuestionGeneratorNodeImpl.schema); }
}

class CuriosityQuestionSaverNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'curiosity_question_saver')!;
  constructor() { super(CuriosityQuestionSaverNodeImpl.schema); }
}

class CuriosityActivityCheckNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'curiosity_activity_check')!;
  constructor() { super(CuriosityActivityCheckNodeImpl.schema); }
}

// ============================================================================
// CONFIGURATION NODE IMPLEMENTATIONS
// ============================================================================

class PersonaLoaderNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'persona_loader')!;

  constructor() {
    super(PersonaLoaderNodeImpl.schema);
  }

  onExecute() {
    // In real implementation, would call personaLoaderExecutor
    // Mock persona data for visual editor
    const personaData = {
      persona: {
        personality: { traits: ['curious', 'analytical', 'helpful'] },
      },
      identity: {
        name: 'Greg',
        role: 'AI Researcher',
        purpose: 'To assist and learn',
      },
      values: {
        core: [
          { value: 'transparency' },
          { value: 'growth' },
          { value: 'creativity' },
        ],
      },
      goals: {
        shortTerm: [
          { goal: 'Build amazing AI systems' },
        ],
      },
      activeFacet: 'default',
    };

    this.setOutputData(0, personaData);
  }
}

class PersonaFormatterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'persona_formatter')!;

  constructor() {
    super(PersonaFormatterNodeImpl.schema);
  }

  onExecute() {
    const personaData = this.getInputData(0);

    // In real implementation, would call personaFormatterExecutor
    const formatted = {
      formatted: 'You are Greg, an AI researcher and developer.',
      success: true,
      characterCount: 43,
    };

    this.setOutputData(0, formatted);
  }
}

class PersonaSaverNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'persona_saver')!;
  constructor() { super(PersonaSaverNodeImpl.schema); }
}

class TrustLevelReaderNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'trust_level_reader')!;
  constructor() { super(TrustLevelReaderNodeImpl.schema); }
}

class TrustLevelWriterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'trust_level_writer')!;
  constructor() { super(TrustLevelWriterNodeImpl.schema); }
}

class DecisionRulesLoaderNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'decision_rules_loader')!;
  constructor() { super(DecisionRulesLoaderNodeImpl.schema); }
}

class DecisionRulesSaverNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'decision_rules_saver')!;
  constructor() { super(DecisionRulesSaverNodeImpl.schema); }
}

class IdentityExtractorNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'identity_extractor')!;
  constructor() { super(IdentityExtractorNodeImpl.schema); }
}

class ValueManagerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'value_manager')!;
  constructor() { super(ValueManagerNodeImpl.schema); }
}

class GoalManagerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'goal_manager')!;
  constructor() { super(GoalManagerNodeImpl.schema); }
}

// ============================================================================
// TRAIN OF THOUGHT NODE IMPLEMENTATIONS
// ============================================================================

class ScratchpadInitializerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'scratchpad_initializer')!;
  constructor() { super(ScratchpadInitializerNodeImpl.schema); }
  onExecute() {
    const seedMemory = this.getInputData(0) || '';
    const fields = this.properties?.fields || ['thoughts', 'keywords', 'seenMemoryIds'];
    const scratchpad: Record<string, any> = { seedMemory };
    fields.forEach((f: string) => { scratchpad[f] = []; });
    this.setOutputData(0, scratchpad);
  }
}

class ScratchpadUpdaterNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'scratchpad_updater')!;

  constructor() {
    super(ScratchpadUpdaterNodeImpl.schema);
  }

  onExecute() {
    const iterationData = this.getInputData(0) || {};
    const observation = this.getInputData(1) || '';
    const plan = this.getInputData(2) || {};

    const iteration = iterationData.iteration || 0;
    const maxIterations = iterationData.maxIterations || 10;
    const scratchpad = iterationData.scratchpad || [];

    // Add new entry to scratchpad
    const newEntry = {
      thought: plan.thought || '',
      action: plan.action || '',
      observation,
    };

    const updatedScratchpad = [...scratchpad, newEntry];

    this.setOutputData(0, {
      iteration: iteration + 1,
      maxIterations,
      scratchpad: updatedScratchpad,
    });
  }
}

class ThoughtGeneratorNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'thought_generator')!;
  constructor() { super(ThoughtGeneratorNodeImpl.schema); }
  onExecute() {
    const context = this.getInputData(0) || {};
    const seedMemory = this.getInputData(1) || context.seedMemory || '';
    // In visual editor, show placeholder
    this.setOutputData(0, {
      thought: '[Generated thought will appear here]',
      thoughts: context.thoughts || [],
      keywords: [],
      confidence: 0.5,
      seedMemory,
    });
  }
}

class ThoughtEvaluatorNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'thought_evaluator')!;
  constructor() { super(ThoughtEvaluatorNodeImpl.schema); }
  onExecute() {
    const thought = this.getInputData(0) || {};
    const thoughts = thought.thoughts || [];
    const maxIterations = this.properties?.maxIterations || 7;
    this.setOutputData(0, {
      isComplete: thoughts.length >= maxIterations,
      reason: `Iteration ${thoughts.length}/${maxIterations}`,
      nextSearchTerms: thought.keywords || [],
      thoughts,
      seedMemory: thought.seedMemory || '',
    });
  }
}

class ThoughtAggregatorNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'thought_aggregator')!;
  constructor() { super(ThoughtAggregatorNodeImpl.schema); }
  onExecute() {
    const input = this.getInputData(0) || {};
    const thoughts = input.thoughts || [];
    this.setOutputData(0, {
      consolidatedChain: thoughts.join('\n\n'),
      insight: thoughts[thoughts.length - 1] || '',
      summary: `Chain of ${thoughts.length} thoughts`,
      thoughtCount: thoughts.length,
    });
  }
}

class LoopMemorySearchNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'loop_memory_search')!;
  constructor() { super(LoopMemorySearchNodeImpl.schema); }
  onExecute() {
    const searchTerms = this.getInputData(0) || [];
    const seenIds = this.getInputData(1) || [];
    this.setOutputData(0, {
      memories: [],
      memoryIds: [],
      searchTermsUsed: searchTerms,
    });
  }
}

class AgentTriggerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'agent_trigger')!;
  constructor() { super(AgentTriggerNodeImpl.schema); }
  onExecute() {
    const inputData = this.getInputData(0) || {};
    const agentName = this.properties?.agentName || '';
    this.setOutputData(0, {
      triggered: !!agentName,
      agentName,
      inputData,
    });
  }
}

// ============================================================================
// CURATOR WORKFLOW NODE IMPLEMENTATIONS
// ============================================================================

class UncuratedMemoryLoaderNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'uncurated_memory_loader')!;
  constructor() { super(UncuratedMemoryLoaderNodeImpl.schema); }
  onExecute() {
    // Mock - in real implementation would load uncurated memories from API
    this.setOutputData(0, []);
  }
}

class PersonaSummaryLoaderNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'persona_summary_loader')!;
  constructor() { super(PersonaSummaryLoaderNodeImpl.schema); }
  onExecute() {
    // Mock - in real implementation would load persona summary
    this.setOutputData(0, 'Persona summary...');
  }
}

class CuratorLLMNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'curator_llm')!;
  constructor() { super(CuratorLLMNodeImpl.schema); }
  async onExecute() {
    const memories = this.getInputData(0) || [];
    const personaSummary = this.getInputData(1) || '';
    // Mock - in real implementation would call LLM for curation
    this.setOutputData(0, []);
  }
}

class CuratedMemorySaverNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'curated_memory_saver')!;
  constructor() { super(CuratedMemorySaverNodeImpl.schema); }
  onExecute() {
    const curatedMemories = this.getInputData(0) || [];
    // Mock - in real implementation would save curated memories
    this.setOutputData(0, curatedMemories.length);
  }
}

class TrainingPairGeneratorNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'training_pair_generator')!;
  constructor() { super(TrainingPairGeneratorNodeImpl.schema); }
  onExecute() {
    const curatedMemories = this.getInputData(0) || [];
    // Mock - in real implementation would generate training pairs
    this.setOutputData(0, []);
  }
}

class TrainingPairAppenderNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'training_pair_appender')!;
  constructor() { super(TrainingPairAppenderNodeImpl.schema); }
  onExecute() {
    const trainingPairs = this.getInputData(0) || [];
    // Mock - in real implementation would append to JSONL file
    this.setOutputData(0, trainingPairs.length);
  }
}

class MemoryMarkerNodeImpl extends CognitiveNodeBase {
  static schema = nodeSchemas.find((s) => s.id === 'memory_marker')!;
  constructor() { super(MemoryMarkerNodeImpl.schema); }
  onExecute() {
    const curatedMemories = this.getInputData(0) || [];
    // Mock - in real implementation would mark memories as curated
    this.setOutputData(0, curatedMemories.length);
  }
}

  // Return all node implementation classes
  return {
    MicInputNodeImpl,
    SpeechToTextNodeImpl,
    TextInputNodeImpl,
    UserInputNodeImpl,
    SessionContextNodeImpl,
    SystemSettingsNodeImpl,
    CognitiveModeRouterNodeImpl,
    AuthCheckNodeImpl,
    OperatorEligibilityNodeImpl,
    SmartRouterNodeImpl,
    ContextBuilderNodeImpl,
    SemanticSearchNodeImpl,
    BufferManagerNodeImpl,
    ConversationHistoryNodeImpl,
    ReActPlannerNodeImpl,
    SkillExecutorNodeImpl,
    ObservationFormatterNodeImpl,
    CompletionCheckerNodeImpl,
    ResponseSynthesizerNodeImpl,
    IterationCounterNodeImpl,
    ScratchpadCompletionCheckerNodeImpl,
    ScratchpadFormatterNodeImpl,
    PersonaLLMNodeImpl,
    OrchestratorLLMNodeImpl,
    ReflectorLLMNodeImpl,
    InnerDialogueCaptureNodeImpl,
    ChainOfThoughtStripperNodeImpl,
    SafetyValidatorNodeImpl,
    ResponseRefinerNodeImpl,
    ModelResolverNodeImpl,
    ModelRouterNodeImpl,
    MemoryCaptureNodeImpl,
    AuditLoggerNodeImpl,
    StreamWriterNodeImpl,
    ChatViewNodeImpl,
    TTSNodeImpl,
    FsReadNodeImpl,
    FsWriteNodeImpl,
    FsListNodeImpl,
    TaskCreateNodeImpl,
    TaskListNodeImpl,
    TaskUpdateNodeImpl,
    SearchIndexNodeImpl,
    WebSearchNodeImpl,
    ConversationalResponseNodeImpl,
    // Control Flow
    LoopControllerNodeImpl,
    ConditionalBranchNodeImpl,
    ConditionalRouterNodeImpl,
    SwitchNodeImpl,
    ForEachNodeImpl,
    // Memory Curation
    WeightedSamplerNodeImpl,
    AssociativeChainNodeImpl,
    MemoryFilterNodeImpl,
    // Utility
    JSONParserNodeImpl,
    TextTemplateNodeImpl,
    DataTransformNodeImpl,
    CacheNodeImpl,
    // Advanced Operator
    PlanParserNodeImpl,
    ScratchpadManagerNodeImpl,
    ErrorRecoveryNodeImpl,
    StuckDetectorNodeImpl,
    BigBrotherNodeImpl,
    // Agent
    MemoryLoaderNodeImpl,
    MemorySaverNodeImpl,
    LLMEnricherNodeImpl,
    AgentTimerNodeImpl,
    // Curiosity Service
    CuriosityWeightedSamplerNodeImpl,
    CuriosityQuestionGeneratorNodeImpl,
    CuriosityQuestionSaverNodeImpl,
    CuriosityActivityCheckNodeImpl,
    // Configuration
    PersonaLoaderNodeImpl,
    PersonaFormatterNodeImpl,
    PersonaSaverNodeImpl,
    TrustLevelReaderNodeImpl,
    TrustLevelWriterNodeImpl,
    DecisionRulesLoaderNodeImpl,
    DecisionRulesSaverNodeImpl,
    IdentityExtractorNodeImpl,
    ValueManagerNodeImpl,
    GoalManagerNodeImpl,
    // Train of Thought
    ScratchpadInitializerNodeImpl,
    ScratchpadUpdaterNodeImpl,
    ThoughtGeneratorNodeImpl,
    ThoughtEvaluatorNodeImpl,
    ThoughtAggregatorNodeImpl,
    LoopMemorySearchNodeImpl,
    AgentTriggerNodeImpl,
    // Curator Workflow
    UncuratedMemoryLoaderNodeImpl,
    PersonaSummaryLoaderNodeImpl,
    CuratorLLMNodeImpl,
    CuratedMemorySaverNodeImpl,
    TrainingPairGeneratorNodeImpl,
    TrainingPairAppenderNodeImpl,
    MemoryMarkerNodeImpl,
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
    console.log('[CognitiveNodes] LiteGraph object keys:', Object.keys(LiteGraph).slice(0, 30));
    console.log('[CognitiveNodes] Before registration, registered_node_types:', LiteGraph.registered_node_types);
    console.log('[CognitiveNodes] registerNodeType function:', LiteGraph.registerNodeType);

    LiteGraph.registerNodeType('cognitive/user_input', nodeImpls.UserInputNodeImpl);

    console.log('[CognitiveNodes] After first registration, registered_node_types:', LiteGraph.registered_node_types);
    console.log('[CognitiveNodes] Checking LGraphNode.registered_node_types:', LGraphNode.registered_node_types);
    console.log('[CognitiveNodes] Checking global LiteGraph:', (globalThis as any).LiteGraph);

    // Try to create a test node to verify registration worked
    try {
      const testNode = LiteGraph.createNode('cognitive/user_input');
      console.log('[CognitiveNodes] Test node creation SUCCESS:', !!testNode);
    } catch (e) {
      console.error('[CognitiveNodes] Test node creation FAILED:', e);
    }

    // Input nodes
    LiteGraph.registerNodeType('cognitive/mic_input', nodeImpls.MicInputNodeImpl);
    LiteGraph.registerNodeType('cognitive/speech_to_text', nodeImpls.SpeechToTextNodeImpl);
    LiteGraph.registerNodeType('cognitive/text_input', nodeImpls.TextInputNodeImpl);
    LiteGraph.registerNodeType('cognitive/session_context', nodeImpls.SessionContextNodeImpl);
    LiteGraph.registerNodeType('cognitive/system_settings', nodeImpls.SystemSettingsNodeImpl);

    // Router nodes
    LiteGraph.registerNodeType('cognitive/cognitive_mode_router', nodeImpls.CognitiveModeRouterNodeImpl);
    LiteGraph.registerNodeType('cognitive/auth_check', nodeImpls.AuthCheckNodeImpl);
    LiteGraph.registerNodeType('cognitive/operator_eligibility', nodeImpls.OperatorEligibilityNodeImpl);
    LiteGraph.registerNodeType('cognitive/smart_router', nodeImpls.SmartRouterNodeImpl);

    // Context nodes
    LiteGraph.registerNodeType('cognitive/context_builder', nodeImpls.ContextBuilderNodeImpl);
    LiteGraph.registerNodeType('cognitive/semantic_search', nodeImpls.SemanticSearchNodeImpl);
    LiteGraph.registerNodeType('cognitive/conversation_history', nodeImpls.ConversationHistoryNodeImpl);
    LiteGraph.registerNodeType('cognitive/buffer_manager', nodeImpls.BufferManagerNodeImpl);

    // Operator nodes
    LiteGraph.registerNodeType('cognitive/react_planner', nodeImpls.ReActPlannerNodeImpl);
    LiteGraph.registerNodeType('cognitive/skill_executor', nodeImpls.SkillExecutorNodeImpl);
    LiteGraph.registerNodeType('cognitive/observation_formatter', nodeImpls.ObservationFormatterNodeImpl);
    LiteGraph.registerNodeType('cognitive/completion_checker', nodeImpls.CompletionCheckerNodeImpl);
    LiteGraph.registerNodeType('cognitive/response_synthesizer', nodeImpls.ResponseSynthesizerNodeImpl);
    LiteGraph.registerNodeType('cognitive/iteration_counter', nodeImpls.IterationCounterNodeImpl);
    LiteGraph.registerNodeType('cognitive/scratchpad_completion_checker', nodeImpls.ScratchpadCompletionCheckerNodeImpl);
    LiteGraph.registerNodeType('cognitive/scratchpad_formatter', nodeImpls.ScratchpadFormatterNodeImpl);

    // Chat nodes
    LiteGraph.registerNodeType('cognitive/persona_llm', nodeImpls.PersonaLLMNodeImpl);
    LiteGraph.registerNodeType('cognitive/orchestrator_llm', nodeImpls.OrchestratorLLMNodeImpl);
    LiteGraph.registerNodeType('cognitive/reflector_llm', nodeImpls.ReflectorLLMNodeImpl);
    LiteGraph.registerNodeType('cognitive/cot_stripper', nodeImpls.ChainOfThoughtStripperNodeImpl);
    LiteGraph.registerNodeType('cognitive/safety_validator', nodeImpls.SafetyValidatorNodeImpl);
    LiteGraph.registerNodeType('cognitive/response_refiner', nodeImpls.ResponseRefinerNodeImpl);

    // Model nodes
    LiteGraph.registerNodeType('cognitive/model_resolver', nodeImpls.ModelResolverNodeImpl);
    LiteGraph.registerNodeType('cognitive/model_router', nodeImpls.ModelRouterNodeImpl);

    // Output nodes
    LiteGraph.registerNodeType('cognitive/memory_capture', nodeImpls.MemoryCaptureNodeImpl);
    LiteGraph.registerNodeType('cognitive/inner_dialogue_capture', nodeImpls.InnerDialogueCaptureNodeImpl);
    LiteGraph.registerNodeType('cognitive/audit_logger', nodeImpls.AuditLoggerNodeImpl);
    LiteGraph.registerNodeType('cognitive/stream_writer', nodeImpls.StreamWriterNodeImpl);
    LiteGraph.registerNodeType('cognitive/chat_view', nodeImpls.ChatViewNodeImpl);
    LiteGraph.registerNodeType('cognitive/tts', nodeImpls.TTSNodeImpl);

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

    // Control Flow nodes
    LiteGraph.registerNodeType('cognitive/loop_controller', nodeImpls.LoopControllerNodeImpl);
    LiteGraph.registerNodeType('cognitive/conditional_branch', nodeImpls.ConditionalBranchNodeImpl);
    LiteGraph.registerNodeType('cognitive/conditional_router', nodeImpls.ConditionalRouterNodeImpl);
    LiteGraph.registerNodeType('cognitive/switch', nodeImpls.SwitchNodeImpl);
    LiteGraph.registerNodeType('cognitive/for_each', nodeImpls.ForEachNodeImpl);

    // Memory Curation nodes
    LiteGraph.registerNodeType('cognitive/weighted_sampler', nodeImpls.WeightedSamplerNodeImpl);
    LiteGraph.registerNodeType('cognitive/associative_chain', nodeImpls.AssociativeChainNodeImpl);
    LiteGraph.registerNodeType('cognitive/memory_filter', nodeImpls.MemoryFilterNodeImpl);

    // Utility nodes
    LiteGraph.registerNodeType('cognitive/json_parser', nodeImpls.JSONParserNodeImpl);
    LiteGraph.registerNodeType('cognitive/text_template', nodeImpls.TextTemplateNodeImpl);
    LiteGraph.registerNodeType('cognitive/data_transform', nodeImpls.DataTransformNodeImpl);
    LiteGraph.registerNodeType('cognitive/cache', nodeImpls.CacheNodeImpl);

    // Advanced Operator nodes
    LiteGraph.registerNodeType('cognitive/plan_parser', nodeImpls.PlanParserNodeImpl);
    LiteGraph.registerNodeType('cognitive/scratchpad_manager', nodeImpls.ScratchpadManagerNodeImpl);
    LiteGraph.registerNodeType('cognitive/error_recovery', nodeImpls.ErrorRecoveryNodeImpl);
    LiteGraph.registerNodeType('cognitive/stuck_detector', nodeImpls.StuckDetectorNodeImpl);
    LiteGraph.registerNodeType('cognitive/big_brother', nodeImpls.BigBrotherNodeImpl);

    // Agent nodes
    LiteGraph.registerNodeType('cognitive/memory_loader', nodeImpls.MemoryLoaderNodeImpl);
    LiteGraph.registerNodeType('cognitive/memory_saver', nodeImpls.MemorySaverNodeImpl);
    LiteGraph.registerNodeType('cognitive/llm_enricher', nodeImpls.LLMEnricherNodeImpl);
    LiteGraph.registerNodeType('cognitive/agent_timer', nodeImpls.AgentTimerNodeImpl);

    // Curiosity Service nodes
    LiteGraph.registerNodeType('cognitive/curiosity_weighted_sampler', nodeImpls.CuriosityWeightedSamplerNodeImpl);
    LiteGraph.registerNodeType('cognitive/curiosity_question_generator', nodeImpls.CuriosityQuestionGeneratorNodeImpl);
    LiteGraph.registerNodeType('cognitive/curiosity_question_saver', nodeImpls.CuriosityQuestionSaverNodeImpl);
    LiteGraph.registerNodeType('cognitive/curiosity_activity_check', nodeImpls.CuriosityActivityCheckNodeImpl);

    // Configuration nodes
    LiteGraph.registerNodeType('cognitive/persona_loader', nodeImpls.PersonaLoaderNodeImpl);
    LiteGraph.registerNodeType('cognitive/persona_formatter', nodeImpls.PersonaFormatterNodeImpl);
    LiteGraph.registerNodeType('cognitive/persona_saver', nodeImpls.PersonaSaverNodeImpl);
    LiteGraph.registerNodeType('cognitive/trust_level_reader', nodeImpls.TrustLevelReaderNodeImpl);
    LiteGraph.registerNodeType('cognitive/trust_level_writer', nodeImpls.TrustLevelWriterNodeImpl);
    LiteGraph.registerNodeType('cognitive/decision_rules_loader', nodeImpls.DecisionRulesLoaderNodeImpl);
    LiteGraph.registerNodeType('cognitive/decision_rules_saver', nodeImpls.DecisionRulesSaverNodeImpl);
    LiteGraph.registerNodeType('cognitive/identity_extractor', nodeImpls.IdentityExtractorNodeImpl);
    LiteGraph.registerNodeType('cognitive/value_manager', nodeImpls.ValueManagerNodeImpl);
    LiteGraph.registerNodeType('cognitive/goal_manager', nodeImpls.GoalManagerNodeImpl);

    // Train of Thought nodes
    LiteGraph.registerNodeType('cognitive/scratchpad_initializer', nodeImpls.ScratchpadInitializerNodeImpl);
    LiteGraph.registerNodeType('cognitive/scratchpad_updater', nodeImpls.ScratchpadUpdaterNodeImpl);
    LiteGraph.registerNodeType('cognitive/thought_generator', nodeImpls.ThoughtGeneratorNodeImpl);
    LiteGraph.registerNodeType('cognitive/thought_evaluator', nodeImpls.ThoughtEvaluatorNodeImpl);
    LiteGraph.registerNodeType('cognitive/thought_aggregator', nodeImpls.ThoughtAggregatorNodeImpl);
    LiteGraph.registerNodeType('cognitive/loop_memory_search', nodeImpls.LoopMemorySearchNodeImpl);
    LiteGraph.registerNodeType('cognitive/agent_trigger', nodeImpls.AgentTriggerNodeImpl);

    // Curator Workflow nodes
    LiteGraph.registerNodeType('cognitive/uncurated_memory_loader', nodeImpls.UncuratedMemoryLoaderNodeImpl);
    LiteGraph.registerNodeType('cognitive/persona_summary_loader', nodeImpls.PersonaSummaryLoaderNodeImpl);
    LiteGraph.registerNodeType('cognitive/curator_llm', nodeImpls.CuratorLLMNodeImpl);
    LiteGraph.registerNodeType('cognitive/curated_memory_saver', nodeImpls.CuratedMemorySaverNodeImpl);
    LiteGraph.registerNodeType('cognitive/training_pair_generator', nodeImpls.TrainingPairGeneratorNodeImpl);
    LiteGraph.registerNodeType('cognitive/training_pair_appender', nodeImpls.TrainingPairAppenderNodeImpl);
    LiteGraph.registerNodeType('cognitive/memory_marker', nodeImpls.MemoryMarkerNodeImpl);

    console.log('[CognitiveNodes] Registration completed successfully');
  } catch (error) {
    console.error('[CognitiveNodes] Registration error:', error);
    throw error;
  }

  // Check multiple possible locations for registered_node_types
  const registry = LiteGraph?.registered_node_types ||
                   LGraphNode?.registered_node_types ||
                   (globalThis as any).LiteGraph?.registered_node_types;

  const registeredTypes = registry
    ? Object.keys(registry).filter((k: string) => k.startsWith('cognitive/'))
    : [];

  console.log('[CognitiveNodes] Registry location:', {
    onLiteGraph: !!LiteGraph?.registered_node_types,
    onLGraphNode: !!LGraphNode?.registered_node_types,
    onGlobal: !!(globalThis as any).LiteGraph?.registered_node_types,
  });
  console.log('[CognitiveNodes] Registered', registeredTypes.length, 'node types');
  console.log('[CognitiveNodes] Sample registered types:', registeredTypes.slice(0, 10));
}

/**
 * Get list of all registered cognitive nodes for the UI
 */
export function getCognitiveNodesList() {
  return nodeSchemas.map(schema => ({
    id: schema.id,  // Add id property for palette clicks
    type: `cognitive/${schema.id}`,
    name: schema.name,
    category: schema.category,
    description: schema.description,
    color: schema.color,      // Add color for palette display
    bgColor: schema.bgColor,  // Add bgColor for palette display
  }));
}

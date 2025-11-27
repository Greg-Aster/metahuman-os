/**
 * Operator Types
 *
 * Shared types for the ReAct operator system (V1, V2, and ReasoningEngine).
 */

// ============================================================================
// V1 Types (Legacy)
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
// V2 Scratchpad Types
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

export const DEFAULT_REACT_CONFIG: ReActConfig = {
  maxIterations: 10,
  enableDeepReasoning: false,
  observationMaxLength: 500,
};

// ============================================================================
// Progress/Event Types
// ============================================================================

export interface OperatorProgressEvent {
  type: 'thought' | 'action' | 'observation' | 'completion' | 'error' | 'step' | 'reasoning';
  content?: string;
  step?: number;
  tool?: string;
  success?: boolean;
  metadata?: any;
  data?: any;
}

export type ProgressCallback = (event: OperatorProgressEvent) => void;

export interface OperatorContext {
  memories?: any[];
  conversationHistory?: any[];
  contextPackage?: any;
  sessionId?: string;
  conversationId?: string;
}

export interface UserContext {
  userId?: string;
  cognitiveMode?: string;
}

export interface OperatorResult {
  goal: string;
  result: any;
  reasoning: string;
  actions: string[];
  scratchpad?: ScratchpadEntry[];
  metadata?: any;
}

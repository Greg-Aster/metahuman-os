/**
 * Reasoning Service - Type Definitions
 *
 * Core types for the unified reasoning engine.
 * Extracted from Operator V2 implementation.
 */

import type { Memory } from '../types/memory';

/**
 * Scratchpad entry representing one step in the reasoning process.
 * Follows Thought → Action → Observation pattern.
 */
export interface ScratchpadEntry {
  step: number;
  thought: string;
  action?: {
    tool: string;
    args: Record<string, any>;
  };
  observation?: {
    mode: 'narrative' | 'structured' | 'verbatim';
    content: string;
    success: boolean;
    error?: {
      code: string;
      message: string;
      context: any;
    };
  };
  timestamp: string; // ISO 8601
}

/**
 * Planner response schema (validated JSON from LLM).
 */
export interface PlanningResponse {
  thought: string;
  action?: {
    tool: string;
    args: Record<string, any>;
  };
  respond?: boolean; // If true, generate final response
  responseStyle?: 'default' | 'strict' | 'summary';
}

/**
 * Context passed to reasoning engine.
 */
export interface ReasoningContext {
  memories: Memory[];
  conversationHistory: Array<{
    role: string;
    content: string;
    timestamp?: string;
  }>;
  cognitiveMode?: string;
  allowMemoryWrites?: boolean;
  userId?: string;
  sessionId?: string;
  conversationId?: string;
}

/**
 * Internal state for ReAct loop.
 */
export interface ReactState {
  scratchpad: ScratchpadEntry[];
  maxSteps: number;
  currentStep: number;
  completed: boolean;
  finalResponse?: string;
}

/**
 * Reasoning depth levels (from UI slider).
 */
export type ReasoningDepth = 'off' | 'quick' | 'focused' | 'deep';

/**
 * Observation mode determines how skill outputs are formatted.
 */
export type ObservationMode = 'narrative' | 'structured' | 'verbatim';

/**
 * Configuration for ReasoningEngine.
 */
export interface ReasoningEngineConfig {
  // Reasoning depth (from UI slider)
  depth?: ReasoningDepth;

  // Iteration limits by depth
  maxSteps?: number; // Auto-calculated from depth if not provided

  // Tool catalog
  toolCatalog?: string; // Pre-built catalog (auto-loaded if not provided)

  // Models
  planningModel?: string; // Default: 'orchestrator' role
  responseModel?: string; // Default: 'persona' role
  useSingleModel?: boolean; // Use same model for all steps

  // Scratchpad
  scratchpadTrimSize?: number; // Default: 10
  observationMode?: ObservationMode; // Auto-detect if not set

  // Error handling
  enableErrorRetry?: boolean; // Default: true
  enableFailureLoopDetection?: boolean; // Default: true

  // Optimizations
  enableFastPath?: boolean; // Chat detection, synthesis skipping
  enableVerbatimShortCircuit?: boolean; // Data query optimization

  // Telemetry
  enableScratchpadDump?: boolean; // Write to logs/run/reasoning/
  verboseErrors?: boolean; // Full stack traces

  // Session tracking
  sessionId?: string;
  conversationId?: string;
  userId?: string;
}

/**
 * Result returned by ReasoningEngine.
 */
export interface ReasoningResult {
  goal: string;
  result: string; // Final response
  scratchpad: ScratchpadEntry[]; // Full reasoning trace
  metadata: {
    stepsExecuted: number;
    fastPathUsed: boolean;
    verbatimShortCircuit: boolean;
    totalDuration: number; // milliseconds
    llmCalls: number;
    errors: number;
  };
}

/**
 * SSE event emitted during reasoning.
 */
export interface ReasoningEvent {
  type: 'thought' | 'action' | 'observation' | 'completion' | 'error';
  step: number;
  timestamp: string; // ISO 8601
  sessionId: string;
  conversationId?: string;

  data: {
    // Thought events
    thought?: string;

    // Action events
    tool?: string;
    args?: Record<string, any>;

    // Observation events
    result?: any;
    mode?: ObservationMode;
    success?: boolean;

    // Error events
    error?: {
      code: string;
      message: string;
      suggestions?: string[];
      context?: any;
    };

    // Completion events
    finalResponse?: string;
    metadata?: {
      stepsExecuted: number;
      llmCalls: number;
      totalDuration: number;
    };
  };
}

/**
 * Error analysis result.
 */
export interface ErrorAnalysis {
  code: string;
  message: string;
  suggestions: string[];
  context?: any;
}

/**
 * Failure tracking for loop detection.
 */
export interface FailureTracker {
  [actionKey: string]: {
    count: number;
    lastError: string;
  };
}

/**
 * Observation formatting result.
 */
export interface ObservationResult {
  mode: ObservationMode;
  content: string;
  success: boolean;
  error?: {
    code: string;
    message: string;
    context: any;
  };
}

/**
 * Skill execution result (from executeSkill).
 */
export interface SkillExecutionResult {
  success: boolean;
  content: string;
  error?: {
    code: string;
    message: string;
    suggestions?: string[];
    context?: any;
  };
  llmCalls?: number;
}

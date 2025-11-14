/**
 * Reasoning Service - Engine
 *
 * Main ReasoningEngine class that orchestrates the ReAct loop.
 * Extracted and generalized from Operator V2.
 */

import { getCachedCatalog } from '../tool-catalog';
import { executeSkill } from '../skills';
import { audit } from '../audit';
import { getDefaultConfig, validateConfig } from './config';
import { formatScratchpadForLLM, getObservations } from './scratchpad';
import { planNextStepV2 } from './planner';
import { formatObservationV2, checkVerbatimShortCircuit } from './observers';
import { analyzeError, formatErrorWithSuggestions } from './errors';
import { detectFailureLoop } from './validators';
import {
  emitReasoningEvent,
  logLoopStarted,
  logLoopCompleted,
  logLoopFailed,
  logVerbatimShortCircuit,
  logFailureLoopDetected,
} from './telemetry';
import type {
  ReasoningEngineConfig,
  ReasoningResult,
  ReasoningContext,
  ReasoningEvent,
  ScratchpadEntry,
  ReactState,
} from './types';

/**
 * ReasoningEngine - Unified reasoning service.
 *
 * Provides structured ReAct loop with:
 * - Tool catalog integration
 * - Scratchpad management
 * - Error recovery
 * - Failure loop detection
 * - Multiple observation modes
 * - Fast-path optimizations
 *
 * Example usage:
 * ```typescript
 * const engine = new ReasoningEngine({
 *   depth: 'focused',
 *   sessionId: 'session-123',
 * });
 *
 * const result = await engine.run(
 *   'List my tasks',
 *   { memories: [], conversationHistory: [] },
 *   (event) => console.log(event)
 * );
 * ```
 */
export class ReasoningEngine {
  private config: Required<ReasoningEngineConfig>;
  private scratchpad: ScratchpadEntry[] = [];
  private sessionId: string;

  constructor(config: ReasoningEngineConfig = {}) {
    // Apply defaults and validate
    this.config = getDefaultConfig(config);
    validateConfig(this.config);

    this.sessionId = this.config.sessionId;

    // Load tool catalog if not provided
    if (!this.config.toolCatalog) {
      this.config.toolCatalog = getCachedCatalog();
    }
  }

  /**
   * Run reasoning loop.
   *
   * @param goal - User goal/question
   * @param context - Reasoning context (memories, history)
   * @param onProgress - Progress callback for SSE events
   * @returns Reasoning result with final response and metadata
   */
  async run(
    goal: string,
    context: ReasoningContext = { memories: [], conversationHistory: [] },
    onProgress?: (event: ReasoningEvent) => void
  ): Promise<ReasoningResult> {
    const startTime = Date.now();
    let llmCalls = 0;
    let errors = 0;

    // Log loop started
    logLoopStarted(this.sessionId, goal, {
      depth: this.config.depth,
      maxSteps: this.config.maxSteps,
    });

    // Fast-path optimization: Check verbatim short-circuit
    if (this.config.enableVerbatimShortCircuit) {
      const skillExecutor = async (tool: string, args: any) => {
        const result = await executeSkill(tool, args, 'bounded_auto', true);
        return result;
      };

      const verbatimResult = await checkVerbatimShortCircuit(goal, skillExecutor, onProgress);

      if (verbatimResult) {
        logVerbatimShortCircuit(this.sessionId, goal, 'task_list', 2);

        return {
          goal,
          result: verbatimResult.result,
          scratchpad: [],
          metadata: {
            stepsExecuted: 0,
            fastPathUsed: true,
            verbatimShortCircuit: true,
            totalDuration: Date.now() - startTime,
            llmCalls: 0,
            errors: 0,
          },
        };
      }
    }

    // Initialize scratchpad
    this.scratchpad = [];

    // Main reasoning loop
    const state: ReactState = {
      scratchpad: this.scratchpad,
      maxSteps: this.config.maxSteps,
      currentStep: 0,
      completed: false,
    };

    while (state.currentStep < state.maxSteps && !state.completed) {
      state.currentStep++;

      try {
        // Plan next step
        const planning = await planNextStepV2(
          goal,
          state,
          this.config,
          context.contextPackage,
          {
            userId: context.userId || this.config.userId,
            cognitiveMode: context.cognitiveMode,
          }
        );
        llmCalls++;

        // Create scratchpad entry
        const entry: ScratchpadEntry = {
          step: state.currentStep,
          thought: planning.thought,
          timestamp: new Date().toISOString(),
        };

        // Emit thought event
        if (onProgress) {
          emitReasoningEvent(onProgress, {
            type: 'thought',
            step: state.currentStep,
            timestamp: entry.timestamp,
            sessionId: this.sessionId,
            conversationId: this.config.conversationId,
            data: { thought: planning.thought },
          });
        }

        // Execute action if present
        if (planning.action && !planning.respond) {
          // Check failure loop
          if (this.config.enableFailureLoopDetection) {
            const loopCheck = detectFailureLoop(state.scratchpad, planning.action);
            if (loopCheck.isLoop) {
              logFailureLoopDetected(
                this.sessionId,
                planning.action.tool,
                2,
                loopCheck.suggestion
              );

              // Inject warning into scratchpad
              entry.observation = {
                mode: 'narrative',
                content: loopCheck.suggestion,
                success: false,
              };
              errors++;
            }
          }

          // Execute skill (if no loop warning)
          if (!entry.observation) {
            entry.action = planning.action;

            // Emit action event
            if (onProgress) {
              emitReasoningEvent(onProgress, {
                type: 'action',
                step: state.currentStep,
                timestamp: new Date().toISOString(),
                sessionId: this.sessionId,
                conversationId: this.config.conversationId,
                data: {
                  tool: planning.action.tool,
                  args: planning.action.args,
                },
              });
            }

            try {
              // Execute skill
              const result = await executeSkill(
                planning.action.tool,
                planning.action.args,
                'bounded_auto',
                true
              );

              // Track LLM calls (if skill reports them)
              llmCalls += (result as any).llmCalls || 0;

              // Format observation
              const observation = formatObservationV2(
                planning.action.tool,
                result,
                this.config.observationMode
              );
              entry.observation = observation;

              // Analyze errors
              if (!result.success && this.config.enableErrorRetry) {
                const errorAnalysis = analyzeError(
                  planning.action.tool,
                  planning.action.args,
                  result.error || 'Unknown error'
                );

                if (entry.observation.error) {
                  entry.observation.error.code = errorAnalysis.code;
                  entry.observation.error.message = errorAnalysis.message;
                }

                // Append suggestions to observation
                if (errorAnalysis.suggestions.length > 0) {
                  entry.observation.content += '\n\nSuggestions:\n' +
                    errorAnalysis.suggestions.map((s) => `- ${s}`).join('\n');
                }

                errors++;
              }

              // Emit observation event
              if (onProgress) {
                emitReasoningEvent(onProgress, {
                  type: 'observation',
                  step: state.currentStep,
                  timestamp: new Date().toISOString(),
                  sessionId: this.sessionId,
                  conversationId: this.config.conversationId,
                  data: {
                    result: result.outputs,
                    mode: observation.mode,
                    success: observation.success,
                    error: observation.error,
                  },
                });
              }
            } catch (error) {
              const errorMessage = (error as Error).message;
              entry.observation = {
                mode: 'narrative',
                content: `❌ Unexpected error: ${errorMessage}`,
                success: false,
                error: { code: 'UNKNOWN_ERROR', message: errorMessage, context: {} },
              };
              errors++;

              // Emit error event
              if (onProgress) {
                emitReasoningEvent(onProgress, {
                  type: 'error',
                  step: state.currentStep,
                  timestamp: new Date().toISOString(),
                  sessionId: this.sessionId,
                  conversationId: this.config.conversationId,
                  data: {
                    error: {
                      code: 'UNKNOWN_ERROR',
                      message: errorMessage,
                      suggestions: [],
                    },
                  },
                });
              }
            }
          }
        }

        // Add to scratchpad
        state.scratchpad.push(entry);

        // Check if we should respond
        if (planning.respond) {
          state.completed = true;

          // Generate final response
          const observations = getObservations(state.scratchpad);
          let finalResponse: string;

          // STRICT MODE: If responseStyle is 'strict' and we have successful observations,
          // skip conversational_response and return structured data directly
          if (planning.responseStyle === 'strict' && observations.length > 0) {
            // Use the last observation directly (assumes it contains the data)
            const lastObs = state.scratchpad[state.scratchpad.length - 1];

            if (lastObs?.observation && lastObs.observation.success) {
              finalResponse = lastObs.observation.content;

              // Log strict short-circuit event
              audit({
                level: 'info',
                category: 'action',
                event: 'reasoning_strict_shortcut',
                details: {
                  goal,
                  tool: lastObs.action?.tool,
                  sessionId: this.sessionId,
                  message: 'Skipped conversational_response, returned structured data directly',
                },
                actor: 'reasoning-service',
              });
            } else {
              // Fallback to conversational_response if observation failed
              const responseResult = await executeSkill('conversational_response', {
                context: observations,
                goal: goal,
                style: 'default', // Fallback to default style
              });
              llmCalls++;
              finalResponse = responseResult.outputs?.response || 'No response generated.';
            }
          } else {
            // Normal conversational response
            const responseResult = await executeSkill('conversational_response', {
              context: observations,
              goal: goal,
              style: planning.responseStyle || 'default',
            });
            llmCalls++;
            finalResponse = responseResult.outputs?.response || 'No response generated.';
          }

          state.finalResponse = finalResponse;

          // Emit completion event
          if (onProgress) {
            emitReasoningEvent(onProgress, {
              type: 'completion',
              step: state.currentStep,
              timestamp: new Date().toISOString(),
              sessionId: this.sessionId,
              conversationId: this.config.conversationId,
              data: {
                finalResponse,
                metadata: {
                  stepsExecuted: state.currentStep,
                  llmCalls,
                  totalDuration: Date.now() - startTime,
                },
              },
            });
          }
        }
      } catch (error) {
        // Planning or execution error - log and exit loop
        const errorMessage = (error as Error).message;
        logLoopFailed(this.sessionId, errorMessage, {
          stepsExecuted: state.currentStep,
          totalDuration: Date.now() - startTime,
        });

        throw new Error(`Reasoning loop failed at step ${state.currentStep}: ${errorMessage}`);
      }
    }

    // Log loop completed
    const metadata = {
      stepsExecuted: state.currentStep,
      fastPathUsed: false,
      verbatimShortCircuit: false,
      totalDuration: Date.now() - startTime,
      llmCalls,
      errors,
    };

    logLoopCompleted(this.sessionId, metadata);

    return {
      goal,
      result: state.finalResponse || 'No response generated (max steps reached).',
      scratchpad: state.scratchpad,
      metadata,
    };
  }

  /**
   * Get tool catalog.
   */
  getCatalog(): string {
    return this.config.toolCatalog;
  }

  /**
   * Get current scratchpad.
   */
  getScratchpad(): ScratchpadEntry[] {
    return this.scratchpad;
  }

  /**
   * Invalidate internal caches.
   */
  invalidate(): void {
    this.scratchpad = [];
    // Invalidate tool catalog
    const { invalidateCatalog } = require('../tool-catalog');
    invalidateCatalog();
  }

  /**
   * Get configuration.
   */
  getConfig(): Required<ReasoningEngineConfig> {
    return { ...this.config };
  }
}

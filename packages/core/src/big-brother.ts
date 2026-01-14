/**
 * Big Brother Mode - Escalation to External Agents
 *
 * When the operator gets stuck or encounters repeated failures, escalate to
 * a more capable agent (Claude Code, Open Interpreter, Aider, Gemini, etc.)
 * for guidance and assistance.
 *
 * "Big Brother" is a concept, not a specific tool. The actual backend used
 * is configurable per-user via tool-executor.json or operator.json.
 *
 * Supported backends:
 * - claude-code: Anthropic's Claude Code CLI
 * - open-interpreter: LLM-agnostic Python code interpreter
 * - aider: AI pair programming with git integration
 * - gemini-cli: Google Gemini CLI
 * - qwen-code: Local Qwen model CLI
 * - codex: OpenAI Codex CLI
 */

import { audit } from './audit.js';
import type { OperatorConfig } from './config.js';
import {
  getActiveBackend,
  escalate as escalateViaBackend,
  ensureBackendsInitialized,
  type EscalationResult,
  type ReasoningStep,
} from './escalation-backend.js';
import {
  bigBrotherTerminal,
  ensureBigBrotherTerminal,
  sendToBigBrother,
  isBigBrotherReady,
} from './big-brother-terminal.js';

/**
 * Optional streaming callbacks for real-time UI display.
 * These allow the UI to show Claude's output as it happens.
 */
export interface EscalationStreamingCallbacks {
  /** Called for each raw output chunk (for terminal display) */
  onChunk?: (chunk: string) => void;
  /** Called when backend is waiting for user input */
  onWaitingForInput?: (question: string) => void;
  /** Called for each reasoning step detected */
  onReasoningStep?: (step: ReasoningStep) => void;
}

// ============================================================================
// Types
// ============================================================================

// Internal ScratchpadEntry type for big-brother module
interface BigBrotherScratchpadEntry {
  type: 'thought' | 'action' | 'observation';
  content: string;
  timestamp: string;
  success?: boolean;
  stepNumber?: number;
  step?: number;
  thought?: string;
  action?: {
    tool: string;
    args: any;
  };
  observation?: {
    success: boolean;
    content: string;
  };
}

export interface EscalationRequest {
  goal: string;
  stuckReason: string;
  errorType: 'repeated_failures' | 'no_progress' | 'timeout_approaching' | null;
  scratchpad: BigBrotherScratchpadEntry[];
  context: any;
  suggestions: string[];
  /** Session ID for streaming correlation with UI */
  sessionId?: string;
  /** Optional preferred backend to use */
  preferredBackend?: string;
}

export interface EscalationResponse {
  success: boolean;
  suggestions: string[];
  reasoning: string;
  alternativeApproach?: string;
  error?: string;
  /** Which backend was used */
  backend?: string;
  /** Reasoning steps captured during Big Brother execution */
  reasoningSteps?: Array<{
    type: 'thought' | 'action' | 'observation' | 'result' | 'tool_use';
    content: string;
    timestamp: string;
    toolName?: string;
  }>;
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the escalation prompt from the request
 */
function buildEscalationPrompt(request: EscalationRequest): string {
  const scratchpadSummary = request.scratchpad
    .map((entry) => {
      let text = `Step ${entry.step}: ${entry.thought}`;
      if (entry.action) {
        text += `\n  Action: ${entry.action.tool}(${JSON.stringify(entry.action.args)})`;
      }
      if (entry.observation) {
        const status = entry.observation.success ? '✓' : '✗';
        text += `\n  Result [${status}]: ${entry.observation.content.substring(0, 200)}`;
      }
      return text;
    })
    .join('\n\n');

  return `I'm an AI operator that has gotten stuck trying to help a user. I need your guidance on how to proceed.

**User's Goal:**
${request.goal}

**Why I'm Stuck:**
${request.stuckReason}

**Error Type:** ${request.errorType || 'unknown'}

**What I've Tried (Scratchpad):**
${scratchpadSummary}

**My Initial Suggestions:**
${request.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

**Context:**
${JSON.stringify(request.context, null, 2)}

---

Please analyze what went wrong and provide:
1. **Root Cause:** Why did I get stuck?
2. **Recovery Strategy:** Specific steps to recover and make progress
3. **Alternative Approach:** A different way to achieve the goal that avoids the failure
4. **Lessons Learned:** What should I do differently next time?

Please be specific and actionable. I need concrete steps I can take.`;
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Extract suggestions from the response
 */
function extractSuggestions(response: string): string[] {
  const suggestions: string[] = [];

  const lines = response.split('\n');
  for (const line of lines) {
    // Match numbered items like "1. ", "2. ", etc.
    const numberedMatch = line.match(/^\s*\d+\.\s+(.+)/);
    if (numberedMatch) {
      suggestions.push(numberedMatch[1].trim());
    }

    // Match bullet points like "- ", "* ", etc.
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (bulletMatch && !line.match(/^\s*[-*]+\s*$/)) {
      suggestions.push(bulletMatch[1].trim());
    }
  }

  return suggestions.slice(0, 5);
}

/**
 * Extract reasoning from the response
 */
function extractReasoning(response: string): string {
  const rootCauseMatch = response.match(/# Root Cause[^\n]*\n\n([^#]+)/i);
  if (rootCauseMatch) {
    return rootCauseMatch[1].trim();
  }

  const paragraphs = response.split('\n\n');
  return paragraphs[0].replace(/^#+ /, '').trim();
}

/**
 * Extract alternative approach from the response
 */
function extractAlternativeApproach(response: string): string | undefined {
  const altMatch = response.match(/# Alternative Approach[^\n]*\n\n([^#]+)/i);
  if (altMatch) {
    return altMatch[1].trim();
  }
  return undefined;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Escalate a stuck state to Big Brother (configurable backend) for guidance.
 *
 * @param request - The escalation request with goal, context, etc.
 * @param config - Operator configuration
 * @param streamingCallbacks - Optional callbacks for real-time UI streaming
 */
export async function escalateToBigBrother(
  request: EscalationRequest,
  config: OperatorConfig,
  streamingCallbacks?: EscalationStreamingCallbacks
): Promise<EscalationResponse> {
  const bigBrotherConfig = config.bigBrotherMode;

  if (!bigBrotherConfig?.enabled) {
    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_disabled',
      details: { goal: request.goal },
      actor: 'big-brother',
    });

    return {
      success: false,
      suggestions: request.suggestions,
      reasoning: 'Big Brother mode is disabled',
      error: 'Feature disabled',
    };
  }

  // Determine which backend to use
  // Priority: request.preferredBackend > config.provider > tool-executor config > default
  let backendId = request.preferredBackend || bigBrotherConfig.provider;

  // If using legacy provider names, map them
  if (backendId === 'ollama' || backendId === 'openai') {
    // These are now handled via open-interpreter with appropriate LLM proxy config
    backendId = 'open-interpreter';
  }

  // Auto-start the interactive terminal for Claude Code only
  if (backendId === 'claude-code' && !isBigBrotherReady()) {
    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_auto_starting',
      details: { goal: request.goal },
      actor: 'big-brother',
    });

    const terminalStarted = await ensureBigBrotherTerminal();
    if (terminalStarted) {
      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_terminal_auto_started',
        details: { port: 3099 },
        actor: 'big-brother',
      });

      // Emit event for UI to open the terminal tab
      bigBrotherTerminal.emit('open_tab', { port: 3099, url: 'http://localhost:3099' });
    } else {
      audit({
        level: 'warn',
        category: 'action',
        event: 'big_brother_terminal_auto_start_failed',
        details: { goal: request.goal },
        actor: 'big-brother',
      });
      // Continue with background mode if terminal fails
    }
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'big_brother_escalation_started',
    details: {
      goal: request.goal,
      stuckReason: request.stuckReason,
      errorType: request.errorType,
      scratchpadSteps: request.scratchpad.length,
      backend: backendId,
      sessionId: request.sessionId,
    },
    actor: 'big-brother',
  });

  // Build the escalation prompt
  const prompt = buildEscalationPrompt(request);

  // Collect reasoning steps
  const reasoningSteps: Array<{
    type: 'thought' | 'action' | 'observation' | 'result' | 'tool_use';
    content: string;
    timestamp: string;
    toolName?: string;
  }> = [];

  try {
    // Execute via backend abstraction
    // Use longer timeout for review tasks (300s) as Claude needs time to analyze
    const result: EscalationResult = await escalateViaBackend(prompt, {
      timeout: 300000,
      sessionId: request.sessionId,
      preferredBackend: backendId,
      // Forward streaming callbacks for real-time UI display
      onChunk: streamingCallbacks?.onChunk,
      onWaitingForInput: streamingCallbacks?.onWaitingForInput,
      onReasoningStep: (step) => {
        const label = step.toolName ? `${step.type}(${step.toolName})` : step.type;
        console.log(`[big-brother] 🧠 ${label}: ${step.content.substring(0, 80)}`);

        // Collect reasoning steps for return
        reasoningSteps.push({
          type: step.type,
          content: step.content,
          timestamp: step.timestamp,
          toolName: step.toolName,
        });

        // Also forward to caller's callback if provided
        streamingCallbacks?.onReasoningStep?.(step);
      },
    });

    if (!result.success) {
      audit({
        level: 'warn',
        category: 'action',
        event: 'big_brother_escalation_failed',
        details: {
          goal: request.goal,
          error: result.error,
          backend: backendId,
          sessionId: request.sessionId,
        },
        actor: 'big-brother',
      });

      return {
        success: false,
        suggestions: request.suggestions,
        reasoning: result.error || 'Escalation failed',
        error: result.error,
        backend: backendId,
      };
    }

    // Parse the response
    const suggestions = extractSuggestions(result.output);
    const reasoning = extractReasoning(result.output);
    const alternativeApproach = extractAlternativeApproach(result.output);

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_escalation_success',
      details: {
        goal: request.goal,
        suggestionsCount: suggestions.length,
        hasAlternativeApproach: !!alternativeApproach,
        backend: backendId,
        executionTime: result.executionTime,
        sessionId: request.sessionId,
      },
      actor: 'big-brother',
    });

    // Append reasoning steps to conversation buffer for Inner Dialogue display
    if (reasoningSteps.length > 0) {
      try {
        const { appendReasoningToBuffer } = await import('./conversation-buffer.js');

        // Format reasoning steps for display
        const formattedSteps = reasoningSteps
          .map(step => {
            const icon = step.type === 'tool_use' ? '🔧' :
                        step.type === 'thought' ? '💭' :
                        step.type === 'action' ? '⚡' :
                        step.type === 'observation' ? '👁️' : '📝';
            const label = step.toolName ? `${step.type}(${step.toolName})` : step.type;
            return `${icon} **${label}**: ${step.content}`;
          })
          .join('\n\n');

        const userId = request.context?.userId || 'system';
        await appendReasoningToBuffer(userId, `🤖 **Big Brother Analysis**\n\n${formattedSteps}`, {
          dialogueSource: 'big-brother',
          displayColor: '#8b5cf6', // Purple for Big Brother
          type: 'big_brother_reasoning',
        });
      } catch (bufferError) {
        console.warn('[big-brother] Failed to append reasoning to buffer:', bufferError);
      }
    }

    return {
      success: true,
      suggestions: suggestions.length > 0 ? suggestions : request.suggestions,
      reasoning,
      alternativeApproach,
      backend: backendId,
      reasoningSteps, // Include for API consumers
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_escalation_error',
      details: {
        goal: request.goal,
        error: (error as Error).message,
        backend: backendId,
        sessionId: request.sessionId,
      },
      actor: 'big-brother',
    });

    return {
      success: false,
      suggestions: request.suggestions,
      reasoning: 'Escalation failed - using original suggestions',
      error: (error as Error).message,
      backend: backendId,
    };
  }
}

/**
 * Check if big brother mode should be triggered for this situation
 */
export function shouldEscalateToBigBrother(
  config: OperatorConfig,
  errorType: 'repeated_failures' | 'no_progress' | 'timeout_approaching' | null,
  retryCount: number
): boolean {
  const bigBrotherConfig = config.bigBrotherMode;

  if (!bigBrotherConfig?.enabled) {
    return false;
  }

  if (retryCount >= (bigBrotherConfig.maxRetries || 1)) {
    return false;
  }

  if (errorType === 'repeated_failures' && bigBrotherConfig.escalateOnRepeatedFailures) {
    return true;
  }

  if ((errorType === 'no_progress' || errorType === 'timeout_approaching') && bigBrotherConfig.escalateOnStuck) {
    return true;
  }

  return false;
}

/**
 * Check if a specific error should trigger Big Brother escalation
 */
export function shouldEscalateForError(
  config: OperatorConfig,
  errorCode: string,
  errorCount: number
): boolean {
  const bigBrotherConfig = config.bigBrotherMode;

  if (!bigBrotherConfig?.enabled) {
    return false;
  }

  const criticalErrors = ['FILE_NOT_FOUND', 'PERMISSION_DENIED', 'NETWORK_ERROR', 'SKILL_NOT_FOUND'];

  if (errorCount >= 3 && bigBrotherConfig.escalateOnRepeatedFailures) {
    return true;
  }

  if (criticalErrors.includes(errorCode) && errorCount >= 2) {
    return true;
  }

  return false;
}

/**
 * Get the currently active escalation backend
 */
export function getActiveEscalationBackend(username?: string) {
  return getActiveBackend(username);
}

/**
 * Check if escalation is available
 */
export async function isEscalationAvailable(username?: string): Promise<boolean> {
  await ensureBackendsInitialized();
  const backend = getActiveBackend(username);
  if (!backend) return false;
  return backend.isAvailable();
}

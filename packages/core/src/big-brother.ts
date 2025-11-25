/**
 * Big Brother Mode - CLI LLM Escalation
 *
 * When the operator gets stuck or encounters repeated failures, escalate to
 * a CLI LLM (like Claude Code) for guidance and suggestions.
 *
 * This provides a safety net when the local operator cannot resolve issues
 * independently, allowing for human-level problem solving intervention.
 */

import { spawn } from 'child_process';
import { audit } from './audit.js';
import type { OperatorConfig } from './config.js';
import type { ScratchpadEntry } from '../../brain/agents/operator-react.js';

// ============================================================================
// Types
// ============================================================================

export interface EscalationRequest {
  goal: string;
  stuckReason: string;
  errorType: 'repeated_failures' | 'no_progress' | 'timeout_approaching' | null;
  scratchpad: ScratchpadEntry[];
  context: any;
  suggestions: string[];
}

export interface EscalationResponse {
  success: boolean;
  suggestions: string[];
  reasoning: string;
  alternativeApproach?: string;
  error?: string;
}

// ============================================================================
// CLI LLM Integration
// ============================================================================

/**
 * Escalate to Claude Code CLI for guidance
 */
async function escalateToClaudeCode(request: EscalationRequest): Promise<EscalationResponse> {
  audit({
    level: 'info',
    category: 'action',
    event: 'big_brother_escalation_claude_code',
    details: {
      goal: request.goal,
      stuckReason: request.stuckReason,
      errorType: request.errorType,
      scratchpadSteps: request.scratchpad.length,
    },
    actor: 'big-brother',
  });

  // Build the escalation prompt
  const scratchpadSummary = request.scratchpad
    .map((entry, i) => {
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

  const prompt = `I'm an AI operator that has gotten stuck trying to help a user. I need your guidance on how to proceed.

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

  try {
    // Use Claude Code CLI to get guidance
    // For now, we'll use a simpler approach: spawn a child process with the prompt
    const response = await callClaudeCLI(prompt);

    // Parse the response to extract actionable suggestions
    const suggestions = extractSuggestions(response);
    const reasoning = extractReasoning(response);
    const alternativeApproach = extractAlternativeApproach(response);

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_escalation_success',
      details: {
        goal: request.goal,
        suggestionsCount: suggestions.length,
        hasAlternativeApproach: !!alternativeApproach,
      },
      actor: 'big-brother',
    });

    return {
      success: true,
      suggestions,
      reasoning,
      alternativeApproach,
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_escalation_failed',
      details: {
        goal: request.goal,
        error: (error as Error).message,
      },
      actor: 'big-brother',
    });

    return {
      success: false,
      suggestions: request.suggestions, // Fall back to original suggestions
      reasoning: 'Escalation failed - using original suggestions',
      error: (error as Error).message,
    };
  }
}

/**
 * Call Claude CLI with a prompt using persistent session
 */
async function callClaudeCLI(prompt: string): Promise<string> {
  const { isClaudeSessionReady, sendPrompt, startClaudeSession } = await import('./claude-session.js');

  // Ensure session is ready
  if (!isClaudeSessionReady()) {
    audit({
      level: 'warn',
      category: 'action',
      event: 'claude_session_not_ready_auto_start',
      details: {},
      actor: 'big-brother',
    });

    const started = await startClaudeSession();
    if (!started) {
      throw new Error('Failed to start Claude CLI session');
    }
  }

  try {
    // Send prompt and get response
    const response = await sendPrompt(prompt, 60000); // 60 second timeout for complex analysis

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_response_received',
      details: {
        promptLength: prompt.length,
        responseLength: response.length,
      },
      actor: 'big-brother',
    });

    return response;
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'claude_call_failed',
      details: {
        error: (error as Error).message,
      },
      actor: 'big-brother',
    });
    throw error;
  }
}

/**
 * Check if Claude CLI is available
 */
async function checkClaudeCLIAvailable(): Promise<boolean> {
  const { isClaudeInstalled } = await import('./claude-session.js');
  return isClaudeInstalled();
}

/**
 * Extract suggestions from Claude's response
 */
function extractSuggestions(response: string): string[] {
  const suggestions: string[] = [];

  // Look for numbered lists or bullet points
  const lines = response.split('\n');
  for (const line of lines) {
    // Match numbered items like "1. ", "2. ", etc.
    const numberedMatch = line.match(/^\s*\d+\.\s+(.+)/);
    if (numberedMatch) {
      suggestions.push(numberedMatch[1].trim());
    }

    // Match bullet points like "- ", "* ", etc.
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (bulletMatch && !line.match(/^\s*[-*]+\s*$/)) { // Ignore separator lines
      suggestions.push(bulletMatch[1].trim());
    }
  }

  return suggestions.slice(0, 5); // Return top 5 suggestions
}

/**
 * Extract reasoning from Claude's response
 */
function extractReasoning(response: string): string {
  // Look for "Root Cause" or "Analysis" sections
  const rootCauseMatch = response.match(/# Root Cause[^\n]*\n\n([^#]+)/i);
  if (rootCauseMatch) {
    return rootCauseMatch[1].trim();
  }

  // Fall back to first paragraph
  const paragraphs = response.split('\n\n');
  return paragraphs[0].replace(/^#+ /, '').trim();
}

/**
 * Extract alternative approach from Claude's response
 */
function extractAlternativeApproach(response: string): string | undefined {
  const altMatch = response.match(/# Alternative Approach[^\n]*\n\n([^#]+)/i);
  if (altMatch) {
    return altMatch[1].trim();
  }
  return undefined;
}

/**
 * Escalate to Ollama for guidance
 */
async function escalateToOllama(request: EscalationRequest, config: OperatorConfig): Promise<EscalationResponse> {
  // TODO: Implement Ollama escalation
  audit({
    level: 'warn',
    category: 'action',
    event: 'big_brother_ollama_not_implemented',
    details: { goal: request.goal },
    actor: 'big-brother',
  });

  return {
    success: false,
    suggestions: request.suggestions,
    reasoning: 'Ollama escalation not yet implemented',
    error: 'Provider not implemented',
  };
}

/**
 * Escalate to OpenAI for guidance
 */
async function escalateToOpenAI(request: EscalationRequest, config: OperatorConfig): Promise<EscalationResponse> {
  // TODO: Implement OpenAI escalation
  audit({
    level: 'warn',
    category: 'action',
    event: 'big_brother_openai_not_implemented',
    details: { goal: request.goal },
    actor: 'big-brother',
  });

  return {
    success: false,
    suggestions: request.suggestions,
    reasoning: 'OpenAI escalation not yet implemented',
    error: 'Provider not implemented',
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Escalate a stuck state to Big Brother (CLI LLM) for guidance
 */
export async function escalateToBigBrother(
  request: EscalationRequest,
  config: OperatorConfig
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

  // Route to appropriate provider
  switch (bigBrotherConfig.provider) {
    case 'claude-code':
      return escalateToClaudeCode(request);
    case 'ollama':
      return escalateToOllama(request, config);
    case 'openai':
      return escalateToOpenAI(request, config);
    default:
      return {
        success: false,
        suggestions: request.suggestions,
        reasoning: `Unknown provider: ${bigBrotherConfig.provider}`,
        error: 'Invalid provider',
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

  // Check if we've exceeded max retries
  if (retryCount >= (bigBrotherConfig.maxRetries || 1)) {
    return false; // Already tried escalation
  }

  // Check escalation conditions
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

  // Critical errors that should escalate immediately
  const criticalErrors = ['FILE_NOT_FOUND', 'PERMISSION_DENIED', 'NETWORK_ERROR', 'SKILL_NOT_FOUND'];

  // Escalate if error occurred multiple times (3+)
  if (errorCount >= 3 && bigBrotherConfig.escalateOnRepeatedFailures) {
    return true;
  }

  // Escalate critical errors after 2 occurrences
  if (criticalErrors.includes(errorCode) && errorCount >= 2) {
    return true;
  }

  return false;
}

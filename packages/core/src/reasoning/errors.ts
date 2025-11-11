/**
 * Reasoning Service - Error Analysis
 *
 * Contextual error analysis with recovery suggestions.
 * Extracted from Operator V2.
 */

import type { ErrorAnalysis } from './types';

/**
 * Analyze error and provide contextual suggestions.
 *
 * Categorizes errors into 7 types with specific recovery suggestions:
 * - FILE_NOT_FOUND: File system errors
 * - TASK_NOT_FOUND: Task management errors
 * - PERMISSION_DENIED: Access control errors
 * - INVALID_ARGS: Input validation errors
 * - NETWORK_ERROR: Connectivity errors
 * - SKILL_NOT_FOUND: Unknown tool errors
 * - UNKNOWN_ERROR: Catch-all
 *
 * @param tool - Tool name that failed
 * @param args - Arguments passed to tool
 * @param errorMessage - Error message from execution
 * @returns Error analysis with code and suggestions
 */
export function analyzeError(tool: string, args: any, errorMessage: string): ErrorAnalysis {
  const errorLower = errorMessage.toLowerCase();

  // File not found errors
  if (errorLower.includes('not found') || errorLower.includes('enoent')) {
    if (tool === 'fs_read' || tool === 'fs_write' || tool === 'fs_delete') {
      return {
        code: 'FILE_NOT_FOUND',
        message: errorMessage,
        suggestions: [
          'Use fs_list to check what files exist in the directory',
          'Verify the file path is correct',
          'Check if the file was recently deleted or moved',
        ],
        context: { tool, args },
      };
    }

    if (tool === 'task_find' || tool === 'task_list') {
      return {
        code: 'TASK_NOT_FOUND',
        message: errorMessage,
        suggestions: [
          'Use task_list to see all available tasks',
          'Check if the task was already completed',
          'Verify the task ID is correct',
        ],
        context: { tool, args },
      };
    }
  }

  // Permission errors
  if (errorLower.includes('permission') || errorLower.includes('eacces')) {
    return {
      code: 'PERMISSION_DENIED',
      message: errorMessage,
      suggestions: [
        'Check file/directory permissions',
        'Verify you have access to this location',
        'Try a different file or directory',
      ],
      context: { tool, args },
    };
  }

  // Invalid arguments
  if (errorLower.includes('invalid') || errorLower.includes('validation')) {
    return {
      code: 'INVALID_ARGS',
      message: errorMessage,
      suggestions: [
        'Check the skill manifest for correct input format',
        'Verify all required fields are provided',
        'Check data types match the schema',
      ],
      context: { tool, args },
    };
  }

  // Network errors
  if (
    errorLower.includes('network') ||
    errorLower.includes('timeout') ||
    errorLower.includes('econnrefused')
  ) {
    return {
      code: 'NETWORK_ERROR',
      message: errorMessage,
      suggestions: [
        'Check network connectivity',
        'Try again in a moment',
        'Verify the URL or endpoint is correct',
      ],
      context: { tool, args },
    };
  }

  // Skill not found
  if (errorLower.includes('skill') && errorLower.includes('not found')) {
    return {
      code: 'SKILL_NOT_FOUND',
      message: errorMessage,
      suggestions: [
        'Check available skills in the tool catalog',
        'Verify the skill ID is spelled correctly',
        'Use a similar skill that exists',
      ],
      context: { tool, args },
    };
  }

  // Generic error
  return {
    code: 'UNKNOWN_ERROR',
    message: errorMessage,
    suggestions: [
      'Try a different approach',
      'Ask the user for clarification',
      'Check the logs for more details',
    ],
    context: { tool, args },
  };
}

/**
 * Format error with suggestions for display.
 *
 * @param analysis - Error analysis result
 * @returns Formatted error message with suggestions
 */
export function formatErrorWithSuggestions(analysis: ErrorAnalysis): string {
  let formatted = `❌ ${analysis.code}: ${analysis.message}`;

  if (analysis.suggestions.length > 0) {
    formatted += '\n\nSuggestions:\n' + analysis.suggestions.map((s) => `- ${s}`).join('\n');
  }

  return formatted;
}

/**
 * Check if error is retryable.
 *
 * @param code - Error code from analysis
 * @returns True if error suggests retry might succeed
 */
export function isRetryable(code: string): boolean {
  const retryableCodes = ['NETWORK_ERROR', 'UNKNOWN_ERROR'];
  return retryableCodes.includes(code);
}

/**
 * Check if error is terminal (no point retrying).
 *
 * @param code - Error code from analysis
 * @returns True if error is permanent
 */
export function isTerminal(code: string): boolean {
  const terminalCodes = ['SKILL_NOT_FOUND', 'PERMISSION_DENIED', 'INVALID_ARGS'];
  return terminalCodes.includes(code);
}

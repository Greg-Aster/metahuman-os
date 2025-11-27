/**
 * Shared Observation Formatter
 *
 * Formats skill results into human-readable observations for the ReAct loop.
 * Used by both the standalone operator (brain/agents/operator-react.ts)
 * and the node executor (packages/core/src/node-executors/operator-executors.ts).
 */

import type { SkillResult } from '../skills.js';

export interface ObservationConfig {
  maxLength: number;
  includeErrorRecovery?: boolean;
}

export const DEFAULT_OBSERVATION_CONFIG: ObservationConfig = {
  maxLength: 500,
  includeErrorRecovery: true,
};

/**
 * Format a skill result into a human-readable observation string.
 *
 * @param result - The skill execution result
 * @param config - Formatting configuration
 * @returns Formatted observation string
 */
export function formatObservation(
  result: SkillResult | null | undefined,
  config: ObservationConfig = DEFAULT_OBSERVATION_CONFIG
): string {
  if (result === null || result === undefined) {
    return 'No result returned';
  }

  // Handle error results
  if (result.success === false) {
    let errorMsg = `Error: ${result.error || 'Unknown error'}`;

    // Include error recovery suggestions if available
    if (config.includeErrorRecovery && (result as any).errorRecovery) {
      const { errorType, suggestions, wasRetried } = (result as any).errorRecovery;
      errorMsg += `\nError Type: ${errorType}`;

      if (wasRetried) {
        errorMsg += ` (auto-retry attempted)`;
      }

      if (suggestions && suggestions.length > 0) {
        errorMsg += `\nSuggestions:\n${suggestions.map((s: string) => `  - ${s}`).join('\n')}`;
      }
    }

    return errorMsg;
  }

  // Handle success results with outputs
  if (result.success === true && result.outputs) {
    const outputs = result.outputs;

    // Special formatting for common skill types
    if (outputs.files && Array.isArray(outputs.files)) {
      // fs_list result
      const fileList = outputs.files;
      if (fileList.length === 0) {
        return 'No files found';
      }
      if (fileList.length <= 10) {
        return `Found ${fileList.length} file(s): ${fileList.join(', ')}`;
      }
      return `Found ${fileList.length} file(s): ${fileList.slice(0, 10).join(', ')} ... and ${fileList.length - 10} more`;
    }

    if (outputs.content && typeof outputs.content === 'string') {
      // fs_read result
      const content = outputs.content;
      const charCount = content.length;
      const lineCount = content.split('\n').length;

      if (charCount <= config.maxLength) {
        return `File content (${charCount} chars, ${lineCount} lines):\n${content}`;
      }

      // Truncate with preview
      const preview = content.substring(0, Math.min(200, config.maxLength));
      return `File content (${charCount} chars, ${lineCount} lines). Preview:\n${preview}\n... (content truncated, ${charCount - preview.length} chars remaining)`;
    }

    if (outputs.results && Array.isArray(outputs.results)) {
      // search_index or web_search result
      const results = outputs.results;
      if (results.length === 0) {
        return 'No results found';
      }
      return `Found ${results.length} result(s):\n${results.slice(0, 5).map((r: any, i: number) =>
        `${i + 1}. ${r.title || r.event || r.url || JSON.stringify(r).substring(0, 100)}`
      ).join('\n')}${results.length > 5 ? `\n... and ${results.length - 5} more` : ''}`;
    }

    if (outputs.tasks && Array.isArray(outputs.tasks)) {
      // task_list result
      const tasks = outputs.tasks;
      if (tasks.length === 0) {
        return 'No tasks found';
      }

      const formatValue = (label: string, value?: string) => value ? `${label}: ${value}` : '';

      const formatTask = (task: any, index: number) => {
        const parts = [
          `title: ${task.title || task.goal || task.description || task.id || 'Untitled task'}`,
          formatValue('status', task.status),
          formatValue('priority', task.priority),
          formatValue('tags', Array.isArray(task.tags) ? task.tags.join(', ') : task.tags),
          formatValue('due', task.due),
          formatValue('created', task.created),
          formatValue('description', task.description)
        ].filter(Boolean);
        return `${index + 1}. ${parts.join(' | ')}`;
      };

      return `Found ${tasks.length} task(s):\n${tasks.map((task: any, idx: number) => formatTask(task, idx)).join('\n')}`;
    }

    if (outputs.response && typeof outputs.response === 'string') {
      // conversational_response result - return the response directly
      return outputs.response;
    }

    // Generic output formatting
    const dataStr = JSON.stringify(outputs, null, 2);
    if (dataStr.length <= config.maxLength) {
      return `Success. Output:\n${dataStr}`;
    }

    return `Success. Output preview:\n${dataStr.substring(0, config.maxLength)}\n... (output truncated)`;
  }

  // Simple success with no outputs
  if (result.success === true) {
    return 'Success (no output data)';
  }

  // Fallback
  const resultStr = JSON.stringify(result, null, 2);
  if (resultStr.length <= config.maxLength) {
    return resultStr;
  }
  return resultStr.substring(0, config.maxLength) + '... (truncated)';
}

/**
 * Format observation for V2 scratchpad with different modes.
 *
 * @param tool - The tool/skill that was executed
 * @param result - The skill execution result
 * @param mode - Observation mode (verbatim, structured, narrative)
 * @returns Formatted observation object
 */
export function formatObservationV2(
  tool: string,
  result: SkillResult,
  mode: 'verbatim' | 'structured' | 'narrative' = 'narrative'
): { content: string; mode: 'verbatim' | 'structured' | 'narrative'; success: boolean } {
  const success = result.success !== false;

  switch (mode) {
    case 'verbatim':
      // Raw JSON output - useful for data retrieval
      return {
        content: JSON.stringify(result.outputs || result, null, 2),
        mode: 'verbatim',
        success,
      };

    case 'structured':
      // Bullet list format - only observed data
      return {
        content: formatStructured(tool, result),
        mode: 'structured',
        success,
      };

    case 'narrative':
    default:
      // Human-readable summary
      return {
        content: formatObservation(result, DEFAULT_OBSERVATION_CONFIG),
        mode: 'narrative',
        success,
      };
  }
}

/**
 * Format result as structured bullet list.
 */
function formatStructured(tool: string, result: SkillResult): string {
  if (!result.success) {
    return `• Error executing ${tool}: ${result.error || 'Unknown error'}`;
  }

  const outputs = result.outputs || {};
  const lines: string[] = [`• Tool: ${tool}`];

  if (outputs.files) {
    lines.push(`• Files found: ${outputs.files.length}`);
    outputs.files.slice(0, 5).forEach((f: string) => lines.push(`  - ${f}`));
    if (outputs.files.length > 5) {
      lines.push(`  ... and ${outputs.files.length - 5} more`);
    }
  }

  if (outputs.content) {
    const preview = outputs.content.substring(0, 100);
    lines.push(`• Content preview: ${preview}${outputs.content.length > 100 ? '...' : ''}`);
  }

  if (outputs.results) {
    lines.push(`• Results: ${outputs.results.length} items`);
  }

  if (outputs.tasks) {
    lines.push(`• Tasks: ${outputs.tasks.length} items`);
  }

  if (outputs.response) {
    lines.push(`• Response: ${outputs.response.substring(0, 200)}${outputs.response.length > 200 ? '...' : ''}`);
  }

  if (lines.length === 1) {
    // Only tool name, add generic output
    lines.push(`• Output: ${JSON.stringify(outputs).substring(0, 200)}`);
  }

  return lines.join('\n');
}

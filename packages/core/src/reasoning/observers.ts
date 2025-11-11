/**
 * Reasoning Service - Observation Formatting
 *
 * Three observation modes for formatting skill outputs:
 * - Verbatim: Raw JSON (no interpretation)
 * - Structured: Bullet lists, tables (skill-specific formatting)
 * - Narrative: Human-readable summaries
 *
 * Extracted from Operator V2.
 */

import type { ObservationResult, ObservationMode } from './types';

// Note: SkillResult type from skills module
interface SkillResult {
  success: boolean;
  outputs?: any;
  error?: string;
}

/**
 * Format observation based on mode.
 *
 * @param tool - Tool name
 * @param result - Skill execution result
 * @param mode - Observation mode
 * @returns Formatted observation
 */
export function formatObservationV2(
  tool: string,
  result: SkillResult,
  mode: ObservationMode = 'narrative'
): ObservationResult {
  if (!result.success) {
    return {
      mode,
      content: `Error executing ${tool}: ${result.error || 'Unknown error'}`,
      success: false,
      error: {
        code: 'SKILL_ERROR',
        message: result.error || 'Unknown error',
        context: { tool, result },
      },
    };
  }

  switch (mode) {
    case 'verbatim':
      return {
        mode,
        content: JSON.stringify(result.outputs, null, 2),
        success: true,
      };

    case 'structured':
      return {
        mode,
        content: formatStructured(tool, result),
        success: true,
      };

    case 'narrative':
    default:
      return {
        mode,
        content: formatNarrative(tool, result),
        success: true,
      };
  }
}

/**
 * Format observation as structured data (bullet lists/tables).
 * Skill-specific formatting for common tools.
 */
function formatStructured(tool: string, result: SkillResult): string {
  const outputs = result.outputs || {};

  switch (tool) {
    case 'task_list': {
      const tasks = outputs.tasks || [];
      if (tasks.length === 0) return '• No tasks found';

      return tasks
        .map(
          (t: any) =>
            `• [${t.status || 'unknown'}] ${t.title || t.goal || 'Untitled'} (priority: ${
              t.priority || 'none'
            })`
        )
        .join('\n');
    }

    case 'fs_list': {
      const files = outputs.files || [];
      const dirs = outputs.directories || [];

      let text = '';
      if (dirs.length > 0) {
        text += `Directories (${dirs.length}):\n${dirs.map((d: string) => `  📁 ${d}`).join('\n')}\n`;
      }
      if (files.length > 0) {
        text += `Files (${files.length}):\n${files.map((f: string) => `  📄 ${f}`).join('\n')}`;
      }

      return text || '(empty directory)';
    }

    case 'fs_read': {
      const content = outputs.content || '';
      const lines = content.split('\n').length;
      return `File size: ${content.length} chars, ${lines} lines\n\nContent:\n${content}`;
    }

    case 'task_find':
    case 'task_create':
    case 'task_update_status': {
      const task = outputs.task || outputs;
      return `• Task: ${task.title || task.goal || 'Untitled'}\n• Status: ${
        task.status || 'unknown'
      }\n• Priority: ${task.priority || 'none'}`;
    }

    case 'web_search': {
      const results = outputs.results || [];
      if (results.length === 0) return '• No results found';

      return results
        .slice(0, 5)
        .map(
          (r: any, i: number) =>
            `${i + 1}. ${r.title || 'Untitled'}\n   URL: ${r.url || 'N/A'}\n   Snippet: ${
              r.snippet || 'No description'
            }`
        )
        .join('\n\n');
    }

    case 'search_index': {
      const results = outputs.results || [];
      if (results.length === 0) return '• No results found';

      return results
        .slice(0, 5)
        .map(
          (r: any, i: number) =>
            `${i + 1}. ${r.event || r.title || 'Untitled'} (score: ${r.score?.toFixed(2) || 'N/A'})`
        )
        .join('\n');
    }

    default:
      // Generic structured format
      return Object.entries(outputs)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join('\n');
  }
}

/**
 * Format observation as narrative (human-readable summary).
 * Uses generic formatting for now - can be enhanced later.
 */
function formatNarrative(tool: string, result: SkillResult): string {
  const outputs = result.outputs || {};

  // Simple narrative format
  switch (tool) {
    case 'task_list': {
      const tasks = outputs.tasks || [];
      if (tasks.length === 0) return 'No tasks found.';
      return `Found ${tasks.length} task(s).`;
    }

    case 'fs_list': {
      const files = outputs.files || [];
      const dirs = outputs.directories || [];
      return `Found ${dirs.length} director(ies) and ${files.length} file(s).`;
    }

    case 'fs_read': {
      const content = outputs.content || '';
      return `File read successfully (${content.length} characters).`;
    }

    case 'task_create':
      return 'Task created successfully.';

    case 'task_update_status':
      return 'Task status updated.';

    case 'web_search': {
      const results = outputs.results || [];
      return `Found ${results.length} search result(s).`;
    }

    case 'conversational_response':
      return outputs.response || 'Response generated.';

    default:
      // Generic success message
      return `${tool} executed successfully.`;
  }
}

/**
 * Detect if goal is a data retrieval query (for verbatim short-circuit).
 */
export function detectDataRetrievalIntent(goal: string): boolean {
  const dataKeywords = [
    'list',
    'show',
    'what tasks',
    'display',
    'read file',
    'get',
    'fetch',
    'retrieve',
    'search for',
    'find all',
    'tell me about my tasks',
    'show me',
    'what are',
  ];

  const goalLower = goal.toLowerCase();
  return dataKeywords.some((keyword) => goalLower.includes(keyword));
}

/**
 * Check if we can short-circuit with verbatim response (skip planning loop).
 * Currently only handles task_list queries.
 *
 * @param goal - User goal
 * @param executeSkill - Skill execution function (injected)
 * @param onProgress - Progress callback
 * @returns Verbatim result or null
 */
export async function checkVerbatimShortCircuit(
  goal: string,
  executeSkill: (tool: string, args: any) => Promise<SkillResult>,
  onProgress?: (update: any) => void
): Promise<any | null> {
  if (!detectDataRetrievalIntent(goal)) {
    return null; // Not a data query
  }

  // Simple heuristic: if goal mentions "tasks", try task_list
  if (goal.toLowerCase().includes('task')) {
    try {
      const result = await executeSkill('task_list', { includeCompleted: false });

      if (result.success) {
        const observation = formatObservationV2('task_list', result, 'structured');

        onProgress?.({
          type: 'completion',
          content: observation.content,
          step: 1,
          verbatim: true,
        });

        return {
          goal,
          result: observation.content,
          reasoning: 'Direct task list retrieval (verbatim mode)',
          actions: ['task_list'],
          verbatim: true,
          scratchpad: [],
          metadata: {
            stepsExecuted: 0,
            fastPathUsed: true,
            verbatimShortCircuit: true,
            totalDuration: 0,
            llmCalls: 0,
            errors: 0,
          },
        };
      }
    } catch (error) {
      // Fall through to normal loop
      return null;
    }
  }

  return null; // No short-circuit available
}

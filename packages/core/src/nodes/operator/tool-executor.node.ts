/**
 * Tool Executor Node
 *
 * Unified tool execution node that routes to the appropriate backend:
 * - local-skills: Native MetaHuman skill executor (default)
 * - open-interpreter: Open Interpreter Python server
 * - claude-code: Claude Code CLI (legacy)
 * - qwen-code: Qwen Code CLI (legacy)
 * - aider: Aider AI pair programming (legacy)
 * - gemini-cli: Google Gemini CLI (legacy)
 *
 * This replaces the Big Brother nodes with a more flexible, user-configurable
 * backend selection system.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { captureEvent } from '../../memory.js';
import { canWriteMemory, shouldCaptureTool } from '../../memory-policy.js';
import type { CognitiveModeId } from '../../cognitive-mode.js';
import {
  executeWithBackend,
  getActiveBackend,
  shouldEscalate,
  type ToolExecutorRequest,
  type ToolExecutorResult,
} from '../../tool-executor-backends.js';
import { loadToolExecutorConfig } from '../../tool-executor-config.js';

const execute: NodeExecutor = async (inputs, context) => {
  console.log('[ToolExecutor] ========== TOOL EXECUTOR ENTRY ==========');
  console.log('[ToolExecutor] useOperator:', context.useOperator);
  console.log('[ToolExecutor] yoloMode:', context.yoloMode);

  if (context.useOperator === false) {
    console.log('[ToolExecutor] EARLY RETURN: useOperator === false');
    return {};
  }

  // Handle Big Brother Router output for backward compatibility
  let taskInput = inputs[0] || '';
  if (taskInput && typeof taskInput === 'object' && 'localPath' in taskInput && 'claudePath' in taskInput) {
    // Big Brother router output - use localPath for local execution
    if (taskInput.localPath === null || taskInput.localPath === undefined) {
      console.log('[ToolExecutor] Skipping - routed to external path (Claude)');
      // For external routing, we might still want to use the tool executor
      // with a CLI backend if available
      taskInput = taskInput.claudePath || '';
    } else {
      taskInput = taskInput.localPath;
    }
  }

  // Extract task from various input formats
  let task: string;
  if (typeof taskInput === 'object' && taskInput.plan) {
    task = taskInput.plan;
  } else if (typeof taskInput === 'object' && taskInput.task) {
    task = taskInput.task;
  } else if (typeof taskInput === 'string') {
    task = taskInput;
  } else {
    console.error('[ToolExecutor] Invalid task input:', taskInput);
    return {
      success: false,
      error: 'Invalid task input',
      outputs: {},
    };
  }

  // Check if this is a Final Answer (passthrough)
  const finalAnswerMatch = task.match(/Final Answer:\s*(.+)/is);
  if (finalAnswerMatch) {
    const finalAnswer = finalAnswerMatch[1].trim();
    console.log('[ToolExecutor] ✅ Detected Final Answer, passing through');
    return {
      success: true,
      finalResponse: finalAnswer,
      outputs: { response: finalAnswer },
    };
  }

  const startTime = Date.now();
  const username = context.username;

  // Load configuration
  const config = loadToolExecutorConfig(username);
  const activeBackend = getActiveBackend(username);

  console.log(`[ToolExecutor] Active backend: ${activeBackend}`);

  // Build execution request
  const request: ToolExecutorRequest = {
    task,
    context: {
      conversationId: context.conversationId,
      sessionId: context.sessionId,
      workingDirectory: context.workingDirectory,
    },
  };

  // Execute with backend
  let result: ToolExecutorResult;
  let failureCount = context.failureCount || 0;
  let usedBackend = activeBackend;

  try {
    result = await executeWithBackend(request, activeBackend, username);

    // Handle escalation on failure
    if (!result.success && failureCount < 3) {
      const escalation = await shouldEscalate(failureCount + 1, activeBackend, username);

      if (escalation.escalate && escalation.escalateTo) {
        console.log(`[ToolExecutor] Escalating from ${activeBackend} to ${escalation.escalateTo}`);
        usedBackend = escalation.escalateTo;
        result = await executeWithBackend(request, escalation.escalateTo, username);
      }
    }

    if (!result.success) {
      failureCount++;
    }
  } catch (error) {
    result = {
      success: false,
      error: (error as Error).message,
      backend: activeBackend,
      executionTime: Date.now() - startTime,
    };
    failureCount++;
  }

  const executionTimeMs = Date.now() - startTime;

  // Capture tool invocation to memory
  const cognitiveMode = (context.cognitiveMode || 'dual') as CognitiveModeId;
  const allowMemoryWrites = context.allowMemoryWrites !== false;
  const canWrite = canWriteMemory(cognitiveMode, 'tool_invocation');
  const shouldCapture = shouldCaptureTool(cognitiveMode, 'tool_executor');

  if (allowMemoryWrites && canWrite && shouldCapture) {
    try {
      captureEvent(`Tool executor: ${usedBackend}`, {
        type: 'tool_invocation',
        metadata: {
          cognitiveMode,
          sessionId: context.sessionId,
          conversationId: context.conversationId,
          parentEventId: context.parentEventId,
          toolName: 'tool_executor',
          backend: usedBackend,
          task: task.slice(0, 500),
          toolOutputs: result.output ? { output: result.output.slice(0, 1000) } : {},
          success: result.success,
          error: result.error,
          executionTimeMs,
          iterationNumber: context.iterationNumber,
        },
        tags: ['tool', 'tool_executor', usedBackend, 'operator'],
      });

      console.log(`[ToolExecutor] ✓ Captured tool_invocation: ${usedBackend} (${executionTimeMs}ms)`);
    } catch (captureError) {
      console.error('[ToolExecutor] Failed to capture tool invocation:', captureError);
    }
  }

  // Format output for downstream nodes
  const outputs: Record<string, any> = {};

  if (result.output) {
    outputs.response = result.output;

    // Try to parse as JSON for structured output
    try {
      const parsed = JSON.parse(result.output);
      outputs.structured = parsed;
    } catch {
      // Not JSON, use raw output
    }
  }

  return {
    success: result.success,
    outputs,
    error: result.error,
    backend: usedBackend,
    executionTimeMs,
    failureCount,
    metadata: result.metadata,
  };
};

export const ToolExecutorNode: NodeDefinition = defineNode({
  id: 'tool_executor',
  name: 'Tool Executor',
  category: 'operator',
  inputs: [
    { name: 'task', type: 'string', description: 'Task to execute (can include Action/Action Input format)' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Execution result' },
    { name: 'success', type: 'boolean' },
    { name: 'output', type: 'string', optional: true },
    { name: 'error', type: 'string', optional: true },
    { name: 'backend', type: 'string', description: 'Backend used for execution' },
  ],
  description: 'Unified tool executor that routes to configured backend (Open Interpreter, local skills, or CLI tools)',
  execute,
});

// Export for backward compatibility
export { ToolExecutorNode as default };

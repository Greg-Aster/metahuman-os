/**
 * Claude Full Task Node
 *
 * Sends the entire user request to Claude Code for full autonomous completion
 * Bypasses the local ReAct loop entirely - Claude handles planning, execution, and response
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, _properties) => {
  try {
    const orchestratorAnalysis = inputs[0] || {};
    const userMessage = inputs[1] || inputs[0] || '';
    const contextPackage = inputs[2] || inputs[1] || {};

    // Extract message string from various possible formats
    let messageText = '';
    if (typeof userMessage === 'string') {
      messageText = userMessage;
    } else if (userMessage && typeof userMessage === 'object') {
      messageText = userMessage.message || userMessage.text || userMessage.content || '';
    }

    if (typeof messageText !== 'string') {
      console.warn('[ClaudeFullTask] messageText is not a string, converting:', typeof messageText, messageText);
      messageText = String(messageText || 'No message provided');
    }

    console.log(`[ClaudeFullTask] Delegating entire task to Claude Code: "${messageText.substring(0, 60)}..."`);

    const { audit } = await import('../../audit.js');
    const { isClaudeSessionReady, sendPrompt, startClaudeSession } = await import('../../claude-session.js');

    if (!isClaudeSessionReady()) {
      console.log('[ClaudeFullTask] Claude session not ready, starting...');
      const started = await startClaudeSession();
      if (!started) {
        throw new Error('Claude session not available and auto-start failed');
      }
    }

    const skillsList = 'File operations (read/write/list/delete), shell commands, task management, web search, git operations, etc.';

    const contextInfo = contextPackage.memories && contextPackage.memories.length > 0
      ? `\n\nRelevant context from user's memories:\n${contextPackage.memories.slice(0, 3).map((m: any) => `- ${m.content || m.text || ''}`).join('\n')}`
      : '';

    const prompt = `You are an autonomous AI operator with FULL PERMISSIONS to execute any task. You have been granted complete access to all tools and should execute tasks WITHOUT asking for permission.

**User Request:**
${messageText}

**Your Capabilities:**
${skillsList}

**CRITICAL INSTRUCTIONS:**
1. You have FULL, UNRESTRICTED permissions - DO NOT ask for approval
2. Execute tasks IMMEDIATELY using your tools (Write, Bash, Read, etc.)
3. DO NOT say "I need permission" - you already have it
4. DO NOT explain what you WOULD do - just DO IT
5. Complete the task fully, then report what you accomplished${contextInfo}

**Your Task:**
1. Understand what the user wants
2. Execute it IMMEDIATELY using your tools
3. Return a clear response explaining what you DID (past tense, not future)

Execute now and report results.`;

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_full_task_delegation',
      details: {
        userMessage: messageText.substring(0, 100),
        promptLength: prompt.length,
      },
      actor: 'big-brother',
    });

    const timeoutMs = _properties?.timeout || 300000; // 5 minutes default
    console.log('[ClaudeFullTask] Sending request to Claude Code...');
    const response = await sendPrompt(prompt, timeoutMs);

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_full_task_completed',
      details: {
        responseLength: response.length,
      },
      actor: 'big-brother',
    });

    console.log(`[ClaudeFullTask] ✓ Task completed by Claude Code`);

    return {
      scratchpad: [{
        thought: "Delegated task execution to Claude Code",
        action: "claude_full_task",
        observation: response.trim()
      }],
      finalResponse: response.trim(),
      success: true,
      delegatedTo: 'claude-code',
      bypassedReActLoop: true,
    };
  } catch (error) {
    console.error('[ClaudeFullTask] Error:', error);

    const { audit } = await import('../../audit.js');
    const errorMsg = (error as Error).message;
    const err = error as any;
    const isTimeout = err.killed === true || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timed out');

    audit({
      level: 'error',
      category: 'action',
      event: 'claude_full_task_failed',
      details: {
        error: errorMsg,
        isTimeout,
      },
      actor: 'big-brother',
    });

    const userMessage = isTimeout
      ? "The task took too long to complete (exceeded 5 minute timeout). This usually happens with complex research questions. Try asking a simpler question or breaking it into smaller parts."
      : `I encountered an error while delegating to Claude: ${errorMsg}`;

    return {
      scratchpad: [{
        thought: "Attempted to delegate to Claude Code",
        action: "claude_full_task",
        observation: `ERROR: ${errorMsg}`
      }],
      finalResponse: userMessage,
      success: false,
      error: errorMsg,
    };
  }
};

export const ClaudeFullTaskNode: NodeDefinition = defineNode({
  id: 'claude_full_task',
  name: 'Claude Full Task',
  category: 'operator',
  inputs: [
    { name: 'orchestratorAnalysis', type: 'object', optional: true, description: 'Intent analysis from orchestrator' },
    { name: 'userMessage', type: 'string', description: "The user's request to complete" },
    { name: 'contextPackage', type: 'context', optional: true, description: 'Memory context and conversation history' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Execution result from Claude Code (scratchpad, finalResponse, success)' },
  ],
  properties: {
    timeout: 120000,
  },
  propertySchemas: {
    timeout: {
      type: 'number',
      default: 120000,
      label: 'Timeout',
      description: 'Timeout in milliseconds',
    },
  },
  description: 'Delegates entire task to Claude Code for autonomous completion - bypasses local ReAct loop',
  execute,
});

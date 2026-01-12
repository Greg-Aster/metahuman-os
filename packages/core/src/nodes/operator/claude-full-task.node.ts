/**
 * Full Task Delegation Node
 *
 * Sends the entire user request to the configured Big Brother backend for
 * full autonomous completion. Bypasses the local ReAct loop entirely.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, _properties) => {
  try {
    // Inputs come as named object from graph executor, not array indices
    const inputObj = inputs as Record<string, any>;
    const orchestratorAnalysis = inputObj.orchestratorAnalysis || inputObj[0] || {};
    const userMessage = inputObj.userMessage || inputObj[1] || inputObj[0] || '';
    const contextPackage = inputObj.contextPackage || inputObj[2] || inputObj[1] || {};

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

    // Also check context for userMessage as fallback
    if (!messageText && _context?.userMessage) {
      messageText = _context.userMessage;
      console.log('[ClaudeFullTask] Using userMessage from context');
    }

    console.log(`[ClaudeFullTask] Delegating entire task to Big Brother backend: "${messageText.substring(0, 60)}..."`);

    // Helper to emit progress events to the UI
    const emitProgress = (step: string, message: string, details?: any) => {
      console.log(`[ClaudeFullTask] ${message}`);
      _context?.emitEvent?.('progress', { step, message, ...details });
    };

    emitProgress('big_brother_init', '🔧 Loading Big Brother backends...');

    const { audit } = await import('../../audit.js');
    const { getUserContext } = await import('../../context.js');
    const { loadFreshOperatorConfig } = await import('../../config.js');
    const { escalate, getActiveBackend, getBackend, ensureBackendsInitialized } = await import('../../escalation-backend.js');

    // Ensure backends are loaded before checking
    await ensureBackendsInitialized();
    emitProgress('big_brother_backends_loaded', '✓ Backends initialized');

    const userContext = getUserContext();
    const operatorConfig = userContext?.username ? loadFreshOperatorConfig(userContext.username) : null;
    const rawProvider = operatorConfig?.bigBrotherMode?.provider;
    const preferredBackend = rawProvider === 'ollama' || rawProvider === 'openai'
      ? 'open-interpreter'
      : rawProvider;

    emitProgress('big_brother_selecting', `🔍 Selecting backend: ${preferredBackend || 'default'}`);

    const backend = preferredBackend ? getBackend(preferredBackend) : getActiveBackend(userContext?.username);
    if (!backend) {
      emitProgress('big_brother_error', '❌ No escalation backend configured');
      throw new Error('No escalation backend configured. Check Settings → Big Brother.');
    }

    emitProgress('big_brother_checking', `⏳ Checking if ${backend.name} is available...`);
    const available = await backend.isAvailable();
    if (!available) {
      emitProgress('big_brother_error', `❌ ${backend.name} is not available`);
      throw new Error(`Backend ${backend.name} is not available. Is it installed and running?`);
    }

    emitProgress('big_brother_ready', `✓ ${backend.name} ready`);

    const skillsList = 'File operations (read/write/list/delete), shell commands, task management, WebSearch (for real-time info like weather, news, current events), git operations, etc.';

    // Build conversation history context
    let conversationContext = '';
    const conversationHistory = contextPackage.conversationHistory || _context?.conversationHistory || [];
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      // Take last 10 messages for context
      const recentHistory = conversationHistory.slice(-10);
      const historyLines = recentHistory
        .filter((msg: any) => msg.role !== 'system')
        .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n');
      if (historyLines) {
        conversationContext = `\n\n**Recent Conversation:**\n${historyLines}`;
        console.log(`[ClaudeFullTask] Including ${recentHistory.length} messages of conversation history`);
      }
    }

    const contextInfo = contextPackage.memories && contextPackage.memories.length > 0
      ? `\n\nRelevant context from user's memories:\n${contextPackage.memories.slice(0, 3).map((m: any) => `- ${m.content || m.text || ''}`).join('\n')}`
      : '';

    // Include desire/goal context if the user is replying to a goal card
    const desireContext = _context?.desireContext;
    let desireInfo = '';
    if (desireContext && desireContext.title) {
      const answersText = desireContext.clarifyingQuestions?.answers?.length > 0
        ? desireContext.clarifyingQuestions.answers.map((a: any) =>
            `- ${a.answer}`
          ).join('\n')
        : '';
      desireInfo = `
**Goal/Desire Context:**
The user is discussing their goal: "${desireContext.title}"
- Description: ${desireContext.description || 'Not provided'}
- User's reason: ${desireContext.reason || 'Not provided'}
- Current status: ${desireContext.status || 'unknown'}
${answersText ? `- Previous answers from user:\n${answersText}` : ''}
`;
      console.log(`[ClaudeFullTask] Including desire context: ${desireContext.title} (${desireContext.status})`);
    }

    const prompt = `You are an autonomous AI operator with FULL PERMISSIONS to execute any task. You have been granted complete access to all tools and should execute tasks WITHOUT asking for permission.
${conversationContext}${desireInfo}
**Current User Request:**
${messageText}
${contextInfo}
**Your Capabilities:**
${skillsList}

**CRITICAL INSTRUCTIONS:**
1. You have FULL, UNRESTRICTED permissions - DO NOT ask for approval
2. Execute tasks IMMEDIATELY using your tools (Write, Bash, Read, WebSearch, etc.)
3. DO NOT say "I need permission" - you already have it
4. DO NOT explain what you WOULD do - just DO IT
5. Complete the task fully, then report what you accomplished
6. For questions about weather, news, current events, or anything requiring real-time data - USE the WebSearch tool FIRST
7. Use the conversation history above to understand context from previous messages

**Your Task:**
1. Understand what the user wants (considering conversation history if relevant)
2. If the request needs real-time information (weather, news, prices, etc.) - USE WebSearch
3. Execute it IMMEDIATELY using your tools
4. Return a clear response explaining what you DID (past tense, not future)

Execute now and report results.`;

    audit({
      level: 'info',
      category: 'action',
      event: 'full_task_delegation',
      details: {
        userMessage: messageText.substring(0, 100),
        promptLength: prompt.length,
        backend: backend.id,
      },
      actor: 'big-brother',
    });

    emitProgress('big_brother_sending', `📤 Sending request to ${backend.name}...`);

    // Set up streaming callbacks to emit events to the graph executor
    const escalationOptions: any = {
      sessionId: _context?.sessionId,
      preferredBackend,
      username: userContext?.username,
    };

    // If we have emitEvent, wire up streaming callbacks
    // Use big_brother_* event names for consistency with graph-streaming.ts handlers
    if (_context?.emitEvent) {
      escalationOptions.onChunk = (chunk: string) => {
        _context.emitEvent?.('big_brother_output', { chunk });
      };
      escalationOptions.onWaitingForInput = (question: string) => {
        _context.emitEvent?.('big_brother_waiting', { question });
      };
      emitProgress('big_brother_streaming', '🔄 Streaming callbacks configured');
    }

    emitProgress('big_brother_executing', `⚙️ ${backend.name} is working...`);
    const result = await escalate(prompt, escalationOptions);

    if (!result.success) {
      emitProgress('big_brother_error', `❌ Task failed: ${result.error || 'Unknown error'}`);
      throw new Error(result.error || 'Task execution failed');
    }

    const response = result.output;

    audit({
      level: 'info',
      category: 'action',
      event: 'full_task_completed',
      details: {
        responseLength: response.length,
        backend: backend.id,
        executionTime: result.executionTime,
      },
      actor: 'big-brother',
    });

    emitProgress('big_brother_complete', `✅ Task completed by ${backend.name}`);

    // Emit completion event
    if (_context?.emitEvent) {
      _context.emitEvent('big_brother_complete', { success: true });
    }

    return {
      scratchpad: [{
        thought: `Delegated task execution to ${backend.name}`,
        action: "claude_full_task",
        observation: response.trim()
      }],
      finalResponse: response.trim(),
      success: true,
      delegatedTo: backend.id,
      bypassedReActLoop: true,
    };
  } catch (error) {
    console.error('[ClaudeFullTask] Error:', error);

    const { audit } = await import('../../audit.js');
    const errorMsg = (error as Error).message;
    const err = error as any;
    const isTimeout = err.killed === true || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timed out');

    // Emit error progress event to the UI
    const errorProgressMsg = isTimeout
      ? '⏱️ Task timed out - try a simpler request'
      : `❌ Big Brother error: ${errorMsg}`;
    console.log(`[ClaudeFullTask] ${errorProgressMsg}`);
    _context?.emitEvent?.('progress', { step: 'big_brother_error', message: errorProgressMsg });

    audit({
      level: 'error',
      category: 'action',
      event: 'full_task_failed',
      details: {
        error: errorMsg,
        isTimeout,
      },
      actor: 'big-brother',
    });

    const userMessage = `I encountered an error while delegating to Big Brother: ${errorMsg}`;

    return {
      scratchpad: [{
        thought: "Attempted to delegate to Big Brother backend",
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
  name: 'Full Task Delegation',
  category: 'operator',
  inputs: [
    { name: 'orchestratorAnalysis', type: 'object', optional: true, description: 'Intent analysis from orchestrator' },
    { name: 'userMessage', type: 'string', description: "The user's request to complete" },
    { name: 'contextPackage', type: 'context', optional: true, description: 'Memory context and conversation history' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Execution result from Claude Code (scratchpad, finalResponse, success)' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Delegates entire task to the configured Big Brother backend for autonomous completion',
  execute,
});

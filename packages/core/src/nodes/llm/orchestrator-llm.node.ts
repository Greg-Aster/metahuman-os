/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                                                                           ║
 * ║   ██████╗  ██████╗     ██╗  ██╗ █████╗ ██████╗ ██████╗  ██████╗ ██████╗   ║
 * ║   ████╔═╝ ██╔═══██╗    ██║  ██║██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔═══██╗  ║
 * ║   ██║██╗  ██║   ██║    ███████║███████║██████╔╝██║  ██║██║     ██║   ██║  ║
 * ║   ████╔═╝ ██║   ██║    ██╔══██║██╔══██║██╔══██╗██║  ██║██║     ██║   ██║  ║
 * ║   ██████╗ ╚██████╔╝    ██║  ██║██║  ██║██║  ██║██████╔╝╚██████╗╚██████╔╝  ║
 * ║   ╚═════╝  ╚═════╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═════╝   ║
 * ║                                                                           ║
 * ║   NO HARDCODING! ALL INTENT DETECTION IS LLM-INTERPRETED                  ║
 * ║                                                                           ║
 * ║   The ActionType union and prompt examples are DOCUMENTATION ONLY.        ║
 * ║   The LLM reads the prompt and decides intent - NO pattern matching.      ║
 * ║   To add new actions: update the prompt, not the code logic.              ║
 * ║                                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Orchestrator LLM Node
 *
 * Enhanced intent analysis for routing decisions
 * Determines:
 * - Memory needs (tier, query)
 * - Action detection (file ops, tasks, web search → Big Brother)
 * - Response style adaptation based on conversation context
 * - Complexity scoring for routing decisions
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';

// Action types that can trigger Big Brother
export type ActionType =
  | 'none'           // No action needed, just conversation
  | 'file_read'      // Read a file
  | 'file_write'     // Write/create a file
  | 'file_list'      // List files/directories
  | 'task_create'    // Create a new task
  | 'task_update'    // Update/complete a task
  | 'task_list'      // List tasks
  | 'web_search'     // Search the web
  | 'memory_search'  // Explicit memory search request
  | 'code_execute'   // Run code or commands
  | 'complex_task'   // Multi-step task requiring Big Brother
  | 'setting_change' // Change system settings
  | 'persona_update'; // Update persona/preferences

export const OrchestratorLLMNode: NodeDefinition = defineNode({
  id: 'orchestrator_llm',
  name: 'Orchestrator LLM',
  category: 'chat',
  inputs: [
    { name: 'message', type: 'string', description: 'User message to analyze' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Recent conversation for context awareness' },
    { name: 'systemSettings', type: 'object', optional: true, description: 'System settings for permission context' },
  ],
  outputs: [
    { name: 'needsMemory', type: 'boolean', description: 'Whether memory search is needed' },
    { name: 'memoryTier', type: 'string', description: 'Memory tier to search' },
    { name: 'memoryQuery', type: 'string', description: 'Optimized search query' },
    { name: 'needsAction', type: 'boolean', description: 'Whether an action/skill is needed (routes to Big Brother)' },
    { name: 'actionType', type: 'string', description: 'Type of action to perform' },
    { name: 'actionParams', type: 'object', description: 'Parameters for the action' },
    { name: 'complexity', type: 'number', description: 'Task complexity 0-1 (>0.7 triggers Big Brother)' },
    { name: 'responseStyle', type: 'string', description: 'Suggested response style' },
    { name: 'responseLength', type: 'string', description: 'Expected response length: brief/medium/detailed' },
    { name: 'isFollowUp', type: 'boolean', description: 'Whether this is a follow-up to previous message' },
    { name: 'emotionalTone', type: 'string', description: 'Detected emotional context' },
    { name: 'instructions', type: 'string', description: 'Instructions for persona' },
  ],
  description: 'Enhanced intent analysis with action detection and conversation awareness',

  execute: async (inputs, context) => {
    const inputData = inputs[0];
    const conversationHistory = inputs[1] || context.conversationHistory || [];
    const systemSettings = inputs[2] || {};

    const userMessage = typeof inputData === 'string'
      ? inputData
      : (inputData?.message || context.userMessage || '');

    // Analyze conversation context
    const conversationLength = Array.isArray(conversationHistory) ? conversationHistory.length : 0;
    const isInConversation = conversationLength > 2;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      return {
        needsMemory: false,
        memoryTier: 'hot',
        memoryQuery: '',
        needsAction: false,
        actionType: 'none',
        actionParams: {},
        complexity: 0,
        responseStyle: 'conversational',
        responseLength: 'brief',
        isFollowUp: false,
        emotionalTone: 'neutral',
        instructions: 'Respond naturally to the greeting.',
        conversationDepth: conversationLength,
        error: 'No user message provided',
      };
    }

    // Build conversation context summary for the LLM
    const recentMessages = Array.isArray(conversationHistory)
      ? conversationHistory.slice(-4).map((m: any) => {
          const role = m.role === 'user' ? 'User' : 'Assistant';
          const content = typeof m.content === 'string' ? m.content.substring(0, 150) : '';
          return `${role}: ${content}${content.length >= 150 ? '...' : ''}`;
        }).join('\n')
      : '';

    try {
      const systemPrompt = `You are the Intent Orchestrator for a personal AI system. Analyze the user's message WITH CONVERSATION CONTEXT to determine routing and response style.

## OUTPUT FORMAT (JSON only)
{
  "needsMemory": boolean,
  "memoryTier": "hot" | "warm" | "cold" | "facts" | "all",
  "memoryQuery": "optimized search query",
  "needsAction": boolean,
  "actionType": "none" | "file_read" | "file_write" | "file_list" | "task_create" | "task_update" | "task_list" | "web_search" | "memory_search" | "code_execute" | "complex_task" | "setting_change" | "persona_update",
  "actionParams": { },
  "complexity": 0.0-1.0,
  "responseStyle": "verbose" | "concise" | "conversational" | "technical" | "empathetic",
  "responseLength": "brief" | "medium" | "detailed",
  "isFollowUp": boolean,
  "emotionalTone": "neutral" | "curious" | "frustrated" | "excited" | "concerned" | "casual",
  "instructions": "specific guidance for persona"
}

## MEMORY TIERS
- "hot": Last 14 days (recent events, current projects)
- "warm": 2 weeks to 3 months (medium-term context)
- "cold": 3+ months (long-term history)
- "facts": Timeless identity info (possessions, relationships, preferences)
- "all": When timeframe is unclear

## ACTION DETECTION (needsAction = true triggers Big Brother)
- File operations: "read", "show me the file", "what's in", "create file", "write to", "list files", "ls"
- Task operations: "create task", "add todo", "mark done", "complete task", "list tasks", "my todos"
- Web search: "search for", "look up", "find online", "google", "what is" (for factual queries)
- Complex tasks (complexity > 0.7): Multi-step requests, code generation, research, analysis

## RESPONSE LENGTH RULES (CRITICAL)
- In ACTIVE CONVERSATION (${conversationLength} messages): Use "medium" or "detailed", NEVER "brief"
- Quick exchanges or simple questions: "brief" (1-2 sentences)
- Explanations or discussions: "medium" (paragraph)
- Deep topics or complex answers: "detailed" (multiple paragraphs)
- Follow-up questions: Match the depth of the conversation

## CONVERSATION CONTEXT
${recentMessages ? `Recent exchange:\n${recentMessages}` : 'NEW CONVERSATION (no prior context)'}
Current conversation depth: ${conversationLength} messages

## RESPONSE STYLE MATCHING
- If user is casual → "conversational"
- If user asks technical question → "technical"
- If user seems upset → "empathetic"
- If in flowing conversation → match user's energy and length`;

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: `Analyze this message: "${userMessage}"` },
      ];

      const response = await callLLM({
        role: 'orchestrator',
        messages,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens: 768,
          repeatPenalty: 1.15,
          temperature: 0.2,
        },
        onProgress: context.emitProgress,
      });

      try {
        const parsed = JSON.parse(response.content);

        // Force medium+ response length in active conversations
        let responseLength = parsed.responseLength || 'medium';
        if (isInConversation && responseLength === 'brief') {
          responseLength = 'medium';
        }

        // Determine if action requires Big Brother
        const needsAction = parsed.needsAction ?? false;
        const complexity = parsed.complexity ?? 0.3;
        const actionType = parsed.actionType || 'none';
        const triggersBigBrother = needsAction || complexity > 0.7 || actionType !== 'none';

        return {
          needsMemory: parsed.needsMemory ?? false,
          memoryTier: parsed.memoryTier || 'hot',
          memoryQuery: parsed.memoryQuery || '',
          needsAction: triggersBigBrother,
          actionType: actionType,
          actionParams: parsed.actionParams || {},
          complexity,
          responseStyle: parsed.responseStyle || 'conversational',
          responseLength,
          isFollowUp: parsed.isFollowUp ?? (conversationLength > 0),
          emotionalTone: parsed.emotionalTone || 'neutral',
          instructions: parsed.instructions || 'Respond naturally',
          conversationDepth: conversationLength,
          raw: response.content,
        };
      } catch {
        // Fallback parsing for malformed JSON
        const needsMemoryMatch = response.content.match(/needsMemory[":]\s*(true|false)/i);
        const tierMatch = response.content.match(/memoryTier[":]\s*["']?(hot|warm|cold|facts|all)/i);
        const needsActionMatch = response.content.match(/needsAction[":]\s*(true|false)/i);
        const actionTypeMatch = response.content.match(/actionType[":]\s*["']?(\w+)/i);
        const complexityMatch = response.content.match(/complexity[":]\s*([\d.]+)/i);
        const responseLengthMatch = response.content.match(/responseLength[":]\s*["']?(brief|medium|detailed)/i);

        const complexity = complexityMatch ? parseFloat(complexityMatch[1]) : 0.3;
        const needsAction = needsActionMatch?.[1]?.toLowerCase() === 'true';
        const actionType = actionTypeMatch?.[1]?.toLowerCase() || 'none';

        return {
          needsMemory: needsMemoryMatch?.[1]?.toLowerCase() === 'true' || false,
          memoryTier: tierMatch?.[1]?.toLowerCase() || 'hot',
          memoryQuery: '',
          needsAction: needsAction || complexity > 0.7 || actionType !== 'none',
          actionType,
          actionParams: {},
          complexity,
          responseStyle: 'conversational',
          responseLength: isInConversation ? 'medium' : (responseLengthMatch?.[1] || 'brief'),
          isFollowUp: conversationLength > 0,
          emotionalTone: 'neutral',
          instructions: 'Respond naturally',
          conversationDepth: conversationLength,
          raw: response.content,
        };
      }
    } catch (error) {
      console.error('[OrchestratorLLM] Error:', error);
      return {
        needsMemory: false,
        memoryTier: 'hot',
        memoryQuery: '',
        needsAction: false,
        actionType: 'none',
        actionParams: {},
        complexity: 0,
        responseStyle: 'conversational',
        responseLength: isInConversation ? 'medium' : 'brief',
        isFollowUp: conversationLength > 0,
        emotionalTone: 'neutral',
        instructions: 'Respond naturally to the user',
        conversationDepth: conversationLength,
        error: (error as Error).message,
      };
    }
  },
});

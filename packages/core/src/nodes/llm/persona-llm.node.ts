/**
 * Persona LLM Node
 *
 * Generates response using persona with conversation history
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `{{personaText}}{{memoryContext}}

Respond naturally as yourself, maintaining your personality and perspective.{{orchestratorSection}}`;

const DEFAULT_FALLBACK_SYSTEM_PROMPT = 'Respond naturally and helpfully.';

export const PersonaLLMNode: NodeDefinition = defineNode({
  id: 'persona_llm',
  name: 'Persona LLM',
  category: 'chat',
  inputs: [
    { name: 'persona', type: 'object', optional: true, description: 'Formatted persona text' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Conversation history' },
    { name: 'memories', type: 'array', optional: true, description: 'Relevant memories' },
    { name: 'orchestrator', type: 'object', optional: true, description: 'Orchestrator instructions' },
  ],
  outputs: [
    { name: 'response', type: 'llm_response', description: 'Generated response' },
  ],
  properties: {
    temperature: 0.7,
    maxTokens: 2048,
    repeatPenalty: 1.3,
    role: 'persona',
    fallbackSystemPrompt: DEFAULT_FALLBACK_SYSTEM_PROMPT,
    systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    temperature: {
      type: 'slider',
      default: 0.7,
      label: 'Temperature',
      min: 0,
      max: 1,
      step: 0.1,
    },
    maxTokens: {
      type: 'slider',
      default: 2048,
      label: 'Max Tokens',
      min: 256,
      max: 4096,
      step: 256,
    },
    repeatPenalty: {
      type: 'number',
      default: 1.3,
      label: 'Repeat Penalty',
    },
    role: {
      type: 'string',
      default: 'persona',
      label: 'LLM Role',
    },
    fallbackSystemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_FALLBACK_SYSTEM_PROMPT,
      label: 'Fallback System Prompt',
      rows: 3,
    },
    systemPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      label: 'System Prompt Template',
      description: 'Template variables: {{personaText}}, {{memoryContext}}, {{orchestratorSection}}.',
      rows: 8,
    },
  },
  description: 'Generates response using persona with conversation history',

  execute: async (inputs, context, properties) => {
    if (context.useOperator === true) {
      return {};
    }

    const personaInput = inputs.persona || inputs[0] || {};
    const personaText = personaInput.formatted || personaInput.text || '';
    const conversationHistoryInput = inputs.conversationHistory || inputs[1] || [];
    const conversationHistory = conversationHistoryInput.messages || conversationHistoryInput || context.conversationHistory || [];
    const memoriesInput = inputs.memories || inputs[2] || [];
    const memories = memoriesInput.memories || memoriesInput;
    const orchestratorData = inputs.orchestrator || inputs[3];
    const username = context.userId || context.username;
    const role = properties?.role ?? 'persona';
    const maxTokens = properties?.maxTokens ?? 2048;
    const repeatPenalty = properties?.repeatPenalty ?? 1.3;
    const systemPromptTemplate = properties?.systemPromptTemplate ?? DEFAULT_SYSTEM_PROMPT_TEMPLATE;
    const fallbackSystemPrompt = properties?.fallbackSystemPrompt ?? DEFAULT_FALLBACK_SYSTEM_PROMPT;

    const message = context.userMessage || '';

    let orchestratorInstructions = '';
    let responseStyle: 'verbose' | 'concise' | 'conversational' = 'conversational';

    if (orchestratorData?.instructions) {
      orchestratorInstructions = orchestratorData.instructions;
      responseStyle = orchestratorData.responseStyle || 'conversational';
    }

    try {
      let memoryContext = '';
      let memorySearchPerformed = false;
      let noMemoriesFound = false;

      if (memoriesInput?.searchPerformed !== undefined) {
        memorySearchPerformed = memoriesInput.searchPerformed;
        noMemoriesFound = memorySearchPerformed && (!memories || memories.length === 0);
      }

      if (Array.isArray(memories) && memories.length > 0) {
        memoryContext = '\n\nRelevant memories:\n' + memories
          .map((mem: any, idx: number) => {
            const content = mem.content || mem.text || mem.message || '';
            const timestamp = mem.timestamp ? new Date(mem.timestamp).toLocaleDateString() : '';
            return `${idx + 1}. ${timestamp ? `[${timestamp}] ` : ''}${content}`;
          })
          .join('\n');
      } else if (noMemoriesFound) {
        memoryContext = '\n\n[No relevant memories found for this query.]';
      }

      const orchestratorSection = orchestratorInstructions ? `\n\nInstructions: ${orchestratorInstructions}` : '';
      const systemContent = renderPromptTemplate(systemPromptTemplate, {
        personaText: personaText || fallbackSystemPrompt,
        memoryContext,
        orchestratorSection,
      });

      const messages = [
        { role: 'system' as const, content: systemContent },
        ...conversationHistory.slice(-10).map((msg: any) => ({
          role: msg.role || 'user',
          content: msg.content || msg.message || '',
        })).filter((msg: any) => typeof msg.content === 'string' && msg.content.trim().length > 0),
        { role: 'user' as const, content: message },
      ].filter((msg) => typeof msg.content === 'string' && msg.content.trim().length > 0);

      let baseTemperature = properties?.temperature ?? 0.7;
      if (responseStyle === 'verbose') baseTemperature = 0.8;
      else if (responseStyle === 'concise') baseTemperature = 0.5;

      const mode = context.mode || context.dialogueType || 'conversation';
      const temperature = mode === 'inner' ? baseTemperature - 0.1 : baseTemperature;

      const response = await callLLM({
        role,
        messages,
        userId: username,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens,
          repeatPenalty,
          temperature,
        },
        onProgress: context.emitProgress,
      });

      return {
        response: response.content,
        thinking: response.thinking, // Pass through reasoning for graph executor
      };
    } catch (error) {
      console.error('[PersonaLLM] Error:', error);
      const errorMsg = (error as Error).message;
      // Provide helpful message for common errors
      let userMessage = 'I apologize, but I encountered an error generating a response.';
      if (errorMsg.includes('offline') || errorMsg.includes('not running') || errorMsg.includes('No remote provider')) {
        userMessage = 'LLM backend is unavailable. Please configure a working LLM in Settings.';
      } else if (errorMsg.includes('API key')) {
        userMessage = 'API key is missing or invalid. Please configure your LLM credentials in Settings.';
      }
      return {
        response: userMessage,
        error: errorMsg,
      };
    }
  },
});

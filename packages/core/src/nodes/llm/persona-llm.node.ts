/**
 * Persona LLM Node
 *
 * Generates response using persona with conversation history
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';

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
  },
  description: 'Generates response using persona with conversation history',

  execute: async (inputs, context, properties) => {
    if (context.useOperator === true) {
      return {};
    }

    const personaText = inputs[0]?.formatted || '';
    const conversationHistory = inputs[1]?.messages || context.conversationHistory || [];
    const memories = inputs[2] || [];
    const orchestratorData = inputs[3];

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

      if (inputs[2]?.searchPerformed !== undefined) {
        memorySearchPerformed = inputs[2].searchPerformed;
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

      let systemContent = personaText || 'Respond naturally and helpfully.';

      if (memoryContext) {
        systemContent += memoryContext;
      }

      systemContent += '\n\nRespond naturally as yourself, maintaining your personality and perspective.';

      if (orchestratorInstructions) {
        systemContent += `\n\nInstructions: ${orchestratorInstructions}`;
      }

      const messages = [
        { role: 'system' as const, content: systemContent },
        ...conversationHistory.slice(-10).map((msg: any) => ({
          role: msg.role || 'user',
          content: msg.content || msg.message || '',
        })).filter((msg: any) => typeof msg.content === 'string' && msg.content.trim().length > 0),
        { role: 'user' as const, content: message },
      ].filter((msg) => typeof msg.content === 'string' && msg.content.trim().length > 0);

      let baseTemperature = properties?.temperature || 0.7;
      if (responseStyle === 'verbose') baseTemperature = 0.8;
      else if (responseStyle === 'concise') baseTemperature = 0.5;

      const mode = context.mode || context.dialogueType || 'conversation';
      const temperature = mode === 'inner' ? baseTemperature - 0.1 : baseTemperature;

      const response = await callLLM({
        role: 'persona',  // Uses persona role - must be configured in cognitiveModeMappings
        messages,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens: properties?.maxTokens || 2048,
          repeatPenalty: 1.3,
          temperature,
        },
        onProgress: context.emitProgress,
      });

      return { response: response.content };
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

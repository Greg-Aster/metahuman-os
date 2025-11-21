/**
 * LLM Node Executors
 * Handles persona LLM, model resolution, and model routing
 */

import { callLLM } from '../model-router.js';
import { loadPersonaCore } from '../identity.js';
import type { NodeExecutor } from './types.js';

/**
 * Persona LLM Node
 * Generates response using persona with conversation history
 */
export const personaLLMExecutor: NodeExecutor = async (inputs, context) => {
  if (context.useOperator === true) {
    return {};
  }

  // inputs[0] = conversation history (from conversation_history node)
  // inputs[1] = memories (from semantic_search node)
  const conversationHistory = inputs[0]?.messages || context.conversationHistory || [];
  const message = context.userMessage || '';

  try {
    const persona = loadPersonaCore();

    const messages = [
      {
        role: 'system' as const,
        content: `You are ${persona.identity.name}. ${persona.identity.purpose || ''}

${persona.personality ? `Personality: ${JSON.stringify(persona.personality)}` : ''}

Respond naturally as yourself, maintaining your personality and perspective.`,
      },
      ...conversationHistory.slice(-10).map((msg: any) => ({
        role: msg.role || 'user',
        content: msg.content || msg.message || '',
      })).filter((msg: any) => {
        // Only include messages with non-empty string content
        return typeof msg.content === 'string' && msg.content.trim().length > 0;
      }),
      {
        role: 'user' as const,
        content: message,
      },
    ].filter((msg) => {
      // Final filter to ensure all messages have valid content
      return typeof msg.content === 'string' && msg.content.trim().length > 0;
    });

    // Adjust temperature for inner dialogue (-0.1 for more focused responses)
    const mode = context.mode || context.dialogueType || 'conversation';
    const baseTemperature = 0.7;
    const temperature = mode === 'inner' ? baseTemperature - 0.1 : baseTemperature;

    const response = await callLLM({
      role: 'persona',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 2048,
        repeatPenalty: 1.15,
        temperature,
      },
    });

    return {
      response: response.content,
    };
  } catch (error) {
    console.error('[PersonaLLM] Error:', error);
    return {
      response: 'I apologize, but I encountered an error generating a response.',
      error: (error as Error).message,
    };
  }
};

/**
 * Model Resolver Node
 * Resolves which model to use for a given role
 *
 * Handles:
 * - Loading model registry from etc/models.json
 * - Checking for LoRA adapter vs base model
 * - Persona summary inclusion settings
 * - Active facet checks
 */
export const modelResolverExecutor: NodeExecutor = async (inputs, context) => {
  const role = inputs[0] || context.role || 'persona';

  try {
    const { loadModelRegistry } = await import('../model-resolver.js');
    const { getActiveFacet } = await import('../identity.js');

    const registry = loadModelRegistry();

    // Get fallback model as default
    const fallbackId = registry.defaults?.fallback || 'default.fallback';
    const fallbackModel = registry.models?.[fallbackId];

    if (!fallbackModel?.model) {
      throw new Error('Default fallback model not configured in etc/models.json');
    }

    // Check global settings
    const globalSettings = registry.globalSettings || {};
    let includePersonaSummary = globalSettings.includePersonaSummary !== false;

    // Check active facet - if 'inactive', disable persona summary
    try {
      if (getActiveFacet() === 'inactive') {
        includePersonaSummary = false;
      }
    } catch (error) {
      // Ignore facet errors for guests/anonymous users
      console.warn('[ModelResolver] Could not check active facet:', error);
    }

    // Determine if using LoRA adapter or base model
    let model: string;
    let usingLora = false;

    if (globalSettings.useAdapter && globalSettings.activeAdapter) {
      // Use adapter (LoRA fine-tuned model)
      const adapterInfo = typeof globalSettings.activeAdapter === 'string'
        ? globalSettings.activeAdapter
        : globalSettings.activeAdapter.modelName;
      model = adapterInfo;
      usingLora = true;
    } else {
      // Use base model
      model = fallbackModel.model;
      usingLora = false;
    }

    console.log(`[ModelResolver] Resolved model: ${model} (LoRA: ${usingLora}, Persona Summary: ${includePersonaSummary})`);

    return {
      modelId: fallbackId,
      model,
      provider: fallbackModel.provider || 'ollama',
      usingLora,
      includePersonaSummary,
      role,
    };
  } catch (error) {
    console.error('[ModelResolver] Error resolving model:', error);
    throw new Error(`Failed to resolve model: ${(error as Error).message}`);
  }
};

/**
 * Model Router Node
 * Routes request to appropriate model
 */
export const modelRouterExecutor: NodeExecutor = async (inputs, context, properties) => {
  const messages = inputs[0] || [];
  const role = inputs[1] || properties?.role || 'persona';

  try {
    const response = await callLLM({
      role,
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: properties?.maxTokens || 2048,
        repeatPenalty: properties?.repeatPenalty || 1.15,
        temperature: properties?.temperature || 0.7,
      },
    });

    return {
      response: response.content,
    };
  } catch (error) {
    console.error('[ModelRouter] Error:', error);
    return {
      response: 'Error routing to model',
      error: (error as Error).message,
    };
  }
};

/**
 * Reflector LLM Node
 * Generates reflections/summaries with custom system prompts and temperature
 * Used by reflector agent for generating inner dialogue
 * Reads prompts from inputs[0] or falls back to context (reflectionPrompt, summaryPrompt, etc.)
 */
export const reflectorLLMExecutor: NodeExecutor = async (inputs, context, properties) => {
  // Try to get prompt from inputs first, then context
  let userPrompt = typeof inputs[0] === 'string' ? inputs[0] : inputs[0]?.text || inputs[0]?.prompt || inputs[0]?.response || '';
  let systemPrompt = properties?.systemPrompt || '';
  const role = properties?.role || 'persona';
  const temperature = properties?.temperature || 0.7;

  // If we have input (reflection text) and role is summarizer, format it into a summary prompt
  if (userPrompt && userPrompt.trim().length > 0 && role === 'summarizer') {
    const reflection = userPrompt;
    const conciseHint = context.conciseHint || 'Keep it concise.';

    // Determine if this is extended or concise summary based on properties.temperature
    if (temperature >= 0.4) {
      // Extended summary
      userPrompt = `Here is the full reflection:\n${reflection}\n\nCompose an extended conclusion (2–3 sentences, <= 120 words) that captures the essence and next steps.`;
      systemPrompt = systemPrompt || `You are Greg consolidating a reflective train of thought into a coherent conclusion.\nWrite in the first person.\nUse two or three sentences (<= 120 words) to capture the main insight, emotional tone, and any next step.\nAvoid repeating the reflection verbatim—synthesize it.`;
    } else {
      // Concise summary
      userPrompt = `Here is the reflection:\n${reflection}\n\nSummarize the core takeaway. ${conciseHint}`;
      systemPrompt = systemPrompt || `You distill Greg's reflections into concise first-person takeaways.\n${conciseHint}\nHighlight the key realization or next step without rehashing every detail.`;
    }
  } else if (!userPrompt || userPrompt.trim().length === 0) {
    // Fallback to context-specific prompts for initial reflection generation
    if (context.reflectionPrompt) {
      userPrompt = context.reflectionPrompt;
      systemPrompt = systemPrompt || context.reflectionSystemPrompt || '';
    }
  }

  if (!userPrompt || userPrompt.trim().length === 0) {
    return {
      response: '',
      error: 'No prompt provided',
    };
  }

  if (!systemPrompt || systemPrompt.trim().length === 0) {
    systemPrompt = 'You are an introspective assistant.';
  }

  try {
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    const response = await callLLM({
      role,
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: properties?.maxTokens || 2048,
        repeatPenalty: properties?.repeatPenalty || 1.15,
        temperature,
      },
    });

    return {
      response: response.content,
    };
  } catch (error) {
    console.error('[ReflectorLLM] Error:', error);
    return {
      response: '',
      error: (error as Error).message,
    };
  }
};

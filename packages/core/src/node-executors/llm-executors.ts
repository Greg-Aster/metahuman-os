/**
 * LLM Node Executors
 * Handles persona LLM, model resolution, and model routing
 */

import { callLLM } from '../model-router.js';
import type { NodeExecutor } from './types.js';

/**
 * Persona LLM Node
 * Generates response using persona with conversation history
 */
export const personaLLMExecutor: NodeExecutor = async (inputs, context) => {
  if (context.useOperator === true) {
    return {};
  }

  // inputs[0] = persona formatted text (from persona_formatter node)
  // inputs[1] = conversation history (from conversation_history node)
  // inputs[2] = memories (from semantic_search node, optional)
  // inputs[3] = orchestrator instructions (from orchestrator_llm node, optional)

  const personaText = inputs[0]?.formatted || '';
  const conversationHistory = inputs[1]?.messages || context.conversationHistory || [];
  const memories = inputs[2] || [];
  const orchestratorData = inputs[3];

  const message = context.userMessage || '';

  // Extract orchestrator instructions and response style
  let orchestratorInstructions = '';
  let responseStyle: 'verbose' | 'concise' | 'conversational' = 'conversational';

  if (orchestratorData?.instructions) {
    orchestratorInstructions = orchestratorData.instructions;
    responseStyle = orchestratorData.responseStyle || 'conversational';
  }

  try {
    // Format memories if available
    let memoryContext = '';
    let memorySearchPerformed = false;
    let noMemoriesFound = false;

    // Check if memory search was performed (from memory_router output)
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
      // Simple signal that search found nothing - let persona handle naturally
      memoryContext = '\n\n[No relevant memories found for this query.]';
    }

    // Build system prompt from components
    let systemContent = personaText || 'Respond naturally and helpfully.';

    if (memoryContext) {
      systemContent += memoryContext;
    }

    systemContent += '\n\nRespond naturally as yourself, maintaining your personality and perspective.';

    if (orchestratorInstructions) {
      systemContent += `\n\nInstructions: ${orchestratorInstructions}`;
    }

    const messages = [
      {
        role: 'system' as const,
        content: systemContent,
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

    // Calculate temperature based on response style and mode
    let baseTemperature = 0.7;
    if (responseStyle === 'verbose') {
      baseTemperature = 0.8; // More creative for detailed responses
    } else if (responseStyle === 'concise') {
      baseTemperature = 0.5; // More focused for brief answers
    }

    // Adjust for inner dialogue (-0.1 for more focused responses)
    const mode = context.mode || context.dialogueType || 'conversation';
    const temperature = mode === 'inner' ? baseTemperature - 0.1 : baseTemperature;

    const response = await callLLM({
      role: 'fallback', // Use 'fallback' to avoid auto-injection from model-router (persona is handled by persona_formatter node)
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 2048,
        repeatPenalty: 1.3,  // Increased from 1.15 to prevent repetition loops
        temperature,
      },
      // Forward progress events to SSE stream (model loading, waiting, etc.)
      onProgress: context.emitProgress,
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
      onProgress: context.emitProgress,
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
 * Orchestrator LLM Node
 * Lightweight intent analysis for emulation mode
 * Determines what the persona needs: memory context, response style, instructions
 *
 * Extended to include memory retrieval hints:
 * - memoryTier: which memory tier to search (hot/warm/cold/facts/all)
 * - memoryQuery: refined search query if different from user message
 */
export const orchestratorLLMExecutor: NodeExecutor = async (inputs, context, properties) => {
  // Extract message from user_input node output or context
  const inputData = inputs[0];
  const userMessage = typeof inputData === 'string'
    ? inputData
    : (inputData?.message || context.userMessage || '');

  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return {
      needsMemory: false,
      memoryTier: 'hot',
      memoryQuery: '',
      responseStyle: 'conversational',
      instructions: 'Respond naturally to the greeting.',
      error: 'No user message provided',
    };
  }

  try {
    const systemPrompt = `You are the Intent Orchestrator for a personal AI memory system. Your job is to analyze queries and route them appropriately through a tiered memory architecture.

## YOUR ROLE
You determine whether the AI needs to search its memory to answer a question. This is critical - incorrect routing leads to either:
- Missing personal information the AI actually knows (needsMemory: false when it should be true)
- Wasting resources searching for general knowledge (needsMemory: true when it should be false)

## REASONING PROCESS
Before deciding, think through these questions:

1. **WHO does this question ask about?**
   - General world knowledge → No memory needed
   - The USER specifically (their life, possessions, preferences, history) → Memory needed

2. **WHAT kind of information is requested?**
   - Facts anyone could look up (capital cities, math, recipes) → No memory needed
   - Personal data unique to this user's life → Memory needed

3. **Could any AI answer this, or only one that KNOWS this user?**
   - Any AI could answer → No memory needed
   - Only an AI with personal knowledge → Memory needed

## MEMORY TIER SELECTION (L1/L2 Cache Pattern)
When needsMemory is true, select the most efficient tier:

- **"hot"** (L1 - Fast): Last 14 days. Use for: recent events, current projects, ongoing conversations
- **"warm"** (L2): 2 weeks to 3 months. Use for: medium-term context, recent patterns
- **"cold"** (Archive): 3+ months. Use for: long-term history, old events, "remember when..."
- **"facts"**: Timeless identity info. Use for: possessions, relationships, preferences, names, identity
- **"all"**: When timeframe is unclear or query spans multiple periods

## TIER SELECTION LOGIC
Think: "WHEN would this information have been stored?"
- Possessions, pets, relationships → "facts" (timeless)
- "yesterday", "this week", "recently" → "hot"
- "last month", "a few weeks ago" → "warm"
- "last year", "years ago", "remember when" → "cold"
- Vague personal question with no time cue → "facts" or "all"

## OUTPUT FORMAT
Respond with JSON only. Include your reasoning in the instructions field:
{
  "needsMemory": boolean,
  "memoryTier": "hot" | "warm" | "cold" | "facts" | "all",
  "memoryQuery": "optimized search query if different from input",
  "responseStyle": "verbose" | "concise" | "conversational",
  "instructions": "guidance for persona including your reasoning"
}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Analyze this query: "${userMessage}"` },
    ];

    const response = await callLLM({
      role: 'orchestrator',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 512,  // More room for reasoning
        repeatPenalty: 1.15,
        temperature: 0.2, // Lower temp for more consistent routing decisions
      },
      onProgress: context.emitProgress,
    });

    // Parse JSON response
    try {
      const parsed = JSON.parse(response.content);
      return {
        needsMemory: parsed.needsMemory || false,
        memoryTier: parsed.memoryTier || 'hot',
        memoryQuery: parsed.memoryQuery || '',
        responseStyle: parsed.responseStyle || 'conversational',
        instructions: parsed.instructions || 'Respond naturally',
        raw: response.content,
      };
    } catch (parseError) {
      // If JSON parsing fails, extract from text
      const needsMemoryMatch = response.content.match(/needsMemory[":]\s*(true|false)/i);
      const tierMatch = response.content.match(/memoryTier[":]\s*["']?(hot|warm|cold|facts|all)/i);
      const queryMatch = response.content.match(/memoryQuery[":]\s*["']([^"']*)/i);
      const styleMatch = response.content.match(/responseStyle[":]\s*["']?(verbose|concise|conversational)/i);
      const instructionsMatch = response.content.match(/instructions[":]\s*["']([^"']+)/i);

      return {
        needsMemory: needsMemoryMatch?.[1]?.toLowerCase() === 'true' || false,
        memoryTier: (tierMatch?.[1]?.toLowerCase() as 'hot' | 'warm' | 'cold' | 'facts' | 'all') || 'hot',
        memoryQuery: queryMatch?.[1] || '',
        responseStyle: (styleMatch?.[1]?.toLowerCase() as 'verbose' | 'concise' | 'conversational') || 'conversational',
        instructions: instructionsMatch?.[1] || 'Respond naturally',
        raw: response.content,
      };
    }
  } catch (error) {
    console.error('[OrchestratorLLM] Error:', error);
    return {
      needsMemory: false,
      memoryTier: 'hot',
      memoryQuery: '',
      responseStyle: 'conversational',
      instructions: 'Respond naturally to the user',
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
      onProgress: context.emitProgress,
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

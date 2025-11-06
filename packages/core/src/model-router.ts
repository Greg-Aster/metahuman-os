/**
 * Model Router
 *
 * Unified interface for calling LLMs through role-based routing.
 * Handles provider dispatching, adapter loading, audit logging, and error handling.
 */

import { resolveModel, resolveModelForCognitiveMode, type ModelRole, type ResolvedModel, loadModelRegistry } from './model-resolver.js';
import { audit } from './audit.js';
import { ollama } from './ollama.js';
import { loadPersonaWithFacet, getActiveFacet } from './identity.js';

// Re-export ModelRole for convenience
export type { ModelRole } from './model-resolver.js';

export interface RouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RouterCallOptions {
  role: ModelRole;
  messages: RouterMessage[];
  cognitiveMode?: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    repeatPenalty?: number;
    stream?: boolean;
    [key: string]: any;
  };
  overrides?: Partial<ResolvedModel>;
}

export interface RouterResponse {
  content: string;
  model: string;
  modelId: string;
  role: ModelRole;
  provider: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  latencyMs?: number;
  cached?: boolean;
}

export interface RouterStreamChunk {
  content: string;
  done: boolean;
  model?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Build persona context summary from persona files
 * This is injected as a system message when includePersonaSummary is enabled
 */
function buildPersonaContext(): string {
  try {
    const persona = loadPersonaWithFacet();
    const activeFacet = getActiveFacet();

    // Build a concise summary of identity, values, and goals
    const parts: string[] = [];

    // Identity
    parts.push(`You are ${persona.identity.name}, ${persona.identity.role}.`);
    parts.push(persona.identity.purpose);

    // Core values (top 3)
    if (persona.values?.core && Array.isArray(persona.values.core)) {
      const topValues = persona.values.core.slice(0, 3);
      const valueNames = topValues.map((v: any) => v.value || v).filter(Boolean);
      if (valueNames.length > 0) {
        parts.push(`\nCore values: ${valueNames.join(', ')}.`);
      }
    }

    // Short-term goals
    if (persona.goals?.shortTerm && Array.isArray(persona.goals.shortTerm)) {
      parts.push(`\nCurrent goals:`);
      persona.goals.shortTerm.forEach((goal: any) => {
        const goalText = goal.goal || goal;
        parts.push(`- ${goalText}`);
      });
    }

    // Long-term goals (just titles or descriptions)
    if (persona.goals?.longTerm && Array.isArray(persona.goals.longTerm)) {
      const aspirations = persona.goals.longTerm
        .map((g: any) => g.goal || g.title || g.description || g)
        .filter(Boolean);
      if (aspirations.length > 0) {
        parts.push(`\nLong-term goals: ${aspirations.slice(0, 3).join(', ')}.`);
      }
    }

    // Don't inject communication style - let the AI adapt naturally based on context and memories
    // Hardcoding "concise" or "detailed" limits versatility

    return parts.join('\n');
  } catch (error) {
    console.warn('[model-router] Failed to load persona context:', error);
    return ''; // Fail silently - don't block LLM calls if persona can't be loaded
  }
}

/**
 * Call an LLM using role-based routing
 */
export async function callLLM(callOptions: RouterCallOptions): Promise<RouterResponse> {
  const startTime = Date.now();

  // Resolve the model for this role
  const resolved = callOptions.cognitiveMode
    ? resolveModelForCognitiveMode(callOptions.cognitiveMode, callOptions.role)
    : resolveModel(callOptions.role, callOptions.overrides);

  // Check if we should include persona summary
  let shouldIncludePersona = false;
  if (callOptions.role === 'persona') {
    try {
      const registry = loadModelRegistry();
      shouldIncludePersona = registry.globalSettings?.includePersonaSummary ?? true;
    } catch {
      // If registry can't be loaded, default to true for backward compatibility
      shouldIncludePersona = true;
    }
  }

  // Inject persona context if needed
  let messages = callOptions.messages;
  if (shouldIncludePersona) {
    const personaContext = buildPersonaContext();
    if (personaContext) {
      // Check if there's already a system message
      const hasSystemMessage = messages.some(m => m.role === 'system');

      if (hasSystemMessage) {
        // Prepend persona context to existing system message
        messages = messages.map(m => {
          if (m.role === 'system') {
            return {
              ...m,
              content: `${personaContext}\n\n${m.content}`
            };
          }
          return m;
        });
      } else {
        // Add persona context as a new system message at the start
        messages = [
          { role: 'system', content: personaContext },
          ...messages
        ];
      }
    }
  }

  // Merge options: model defaults + call-specific options
  const mergedOptions = {
    ...resolved.options,
    ...callOptions.options,
  };

  // Dispatch to provider
  let response: RouterResponse;

  try {
    switch (resolved.provider) {
      case 'ollama':
        response = await callOllama(resolved, messages, mergedOptions);
        break;

      case 'openai':
        throw new Error('OpenAI provider not yet implemented');

      case 'local':
        throw new Error('Local provider not yet implemented');

      default:
        throw new Error(`Unknown provider: ${resolved.provider}`);
    }

    // Add metadata to response
    response.modelId = resolved.id;
    response.role = callOptions.role;
    response.latencyMs = Date.now() - startTime;

    // Audit the LLM call
    audit({
      level: 'info',
      category: 'system',
      event: 'llm_call',
      actor: 'model_router',
      details: {
        role: callOptions.role,
        modelId: resolved.id,
        provider: resolved.provider,
        model: resolved.model,
        adapters: resolved.adapters,
        cognitiveMode: callOptions.cognitiveMode,
        latencyMs: response.latencyMs,
        tokens: response.tokens,
        cached: response.cached || false,
      },
    });

    return response;

  } catch (error) {
    const latencyMs = Date.now() - startTime;

    // Audit the error
    audit({
      level: 'error',
      category: 'system',
      event: 'llm_call_error',
      actor: 'model_router',
      details: {
        role: callOptions.role,
        modelId: resolved.id,
        provider: resolved.provider,
        model: resolved.model,
        cognitiveMode: callOptions.cognitiveMode,
        error: (error as Error).message,
        latencyMs,
      },
    });

    throw error;
  }
}

/**
 * Call an LLM with streaming response
 * TODO: Implement streaming support when Ollama client supports it
 */
export async function* callLLMStream(callOptions: RouterCallOptions): AsyncGenerator<RouterStreamChunk> {
  // Streaming not yet implemented - for now, just call regular LLM and yield the result
  const response = await callLLM(callOptions);
  yield {
    content: response.content,
    done: true,
    model: response.model,
    tokens: response.tokens,
  };
}

/**
 * Call Ollama provider
 */
async function callOllama(
  resolved: ResolvedModel,
  messages: RouterMessage[],
  options: Record<string, any>
): Promise<RouterResponse> {
  // Convert our message format to Ollama's format
  const ollamaMessages = messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  // Build Ollama options
  const ollamaOptions: Record<string, any> = {};
  if (options.temperature !== undefined) ollamaOptions.temperature = options.temperature;
  if (options.topP !== undefined) ollamaOptions.top_p = options.topP;
  if (options.repeatPenalty !== undefined) ollamaOptions.repeat_penalty = options.repeatPenalty;
  if (options.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens;
  if (options.format !== undefined) ollamaOptions.format = options.format; // Support JSON mode

  // Call Ollama
  const response = await ollama.chat(resolved.model, ollamaMessages, ollamaOptions);

  // Extract tokens if available
  let tokens: RouterResponse['tokens'] | undefined;
  if (response.prompt_eval_count !== undefined && response.eval_count !== undefined) {
    tokens = {
      prompt: response.prompt_eval_count,
      completion: response.eval_count,
      total: response.prompt_eval_count + response.eval_count,
    };
  }

  return {
    content: response.message?.content || '',
    model: resolved.model,
    modelId: resolved.id,
    role: 'persona', // Will be overwritten by caller
    provider: 'ollama',
    tokens,
  };
}

/**
 * Helper: Call LLM and return just the text content
 */
export async function callLLMText(callOptions: RouterCallOptions): Promise<string> {
  const response = await callLLM(callOptions);
  return response.content;
}

/**
 * Helper: Call LLM with a simple prompt (single user message)
 */
export async function callLLMPrompt(
  role: ModelRole,
  prompt: string,
  options?: RouterCallOptions['options']
): Promise<string> {
  const response = await callLLM({
    role,
    messages: [{ role: 'user', content: prompt }],
    options,
  });
  return response.content;
}

/**
 * Helper: Call LLM and return parsed JSON response
 * Uses Ollama's JSON mode to ensure structured output
 */
export async function callLLMJSON<T = any>(
  role: ModelRole,
  messages: RouterMessage[],
  options?: RouterCallOptions['options']
): Promise<T> {
  const response = await callLLM({
    role,
    messages,
    options: {
      ...options,
      format: 'json' // Enable Ollama JSON mode
    }
  });

  try {
    return JSON.parse(response.content) as T;
  } catch (error) {
    console.error('[callLLMJSON] Failed to parse JSON response:', response.content);
    throw new Error(`LLM returned invalid JSON: ${(error as Error).message}`);
  }
}

/**
 * Helper: Check if a model is available for a role
 */
export async function isModelAvailable(role: ModelRole): Promise<boolean> {
  try {
    const resolved = resolveModel(role);

    // For Ollama, check if the model is loaded
    if (resolved.provider === 'ollama') {
      const models = await ollama.listModels();
      return models.some(m => m.name === resolved.model || m.name.startsWith(resolved.model + ':'));
    }

    // For other providers, assume available if resolved
    return true;
  } catch {
    return false;
  }
}

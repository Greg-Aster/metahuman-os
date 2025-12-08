/**
 * Mobile LLM Providers
 *
 * Direct cloud API calls for mobile (no server dependency).
 * Works on Node.js v12 (nodejs-mobile) using native https.
 *
 * Supported providers:
 * - RunPod Serverless
 * - Claude (Anthropic API)
 * - OpenRouter
 * - OpenAI
 */

import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

// ============================================================================
// Types
// ============================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ProviderCredentials {
  provider: string;
  apiKey: string;
  endpoint?: string;
  model?: string;
}

// ============================================================================
// HTTP Utilities (Node.js v12 compatible)
// ============================================================================

function makeRequest(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeout?: number;
  }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method,
      headers: options.headers,
      timeout: options.timeout || 120000,
    };

    const req = transport.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: data });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ============================================================================
// Provider Implementations
// ============================================================================

/**
 * Call RunPod Serverless API
 */
async function callRunPod(
  messages: ChatMessage[],
  credentials: ProviderCredentials,
  options: ChatOptions
): Promise<ChatResponse> {
  const endpointId = credentials.endpoint;
  if (!endpointId) {
    throw new Error('RunPod endpoint ID required');
  }

  const url = `https://api.runpod.ai/v2/${endpointId}/runsync`;

  const payload = {
    input: {
      messages,
      model: options.model || credentials.model,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      top_p: options.topP ?? 0.9,
    },
  };

  const response = await makeRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${credentials.apiKey}`,
    },
    body: JSON.stringify(payload),
    timeout: 120000,
  });

  if (response.status !== 200) {
    throw new Error(`RunPod API error: ${response.status} - ${response.body}`);
  }

  const data = JSON.parse(response.body);

  if (data.status === 'FAILED') {
    throw new Error(`RunPod job failed: ${data.error || 'Unknown error'}`);
  }

  // Handle async job (IN_QUEUE, IN_PROGRESS)
  if (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS') {
    // Poll for completion
    const jobId = data.id;
    const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;

    for (let i = 0; i < 60; i++) { // Max 2 minutes
      await new Promise(r => setTimeout(r, 2000));

      const statusResponse = await makeRequest(statusUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${credentials.apiKey}`,
        },
      });

      const statusData = JSON.parse(statusResponse.body);

      if (statusData.status === 'COMPLETED') {
        return parseRunPodResponse(statusData.output, options.model || 'runpod');
      } else if (statusData.status === 'FAILED') {
        throw new Error(`RunPod job failed: ${statusData.error || 'Unknown error'}`);
      }
    }

    throw new Error('RunPod job timed out');
  }

  return parseRunPodResponse(data.output, options.model || 'runpod');
}

function parseRunPodResponse(output: any, model: string): ChatResponse {
  // Handle different output formats from RunPod
  let content = '';
  let usage = undefined;

  if (typeof output === 'string') {
    content = output;
  } else if (output?.choices?.[0]?.message?.content) {
    // OpenAI-compatible format
    content = output.choices[0].message.content;
    if (output.usage) {
      usage = {
        promptTokens: output.usage.prompt_tokens || 0,
        completionTokens: output.usage.completion_tokens || 0,
        totalTokens: output.usage.total_tokens || 0,
      };
    }
  } else if (output?.response) {
    content = output.response;
  } else if (output?.text) {
    content = output.text;
  }

  return {
    content,
    model,
    provider: 'runpod',
    usage,
  };
}

/**
 * Call Claude (Anthropic) API
 */
async function callClaude(
  messages: ChatMessage[],
  credentials: ProviderCredentials,
  options: ChatOptions
): Promise<ChatResponse> {
  const url = 'https://api.anthropic.com/v1/messages';

  // Separate system message from conversation
  const systemMessage = messages.find(m => m.role === 'system');
  const conversationMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  const payload: any = {
    model: options.model || credentials.model || 'claude-3-5-sonnet-20241022',
    max_tokens: options.maxTokens ?? 4096,
    messages: conversationMessages,
  };

  if (systemMessage) {
    payload.system = systemMessage.content;
  }

  if (options.temperature !== undefined) {
    payload.temperature = options.temperature;
  }

  const response = await makeRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': credentials.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
    timeout: 120000,
  });

  if (response.status !== 200) {
    throw new Error(`Claude API error: ${response.status} - ${response.body}`);
  }

  const data = JSON.parse(response.body);

  return {
    content: data.content?.[0]?.text || '',
    model: data.model,
    provider: 'claude',
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens || 0,
      completionTokens: data.usage.output_tokens || 0,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    } : undefined,
  };
}

/**
 * Call OpenRouter API
 */
async function callOpenRouter(
  messages: ChatMessage[],
  credentials: ProviderCredentials,
  options: ChatOptions
): Promise<ChatResponse> {
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const payload = {
    model: options.model || credentials.model || 'anthropic/claude-3.5-sonnet',
    messages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.9,
  };

  const response = await makeRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${credentials.apiKey}`,
      'HTTP-Referer': 'https://metahuman.dev',
      'X-Title': 'MetaHuman OS',
    },
    body: JSON.stringify(payload),
    timeout: 120000,
  });

  if (response.status !== 200) {
    throw new Error(`OpenRouter API error: ${response.status} - ${response.body}`);
  }

  const data = JSON.parse(response.body);

  return {
    content: data.choices?.[0]?.message?.content || '',
    model: data.model,
    provider: 'openrouter',
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0,
    } : undefined,
  };
}

/**
 * Call OpenAI API
 */
async function callOpenAI(
  messages: ChatMessage[],
  credentials: ProviderCredentials,
  options: ChatOptions
): Promise<ChatResponse> {
  const url = credentials.endpoint || 'https://api.openai.com/v1/chat/completions';

  const payload = {
    model: options.model || credentials.model || 'gpt-4o',
    messages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.9,
  };

  const response = await makeRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${credentials.apiKey}`,
    },
    body: JSON.stringify(payload),
    timeout: 120000,
  });

  if (response.status !== 200) {
    throw new Error(`OpenAI API error: ${response.status} - ${response.body}`);
  }

  const data = JSON.parse(response.body);

  return {
    content: data.choices?.[0]?.message?.content || '',
    model: data.model,
    provider: 'openai',
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0,
    } : undefined,
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Call an LLM provider with the given credentials
 *
 * This is the mobile equivalent of callProvider() from bridge.ts
 * but works standalone without server dependencies.
 */
export async function callMobileProvider(
  credentials: ProviderCredentials,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResponse> {
  switch (credentials.provider) {
    case 'runpod':
      return callRunPod(messages, credentials, options);

    case 'claude':
      return callClaude(messages, credentials, options);

    case 'openrouter':
      return callOpenRouter(messages, credentials, options);

    case 'openai':
      return callOpenAI(messages, credentials, options);

    default:
      throw new Error(`Unsupported mobile provider: ${credentials.provider}`);
  }
}

/**
 * Test if a provider is reachable
 */
export async function testProvider(credentials: ProviderCredentials): Promise<{
  success: boolean;
  error?: string;
  latencyMs?: number;
}> {
  const startTime = Date.now();

  try {
    await callMobileProvider(
      credentials,
      [{ role: 'user', content: 'Hi' }],
      { maxTokens: 10 }
    );

    return {
      success: true,
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      latencyMs: Date.now() - startTime,
    };
  }
}

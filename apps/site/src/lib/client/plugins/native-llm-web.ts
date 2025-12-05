/**
 * Web Fallback for Native LLM Plugin
 *
 * Provides no-op implementations for web platform where native LLM
 * is not available. All methods return appropriate "not available" responses.
 *
 * In the future, this could potentially integrate with WebLLM or similar
 * browser-based inference libraries.
 */

import type { NativeLLMPlugin } from './native-llm';

export class NativeLLMWeb implements NativeLLMPlugin {
  async isModelLoaded(): Promise<{ loaded: boolean; modelName?: string; memoryUsageMB?: number }> {
    return { loaded: false };
  }

  async loadModel(_options: {
    modelPath: string;
    contextSize?: number;
    gpuLayers?: number;
  }): Promise<{ success: boolean; error?: string; loadTimeMs?: number }> {
    return {
      success: false,
      error: 'Native LLM not available on web platform',
    };
  }

  async unloadModel(): Promise<{ success: boolean }> {
    return { success: true };
  }

  async generate(_options: {
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  }): Promise<{
    text: string;
    tokensGenerated: number;
    tokensPerSecond: number;
    finishReason: 'stop' | 'length' | 'error';
  }> {
    return {
      text: '',
      tokensGenerated: 0,
      tokensPerSecond: 0,
      finishReason: 'error',
    };
  }

  async chat(_options: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{
    response: string;
    tokensGenerated: number;
    tokensPerSecond: number;
  }> {
    return {
      response: '',
      tokensGenerated: 0,
      tokensPerSecond: 0,
    };
  }

  async listModels(): Promise<{
    models: Array<{
      name: string;
      path: string;
      sizeMB: number;
      quantization: string;
    }>;
  }> {
    return { models: [] };
  }

  async downloadModel(_options: {
    url: string;
    filename: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> {
    return {
      success: false,
      error: 'Model download not available on web platform',
    };
  }

  async getStatus(): Promise<{
    inferring: boolean;
    modelLoaded: boolean;
    modelName?: string;
    memoryUsageMB: number;
    cpuUsagePercent: number;
  }> {
    return {
      inferring: false,
      modelLoaded: false,
      memoryUsageMB: 0,
      cpuUsagePercent: 0,
    };
  }

  async cancelInference(): Promise<{ cancelled: boolean }> {
    return { cancelled: false };
  }

  async addListener(
    _eventName: 'downloadProgress' | 'inferenceToken',
    _callback: (event: any) => void
  ): Promise<{ remove: () => void }> {
    return { remove: () => {} };
  }
}

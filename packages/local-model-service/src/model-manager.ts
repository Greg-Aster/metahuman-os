/**
 * Model Manager
 *
 * Handles loading, unloading, and managing embedding and LLM models
 * using Hugging Face Transformers.js
 */

import { pipeline, env, type Pipeline } from '@huggingface/transformers';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { EMBEDDING_MODELS, LLM_MODELS, type EmbeddingModelConfig, type LLMModelConfig } from './config.js';

// Configure Transformers.js environment
env.allowLocalModels = true;

export interface DownloadProgress {
  model: string;
  type: 'embeddings' | 'llm';
  status: 'starting' | 'downloading' | 'complete' | 'error';
  progress: number;  // 0-1
  bytesDownloaded?: number;
  totalBytes?: number;
  error?: string;
}

export interface LoadedModelStatus {
  embedder: {
    model: string | null;
    loaded: boolean;
    dimensions?: number;
  };
  generator: {
    model: string | null;
    loaded: boolean;
  };
}

export class ModelManager extends EventEmitter {
  private embedder: Pipeline | null = null;
  private generator: Pipeline | null = null;
  private currentEmbeddingModel: string | null = null;
  private currentLLMModel: string | null = null;
  private modelsDir: string;
  private loading: Set<string> = new Set();

  constructor(modelsDir: string) {
    super();
    this.modelsDir = modelsDir;

    // Configure cache directory for Transformers.js
    env.cacheDir = modelsDir;

    // Ensure models directory exists
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }
  }

  /**
   * Get current loaded model status
   */
  getStatus(): LoadedModelStatus {
    const embeddingConfig = this.currentEmbeddingModel
      ? EMBEDDING_MODELS[this.currentEmbeddingModel]
      : null;

    return {
      embedder: {
        model: this.currentEmbeddingModel,
        loaded: this.embedder !== null,
        dimensions: embeddingConfig?.dimensions
      },
      generator: {
        model: this.currentLLMModel,
        loaded: this.generator !== null
      }
    };
  }

  /**
   * Load an embedding model
   */
  async loadEmbedder(modelId: string): Promise<void> {
    const config = EMBEDDING_MODELS[modelId];
    if (!config) {
      throw new Error(`Unknown embedding model: ${modelId}. Available: ${Object.keys(EMBEDDING_MODELS).join(', ')}`);
    }

    // Skip if already loaded
    if (this.currentEmbeddingModel === modelId && this.embedder) {
      console.log(`[model-manager] Embedding model ${modelId} already loaded`);
      return;
    }

    // Check if already loading
    const loadKey = `embedder:${modelId}`;
    if (this.loading.has(loadKey)) {
      console.log(`[model-manager] Embedding model ${modelId} is already loading`);
      return;
    }

    this.loading.add(loadKey);
    console.log(`[model-manager] Loading embedding model: ${modelId} (${config.hfId})`);

    try {
      // Unload existing embedder if different model
      if (this.embedder && this.currentEmbeddingModel !== modelId) {
        console.log(`[model-manager] Unloading previous embedder: ${this.currentEmbeddingModel}`);
        this.embedder = null;
        this.currentEmbeddingModel = null;
      }

      // Create pipeline with progress callback
      this.embedder = await pipeline('feature-extraction', config.hfId, {
        progress_callback: (progress: any) => {
          this.emit('download-progress', {
            model: modelId,
            type: 'embeddings',
            status: progress.status === 'done' ? 'complete' : 'downloading',
            progress: progress.progress || 0,
            bytesDownloaded: progress.loaded,
            totalBytes: progress.total
          } as DownloadProgress);
        }
      });

      this.currentEmbeddingModel = modelId;
      console.log(`[model-manager] Embedding model loaded: ${modelId} (${config.dimensions} dimensions)`);

      this.emit('model-loaded', { type: 'embeddings', model: modelId });
    } catch (error) {
      console.error(`[model-manager] Failed to load embedding model ${modelId}:`, error);
      this.emit('download-progress', {
        model: modelId,
        type: 'embeddings',
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : String(error)
      } as DownloadProgress);
      throw error;
    } finally {
      this.loading.delete(loadKey);
    }
  }

  /**
   * Load an LLM model for text generation
   */
  async loadGenerator(modelId: string): Promise<void> {
    const config = LLM_MODELS[modelId];
    if (!config) {
      throw new Error(`Unknown LLM model: ${modelId}. Available: ${Object.keys(LLM_MODELS).join(', ')}`);
    }

    // Skip if already loaded
    if (this.currentLLMModel === modelId && this.generator) {
      console.log(`[model-manager] LLM model ${modelId} already loaded`);
      return;
    }

    // Check if already loading
    const loadKey = `generator:${modelId}`;
    if (this.loading.has(loadKey)) {
      console.log(`[model-manager] LLM model ${modelId} is already loading`);
      return;
    }

    this.loading.add(loadKey);
    console.log(`[model-manager] Loading LLM model: ${modelId} (${config.hfId})`);

    try {
      // Unload existing generator if different model
      if (this.generator && this.currentLLMModel !== modelId) {
        console.log(`[model-manager] Unloading previous generator: ${this.currentLLMModel}`);
        this.generator = null;
        this.currentLLMModel = null;
      }

      // Create pipeline with progress callback
      this.generator = await pipeline('text-generation', config.hfId, {
        progress_callback: (progress: any) => {
          this.emit('download-progress', {
            model: modelId,
            type: 'llm',
            status: progress.status === 'done' ? 'complete' : 'downloading',
            progress: progress.progress || 0,
            bytesDownloaded: progress.loaded,
            totalBytes: progress.total
          } as DownloadProgress);
        }
      });

      this.currentLLMModel = modelId;
      console.log(`[model-manager] LLM model loaded: ${modelId}`);

      this.emit('model-loaded', { type: 'llm', model: modelId });
    } catch (error) {
      console.error(`[model-manager] Failed to load LLM model ${modelId}:`, error);
      this.emit('download-progress', {
        model: modelId,
        type: 'llm',
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : String(error)
      } as DownloadProgress);
      throw error;
    } finally {
      this.loading.delete(loadKey);
    }
  }

  /**
   * Generate embeddings for texts
   */
  async embed(texts: string | string[]): Promise<number[][]> {
    if (!this.embedder) {
      throw new Error('No embedding model loaded. Call loadEmbedder() first.');
    }

    const inputTexts = Array.isArray(texts) ? texts : [texts];

    try {
      const output = await this.embedder(inputTexts, {
        pooling: 'mean',
        normalize: true
      });

      // Convert to array format
      return output.tolist();
    } catch (error) {
      console.error('[model-manager] Embedding error:', error);
      throw error;
    }
  }

  /**
   * Generate text using the loaded LLM
   */
  async generate(
    prompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      topP?: number;
      doSample?: boolean;
    } = {}
  ): Promise<string> {
    if (!this.generator) {
      throw new Error('No LLM model loaded. Call loadGenerator() first.');
    }

    const {
      maxTokens = 256,
      temperature = 0.7,
      topP = 0.9,
      doSample = true
    } = options;

    try {
      const output = await this.generator(prompt, {
        max_new_tokens: maxTokens,
        temperature,
        top_p: topP,
        do_sample: doSample
      });

      // Extract generated text
      if (Array.isArray(output) && output.length > 0) {
        const generated = output[0] as { generated_text: string };
        return generated.generated_text;
      }

      throw new Error('Unexpected output format from generator');
    } catch (error) {
      console.error('[model-manager] Generation error:', error);
      throw error;
    }
  }

  /**
   * Unload all models to free memory
   */
  async unloadAll(): Promise<void> {
    console.log('[model-manager] Unloading all models');

    this.embedder = null;
    this.generator = null;
    this.currentEmbeddingModel = null;
    this.currentLLMModel = null;

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    this.emit('models-unloaded');
  }

  /**
   * Unload embedding model only
   */
  async unloadEmbedder(): Promise<void> {
    if (this.embedder) {
      console.log(`[model-manager] Unloading embedder: ${this.currentEmbeddingModel}`);
      this.embedder = null;
      this.currentEmbeddingModel = null;
      this.emit('model-unloaded', { type: 'embeddings' });
    }
  }

  /**
   * Unload LLM model only
   */
  async unloadGenerator(): Promise<void> {
    if (this.generator) {
      console.log(`[model-manager] Unloading generator: ${this.currentLLMModel}`);
      this.generator = null;
      this.currentLLMModel = null;
      this.emit('model-unloaded', { type: 'llm' });
    }
  }

  /**
   * Check if embedding model is ready
   */
  isEmbedderReady(): boolean {
    return this.embedder !== null;
  }

  /**
   * Check if LLM model is ready
   */
  isGeneratorReady(): boolean {
    return this.generator !== null;
  }

  /**
   * Get current embedding model ID
   */
  getCurrentEmbeddingModel(): string | null {
    return this.currentEmbeddingModel;
  }

  /**
   * Get current LLM model ID
   */
  getCurrentLLMModel(): string | null {
    return this.currentLLMModel;
  }

  /**
   * Get embedding dimensions for current model
   */
  getEmbeddingDimensions(): number | null {
    if (!this.currentEmbeddingModel) return null;
    return EMBEDDING_MODELS[this.currentEmbeddingModel]?.dimensions ?? null;
  }
}

// Singleton instance (created per service)
let instance: ModelManager | null = null;

export function getModelManager(modelsDir?: string): ModelManager {
  if (!instance && modelsDir) {
    instance = new ModelManager(modelsDir);
  }
  if (!instance) {
    throw new Error('ModelManager not initialized. Provide modelsDir on first call.');
  }
  return instance;
}

export function resetModelManager(): void {
  if (instance) {
    instance.unloadAll();
    instance = null;
  }
}

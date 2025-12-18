/**
 * Model Manager
 *
 * Handles loading, unloading, and managing embedding and LLM models
 * using node-llama-cpp for GGUF model support.
 */

import { getLlama, LlamaModel, LlamaContext, LlamaEmbeddingContext, LlamaChatSession } from 'node-llama-cpp';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import https from 'https';
import http from 'http';
import {
  EMBEDDING_MODELS,
  LLM_MODELS,
  type EmbeddingModelConfig,
  type LLMModelConfig,
  getModelPath,
  getModelDownloadUrl,
  isModelDownloaded,
  loadConfig
} from './config.js';

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
    contextLength?: number;
  };
}

export class ModelManager extends EventEmitter {
  private llama: Awaited<ReturnType<typeof getLlama>> | null = null;

  // Embedding model
  private embedModel: LlamaModel | null = null;
  private embedContext: LlamaEmbeddingContext | null = null;
  private currentEmbeddingModel: string | null = null;

  // LLM model
  private llmModel: LlamaModel | null = null;
  private llmContext: LlamaContext | null = null;
  private currentLLMModel: string | null = null;

  private modelsDir: string;
  private loading: Set<string> = new Set();

  constructor(modelsDir: string) {
    super();
    this.modelsDir = modelsDir;

    // Ensure models directory exists
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }
  }

  /**
   * Initialize llama.cpp backend (CPU-only mode)
   *
   * We force CPU-only mode (gpu: false) because:
   * 1. Embeddings are fast enough on CPU for our use case
   * 2. GPU memory should be reserved for the main LLM (vLLM/Ollama)
   * 3. This allows embeddings to run in parallel with GPU inference
   * 4. Avoids CUDA out-of-memory errors when GPU is busy
   */
  private async ensureLlama(): Promise<Awaited<ReturnType<typeof getLlama>>> {
    if (!this.llama) {
      const serviceConfig = loadConfig();
      const useGpu = serviceConfig.llama?.gpuLayers > 0;

      console.log(`[model-manager] Initializing llama.cpp backend (${useGpu ? 'GPU' : 'CPU-only'})...`);

      // Force CPU-only unless explicitly configured for GPU
      this.llama = await getLlama({
        gpu: useGpu ? 'auto' : false
      });

      console.log('[model-manager] llama.cpp backend ready');
    }
    return this.llama;
  }

  /**
   * Get current loaded model status
   */
  getStatus(): LoadedModelStatus {
    const embeddingConfig = this.currentEmbeddingModel
      ? EMBEDDING_MODELS[this.currentEmbeddingModel]
      : null;
    const llmConfig = this.currentLLMModel
      ? LLM_MODELS[this.currentLLMModel]
      : null;

    return {
      embedder: {
        model: this.currentEmbeddingModel,
        loaded: this.embedContext !== null,
        dimensions: embeddingConfig?.dimensions
      },
      generator: {
        model: this.currentLLMModel,
        loaded: this.llmContext !== null,
        contextLength: llmConfig?.contextLength
      }
    };
  }

  /**
   * Download a model from HuggingFace
   */
  async downloadModel(
    modelId: string,
    type: 'embeddings' | 'llm'
  ): Promise<void> {
    const config = type === 'embeddings'
      ? EMBEDDING_MODELS[modelId]
      : LLM_MODELS[modelId];

    if (!config) {
      throw new Error(`Unknown ${type} model: ${modelId}`);
    }

    const modelPath = getModelPath(this.modelsDir, config.filename);
    const downloadUrl = getModelDownloadUrl(config.hfRepo, config.filename);

    // Skip if already downloaded
    if (fs.existsSync(modelPath)) {
      console.log(`[model-manager] Model ${modelId} already downloaded`);
      return;
    }

    console.log(`[model-manager] Downloading ${modelId} from ${downloadUrl}`);

    this.emit('download-progress', {
      model: modelId,
      type,
      status: 'starting',
      progress: 0
    } as DownloadProgress);

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(modelPath + '.tmp');
      const protocol = downloadUrl.startsWith('https') ? https : http;

      const request = protocol.get(downloadUrl, { headers: { 'User-Agent': 'node-llama-cpp' } }, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(modelPath + '.tmp');
            // Recursively follow redirect
            this.downloadModelFromUrl(redirectUrl, modelPath, modelId, type)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(modelPath + '.tmp');
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const progress = totalBytes > 0 ? downloadedBytes / totalBytes : 0;

          this.emit('download-progress', {
            model: modelId,
            type,
            status: 'downloading',
            progress,
            bytesDownloaded: downloadedBytes,
            totalBytes
          } as DownloadProgress);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          // Rename temp file to final
          fs.renameSync(modelPath + '.tmp', modelPath);

          this.emit('download-progress', {
            model: modelId,
            type,
            status: 'complete',
            progress: 1
          } as DownloadProgress);

          console.log(`[model-manager] Downloaded ${modelId}`);
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(modelPath + '.tmp')) {
          fs.unlinkSync(modelPath + '.tmp');
        }
        this.emit('download-progress', {
          model: modelId,
          type,
          status: 'error',
          progress: 0,
          error: err.message
        } as DownloadProgress);
        reject(err);
      });
    });
  }

  /**
   * Helper to download from a specific URL (for redirects)
   */
  private async downloadModelFromUrl(
    url: string,
    modelPath: string,
    modelId: string,
    type: 'embeddings' | 'llm'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(modelPath + '.tmp');
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, { headers: { 'User-Agent': 'node-llama-cpp' } }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            if (fs.existsSync(modelPath + '.tmp')) fs.unlinkSync(modelPath + '.tmp');
            this.downloadModelFromUrl(redirectUrl, modelPath, modelId, type)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(modelPath + '.tmp')) fs.unlinkSync(modelPath + '.tmp');
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const progress = totalBytes > 0 ? downloadedBytes / totalBytes : 0;

          this.emit('download-progress', {
            model: modelId,
            type,
            status: 'downloading',
            progress,
            bytesDownloaded: downloadedBytes,
            totalBytes
          } as DownloadProgress);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          fs.renameSync(modelPath + '.tmp', modelPath);

          this.emit('download-progress', {
            model: modelId,
            type,
            status: 'complete',
            progress: 1
          } as DownloadProgress);

          console.log(`[model-manager] Downloaded ${modelId}`);
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(modelPath + '.tmp')) fs.unlinkSync(modelPath + '.tmp');
        reject(err);
      });
    });
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
    if (this.currentEmbeddingModel === modelId && this.embedContext) {
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
    const modelPath = getModelPath(this.modelsDir, config.filename);

    console.log(`[model-manager] Loading embedding model: ${modelId} (${config.filename})`);

    try {
      // Download if not present
      if (!isModelDownloaded(this.modelsDir, config.filename)) {
        console.log(`[model-manager] Model not found locally, downloading...`);
        await this.downloadModel(modelId, 'embeddings');
      }

      // Unload existing embedder if different model
      if (this.embedContext && this.currentEmbeddingModel !== modelId) {
        console.log(`[model-manager] Unloading previous embedder: ${this.currentEmbeddingModel}`);
        await this.embedContext.dispose();
        this.embedContext = null;
        if (this.embedModel) {
          await this.embedModel.dispose();
          this.embedModel = null;
        }
        this.currentEmbeddingModel = null;
      }

      // Initialize llama backend
      const llama = await this.ensureLlama();
      const serviceConfig = loadConfig();

      // Load the model
      this.embedModel = await llama.loadModel({
        modelPath,
        gpuLayers: serviceConfig.llama?.gpuLayers ?? 0
      });

      // Create embedding context with explicit context size and batch size
      // The default "auto" mode often limits to ~600 tokens which is too small
      // Set contextSize and batchSize to handle longer texts (model supports up to 32K)
      this.embedContext = await this.embedModel.createEmbeddingContext({
        contextSize: 8192,
        batchSize: 8192  // Process all tokens in a single batch
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
    if (this.currentLLMModel === modelId && this.llmContext) {
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
    const modelPath = getModelPath(this.modelsDir, config.filename);

    console.log(`[model-manager] Loading LLM model: ${modelId} (${config.filename})`);

    try {
      // Download if not present
      if (!isModelDownloaded(this.modelsDir, config.filename)) {
        console.log(`[model-manager] Model not found locally, downloading...`);
        await this.downloadModel(modelId, 'llm');
      }

      // Unload existing generator if different model
      if (this.llmContext && this.currentLLMModel !== modelId) {
        console.log(`[model-manager] Unloading previous generator: ${this.currentLLMModel}`);
        await this.llmContext.dispose();
        this.llmContext = null;
        if (this.llmModel) {
          await this.llmModel.dispose();
          this.llmModel = null;
        }
        this.currentLLMModel = null;
      }

      // Initialize llama backend
      const llama = await this.ensureLlama();
      const serviceConfig = loadConfig();

      // Load the model
      this.llmModel = await llama.loadModel({
        modelPath,
        gpuLayers: serviceConfig.llama?.gpuLayers ?? 0
      });

      // Create context for generation
      this.llmContext = await this.llmModel.createContext({
        contextSize: Math.min(config.contextLength, 4096)  // Limit context for memory
      });

      this.currentLLMModel = modelId;
      console.log(`[model-manager] LLM model loaded: ${modelId} (context: ${config.contextLength})`);

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
    if (!this.embedContext) {
      throw new Error('No embedding model loaded. Call loadEmbedder() first.');
    }

    const inputTexts = Array.isArray(texts) ? texts : [texts];
    const results: number[][] = [];

    try {
      for (const text of inputTexts) {
        const embedding = await this.embedContext.getEmbeddingFor(text);
        // Normalize the embedding (L2 normalization)
        const vector = embedding.vector;
        const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        const normalized = norm > 0 ? vector.map(v => v / norm) : vector;
        results.push(Array.from(normalized));
      }

      return results;
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
      stopSequences?: string[];
    } = {}
  ): Promise<string> {
    if (!this.llmModel || !this.llmContext) {
      throw new Error('No LLM model loaded. Call loadGenerator() first.');
    }

    const {
      maxTokens = 256,
      temperature = 0.7,
      topP = 0.9,
      stopSequences = []
    } = options;

    try {
      // Create a chat session for the generation
      const session = new LlamaChatSession({
        contextSequence: this.llmContext.getSequence()
      });

      const response = await session.prompt(prompt, {
        maxTokens,
        temperature,
        topP
      });

      return response;
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

    if (this.embedContext) {
      await this.embedContext.dispose();
      this.embedContext = null;
    }
    if (this.embedModel) {
      await this.embedModel.dispose();
      this.embedModel = null;
    }
    if (this.llmContext) {
      await this.llmContext.dispose();
      this.llmContext = null;
    }
    if (this.llmModel) {
      await this.llmModel.dispose();
      this.llmModel = null;
    }

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
    if (this.embedContext) {
      console.log(`[model-manager] Unloading embedder: ${this.currentEmbeddingModel}`);
      await this.embedContext.dispose();
      this.embedContext = null;
    }
    if (this.embedModel) {
      await this.embedModel.dispose();
      this.embedModel = null;
    }
    this.currentEmbeddingModel = null;
    this.emit('model-unloaded', { type: 'embeddings' });
  }

  /**
   * Unload LLM model only
   */
  async unloadGenerator(): Promise<void> {
    if (this.llmContext) {
      console.log(`[model-manager] Unloading generator: ${this.currentLLMModel}`);
      await this.llmContext.dispose();
      this.llmContext = null;
    }
    if (this.llmModel) {
      await this.llmModel.dispose();
      this.llmModel = null;
    }
    this.currentLLMModel = null;
    this.emit('model-unloaded', { type: 'llm' });
  }

  /**
   * Check if embedding model is ready
   */
  isEmbedderReady(): boolean {
    return this.embedContext !== null;
  }

  /**
   * Check if LLM model is ready
   */
  isGeneratorReady(): boolean {
    return this.llmContext !== null;
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

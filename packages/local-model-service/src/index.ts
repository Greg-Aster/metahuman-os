/**
 * Local Model Service
 *
 * HTTP server for local embedding and LLM inference using node-llama-cpp (llama.cpp).
 * Provides unified semantic search for web and mobile (monorepo architecture).
 * Uses GGUF format models downloaded from HuggingFace.
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { ModelManager, getModelManager, type DownloadProgress } from './model-manager.js';
import {
  loadConfig,
  saveConfig,
  setConfigPath,
  getAvailableModels,
  EMBEDDING_MODELS,
  LLM_MODELS,
  type LocalModelServiceConfig
} from './config.js';

// Request/Response types
interface EmbeddingsRequest {
  text: string | string[];
  model?: string;
}

interface EmbeddingsResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
}

interface GenerateRequest {
  prompt: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
}

interface GenerateResponse {
  text: string;
  model: string;
}

interface ModelDownloadRequest {
  type: 'embeddings' | 'llm';
  model: string;
}

interface HealthResponse {
  status: 'ok' | 'error';
  embedder: {
    loaded: boolean;
    model: string | null;
  };
  generator: {
    loaded: boolean;
    model: string | null;
  };
}

// Server instance
let server: FastifyInstance | null = null;
let modelManager: ModelManager | null = null;

/**
 * Create and configure the Fastify server
 */
function createServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info'
    }
  });

  // Enable CORS
  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Health check endpoint (silent logging - polled frequently)
  app.get('/health', { logLevel: 'silent' }, async (): Promise<HealthResponse> => {
    const status = modelManager?.getStatus();
    return {
      status: 'ok',
      embedder: {
        loaded: status?.embedder.loaded ?? false,
        model: status?.embedder.model ?? null
      },
      generator: {
        loaded: status?.generator.loaded ?? false,
        model: status?.generator.model ?? null
      }
    };
  });

  // Embeddings endpoint
  app.post<{ Body: EmbeddingsRequest }>('/embeddings', async (request, reply): Promise<EmbeddingsResponse> => {
    const { text, model } = request.body;

    if (!text) {
      reply.code(400);
      throw new Error('Missing required field: text');
    }

    if (!modelManager) {
      reply.code(503);
      throw new Error('Model manager not initialized');
    }

    // Load model if specified and different from current
    const targetModel = model || loadConfig().embeddings.model;
    if (targetModel && targetModel !== modelManager.getCurrentEmbeddingModel()) {
      await modelManager.loadEmbedder(targetModel);
    }

    if (!modelManager.isEmbedderReady()) {
      reply.code(503);
      throw new Error('No embedding model loaded');
    }

    const embeddings = await modelManager.embed(text);
    const dimensions = modelManager.getEmbeddingDimensions() || 0;

    return {
      embeddings,
      model: modelManager.getCurrentEmbeddingModel() || 'unknown',
      dimensions
    };
  });

  // Text generation endpoint
  app.post<{ Body: GenerateRequest }>('/generate', async (request, reply): Promise<GenerateResponse> => {
    const { prompt, model, max_tokens, temperature, top_p } = request.body;

    if (!prompt) {
      reply.code(400);
      throw new Error('Missing required field: prompt');
    }

    if (!modelManager) {
      reply.code(503);
      throw new Error('Model manager not initialized');
    }

    // Load model if specified and different from current
    const targetModel = model || loadConfig().llm.model;
    if (targetModel && targetModel !== modelManager.getCurrentLLMModel()) {
      await modelManager.loadGenerator(targetModel);
    }

    if (!modelManager.isGeneratorReady()) {
      reply.code(503);
      throw new Error('No LLM model loaded');
    }

    const text = await modelManager.generate(prompt, {
      maxTokens: max_tokens,
      temperature,
      topP: top_p
    });

    return {
      text,
      model: modelManager.getCurrentLLMModel() || 'unknown'
    };
  });

  // List available models
  app.get('/models', async () => {
    const config = loadConfig();
    return getAvailableModels(config.modelsDir);
  });

  // Get loaded models status (silent logging - polled frequently)
  app.get('/models/loaded', { logLevel: 'silent' }, async () => {
    return modelManager?.getStatus() || {
      embedder: { model: null, loaded: false },
      generator: { model: null, loaded: false }
    };
  });

  // Download model endpoint
  app.post<{ Body: ModelDownloadRequest }>('/models/download', async (request, reply) => {
    const { type, model } = request.body;

    if (!type || !model) {
      reply.code(400);
      throw new Error('Missing required fields: type, model');
    }

    if (!modelManager) {
      reply.code(503);
      throw new Error('Model manager not initialized');
    }

    // Validate model exists
    if (type === 'embeddings' && !EMBEDDING_MODELS[model]) {
      reply.code(400);
      throw new Error(`Unknown embedding model: ${model}`);
    }
    if (type === 'llm' && !LLM_MODELS[model]) {
      reply.code(400);
      throw new Error(`Unknown LLM model: ${model}`);
    }

    // Start download in background
    reply.code(202);

    if (type === 'embeddings') {
      modelManager.loadEmbedder(model).catch(err => {
        console.error(`[local-models] Failed to download embedding model ${model}:`, err);
      });
    } else {
      modelManager.loadGenerator(model).catch(err => {
        console.error(`[local-models] Failed to download LLM model ${model}:`, err);
      });
    }

    return { status: 'downloading', model, type };
  });

  // Load specific model
  app.post<{ Body: { type: 'embeddings' | 'llm'; model: string } }>('/models/load', async (request, reply) => {
    const { type, model } = request.body;

    if (!modelManager) {
      reply.code(503);
      throw new Error('Model manager not initialized');
    }

    if (type === 'embeddings') {
      await modelManager.loadEmbedder(model);
    } else {
      await modelManager.loadGenerator(model);
    }

    return { status: 'loaded', model, type };
  });

  // Unload model
  app.post<{ Body: { type: 'embeddings' | 'llm' } }>('/models/unload', async (request, reply) => {
    const { type } = request.body;

    if (!modelManager) {
      reply.code(503);
      throw new Error('Model manager not initialized');
    }

    if (type === 'embeddings') {
      await modelManager.unloadEmbedder();
    } else {
      await modelManager.unloadGenerator();
    }

    return { status: 'unloaded', type };
  });

  // Get/update configuration
  app.get('/config', async () => {
    return loadConfig();
  });

  app.post<{ Body: Partial<LocalModelServiceConfig> }>('/config', async (request) => {
    saveConfig(request.body);
    return loadConfig();
  });

  // SSE endpoint for download progress
  app.get('/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const sendEvent = (data: DownloadProgress) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    modelManager?.on('download-progress', sendEvent);

    request.raw.on('close', () => {
      modelManager?.off('download-progress', sendEvent);
    });
  });

  return app;
}

/**
 * Start the local model service
 */
export async function startLocalModelService(options: {
  port?: number;
  host?: string;
  modelsDir: string;
  configPath?: string;
  preloadEmbeddings?: boolean;
  preloadLLM?: boolean;
}): Promise<FastifyInstance> {
  const {
    port = 4324,
    host = '127.0.0.1',
    modelsDir,
    configPath,
    preloadEmbeddings,
    preloadLLM
  } = options;

  // Set config path if provided
  if (configPath) {
    setConfigPath(configPath);
  }

  // Initialize model manager
  modelManager = getModelManager(modelsDir);
  console.log(`[local-models] Models directory: ${modelsDir}`);

  // Create server
  server = createServer();

  // Start server
  await server.listen({ port, host });
  console.log(`[local-models] Service started on http://${host}:${port}`);

  // Preload models if configured
  const config = loadConfig();

  if (preloadEmbeddings ?? config.embeddings.preloadAtStartup) {
    console.log(`[local-models] Preloading embedding model: ${config.embeddings.model}`);
    modelManager.loadEmbedder(config.embeddings.model).catch(err => {
      console.error('[local-models] Failed to preload embedding model:', err);
    });
  }

  if (preloadLLM ?? config.llm.preloadAtStartup) {
    console.log(`[local-models] Preloading LLM model: ${config.llm.model}`);
    modelManager.loadGenerator(config.llm.model).catch(err => {
      console.error('[local-models] Failed to preload LLM model:', err);
    });
  }

  return server;
}

/**
 * Stop the local model service
 */
export async function stopLocalModelService(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    console.log('[local-models] Service stopped');
  }

  if (modelManager) {
    await modelManager.unloadAll();
    modelManager = null;
  }
}

/**
 * Get the model manager instance
 */
export function getManager(): ModelManager | null {
  return modelManager;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '4324', 10);
  const host = process.env.HOST || '127.0.0.1';
  const modelsDir = process.env.MODELS_DIR || './models';
  const configPath = process.env.CONFIG_PATH;

  startLocalModelService({
    port,
    host,
    modelsDir,
    configPath
  }).catch(err => {
    console.error('[local-models] Failed to start service:', err);
    process.exit(1);
  });
}

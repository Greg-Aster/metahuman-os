/**
 * Local Model Service Configuration
 *
 * Manages configuration for the local embedding and LLM service.
 * Uses GGUF format models via node-llama-cpp for maximum compatibility.
 */

import * as fs from 'fs';
import * as path from 'path';

// Embedding model definitions (GGUF format)
export interface EmbeddingModelConfig {
  filename: string;
  hfRepo: string;
  dimensions: number;
  size: string;
  description?: string;
}

// LLM model definitions (GGUF format)
export interface LLMModelConfig {
  filename: string;
  hfRepo: string;
  size: string;
  contextLength: number;
  description?: string;
}

/**
 * Available embedding models (GGUF format for llama.cpp)
 *
 * These are text embedding models that can generate vector representations.
 * All models use mean pooling and L2 normalization.
 *
 * NOTE: Only models released within the last 6 months (2024-2025) are included.
 */
export const EMBEDDING_MODELS: Record<string, EmbeddingModelConfig> = {
  // Qwen3 Embedding 0.6B - September 2024
  // Actual Qwen3 embedding model with MRL (Matryoshka Representation Learning) support
  'qwen3-embedding-0.6b': {
    filename: 'Qwen3-Embedding-0.6B-q4_k_m.gguf',
    hfRepo: 'Mungert/Qwen3-Embedding-0.6B-GGUF',
    dimensions: 1024,
    size: '~395MB',
    description: 'Qwen3 Embedding 0.6B (Q4_K_M), 1024-dim, MRL support (32-1024), Sep 2024'
  },
  // MixedBread mxbai-embed-large-v1 - Most downloaded GGUF embedding model
  // Premium quality, top MTEB scores
  'mxbai-embed-large-v1': {
    filename: 'mxbai-embed-large-v1-q4_k_m.gguf',
    hfRepo: 'mixedbread-ai/mxbai-embed-large-v1',
    dimensions: 1024,
    size: '~340MB',
    description: 'MixedBread 1024-dim, top MTEB scores (Q4_K_M), most popular'
  },
  // Nomic embed v1.5 - Good general-purpose option
  'nomic-embed-text-v1.5': {
    filename: 'nomic-embed-text-v1.5.Q4_K_M.gguf',
    hfRepo: 'nomic-ai/nomic-embed-text-v1.5-GGUF',
    dimensions: 768,
    size: '~140MB',
    description: 'Nomic embed v1.5 (Q4_K_M), 768-dim, 8192 tokens context'
  },
  // Lightweight option for mobile/constrained environments
  'all-minilm-l6-v2': {
    filename: 'all-MiniLM-L6-v2-Q4_K_M.gguf',
    hfRepo: 'leliuga/all-MiniLM-L6-v2-GGUF',
    dimensions: 384,
    size: '~23MB',
    description: 'Ultra-lightweight 384-dim, fast inference'
  }
};

/**
 * Available LLM models (GGUF format for llama.cpp)
 *
 * These are text generation models for chat/completion.
 */
export const LLM_MODELS: Record<string, LLMModelConfig> = {
  'qwen3-1.7b': {
    filename: 'Qwen3-1.7B-Q4_K_M.gguf',
    hfRepo: 'unsloth/Qwen3-1.7B-GGUF',
    size: '~1.2GB',
    contextLength: 32768,
    description: 'Qwen3 1.7B (Q4_K_M), latest Qwen generation, excellent for mobile'
  },
  'qwen2.5-1.5b': {
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    hfRepo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    size: '~1GB',
    contextLength: 32768,
    description: 'Qwen 2.5 1.5B Instruct (Q4_K_M), excellent quality'
  },
  'qwen2.5-0.5b': {
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    hfRepo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    size: '~400MB',
    contextLength: 32768,
    description: 'Qwen 2.5 0.5B Instruct (Q4_K_M), ultra-light'
  },
  'llama-3.2-1b': {
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    hfRepo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
    size: '~750MB',
    contextLength: 131072,
    description: 'Llama 3.2 1B Instruct, huge context window'
  },
  'tinyllama-1.1b': {
    filename: 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
    hfRepo: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
    size: '~670MB',
    contextLength: 2048,
    description: 'TinyLlama 1.1B Chat, fast and efficient'
  }
};

// Service configuration
export interface LocalModelServiceConfig {
  enabled: boolean;
  endpoint: string;
  port: number;
  autoStart: boolean;
  downloadOnWifiOnly: boolean;

  embeddings: {
    model: string;
    preloadAtStartup: boolean;
  };

  llm: {
    model: string;
    preloadAtStartup: boolean;
  };

  modelsDir: string;

  // llama.cpp specific options
  llama: {
    gpuLayers: number;  // Number of layers to offload to GPU (0 = CPU only)
    threads: number;    // Number of CPU threads (0 = auto)
  };
}

// Default configuration
export const DEFAULT_CONFIG: LocalModelServiceConfig = {
  enabled: true,
  endpoint: 'http://127.0.0.1:4324',
  port: 4324,
  autoStart: true,
  downloadOnWifiOnly: true,

  embeddings: {
    model: 'qwen3-embedding-0.6b',  // Qwen3 Embedding 0.6B, 1024-dim, Sep 2024
    preloadAtStartup: true
  },

  llm: {
    model: 'qwen3-1.7b',
    preloadAtStartup: false
  },

  modelsDir: '',  // Set at runtime based on profile

  llama: {
    gpuLayers: 0,  // CPU only by default (safe for all devices)
    threads: 0     // Auto-detect
  }
};

// Config file path
let configPath: string | null = null;
let cachedConfig: LocalModelServiceConfig | null = null;

/**
 * Set the configuration file path
 */
export function setConfigPath(filePath: string): void {
  configPath = filePath;
  cachedConfig = null;
}

/**
 * Load configuration from file or return defaults
 */
export function loadConfig(): LocalModelServiceConfig {
  if (cachedConfig) return cachedConfig;

  if (configPath && fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(fileContent);
      const merged: LocalModelServiceConfig = { ...DEFAULT_CONFIG, ...fileConfig };
      cachedConfig = merged;
      return merged;
    } catch (error) {
      console.error('[local-models] Failed to load config:', error);
    }
  }

  cachedConfig = DEFAULT_CONFIG;
  return DEFAULT_CONFIG;
}

/**
 * Save configuration to file
 */
export function saveConfig(config: Partial<LocalModelServiceConfig>): void {
  const currentConfig = loadConfig();
  const newConfig = { ...currentConfig, ...config };

  if (configPath) {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
    cachedConfig = newConfig;
  }
}

/**
 * Get the full path to a model file
 */
export function getModelPath(modelsDir: string, filename: string): string {
  return path.join(modelsDir, filename);
}

/**
 * Get the HuggingFace download URL for a model
 */
export function getModelDownloadUrl(hfRepo: string, filename: string): string {
  return `https://huggingface.co/${hfRepo}/resolve/main/${filename}`;
}

/**
 * Check if a model file exists locally
 */
export function isModelDownloaded(modelsDir: string, filename: string): boolean {
  const modelPath = getModelPath(modelsDir, filename);
  return fs.existsSync(modelPath);
}

/**
 * Get list of available models with download status
 */
export function getAvailableModels(modelsDir: string): {
  embeddings: Array<{ id: string; config: EmbeddingModelConfig; downloaded: boolean }>;
  llm: Array<{ id: string; config: LLMModelConfig; downloaded: boolean }>;
} {
  return {
    embeddings: Object.entries(EMBEDDING_MODELS).map(([id, config]) => ({
      id,
      config,
      downloaded: isModelDownloaded(modelsDir, config.filename)
    })),
    llm: Object.entries(LLM_MODELS).map(([id, config]) => ({
      id,
      config,
      downloaded: isModelDownloaded(modelsDir, config.filename)
    }))
  };
}

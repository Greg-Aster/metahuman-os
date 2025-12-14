/**
 * Local Model Service Configuration
 *
 * Manages configuration for the local embedding and LLM service.
 */

import * as fs from 'fs';
import * as path from 'path';

// Embedding model definitions
export interface EmbeddingModelConfig {
  hfId: string;
  dimensions: number;
  size: string;
  description?: string;
}

// LLM model definitions
export interface LLMModelConfig {
  hfId: string;
  size: string;
  description?: string;
}

// Available embedding models
export const EMBEDDING_MODELS: Record<string, EmbeddingModelConfig> = {
  'qwen3-embedding-0.6b': {
    hfId: 'Qwen/Qwen3-Embedding-0.6B',
    dimensions: 1024,
    size: '560MB',
    description: 'State-of-the-art embedding model, #1 on MTEB multilingual leaderboard'
  },
  'qwen3-embedding-4b': {
    hfId: 'Qwen/Qwen3-Embedding-4B',
    dimensions: 1024,
    size: '2.5GB',
    description: 'Premium quality embedding model for servers'
  },
  'all-MiniLM-L6-v2': {
    hfId: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    size: '23MB',
    description: 'Lightweight fallback for low-memory devices'
  }
};

// Available LLM models
export const LLM_MODELS: Record<string, LLMModelConfig> = {
  'qwen3-1.7b': {
    hfId: 'Xenova/Qwen2.5-1.5B-Instruct',
    size: '1.2GB',
    description: 'Good quality small LLM, balanced performance'
  },
  'qwen2-0.5b': {
    hfId: 'Xenova/Qwen2-0.5B-Instruct',
    size: '400MB',
    description: 'Ultra-light LLM for budget devices'
  },
  'tinyllama': {
    hfId: 'Xenova/TinyLlama-1.1B-Chat-v1.0',
    size: '600MB',
    description: 'Fast and lightweight chat model'
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
}

// Default configuration
export const DEFAULT_CONFIG: LocalModelServiceConfig = {
  enabled: true,
  endpoint: 'http://127.0.0.1:4324',
  port: 4324,
  autoStart: true,
  downloadOnWifiOnly: true,

  embeddings: {
    model: 'qwen3-embedding-0.6b',
    preloadAtStartup: true
  },

  llm: {
    model: 'qwen3-1.7b',
    preloadAtStartup: false
  },

  modelsDir: ''  // Set at runtime based on profile
};

// Config file path
let configPath: string | null = null;
let cachedConfig: LocalModelServiceConfig | null = null;

/**
 * Set the configuration file path
 */
export function setConfigPath(path: string): void {
  configPath = path;
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
      cachedConfig = { ...DEFAULT_CONFIG, ...fileConfig };
      return cachedConfig;
    } catch (error) {
      console.error('[local-models] Failed to load config:', error);
    }
  }

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
      downloaded: isModelDownloaded(modelsDir, config.hfId)
    })),
    llm: Object.entries(LLM_MODELS).map(([id, config]) => ({
      id,
      config,
      downloaded: isModelDownloaded(modelsDir, config.hfId)
    }))
  };
}

/**
 * Check if a model is downloaded
 */
function isModelDownloaded(modelsDir: string, hfId: string): boolean {
  // Transformers.js stores models in a specific directory structure
  const modelPath = path.join(modelsDir, 'models--' + hfId.replace('/', '--'));
  return fs.existsSync(modelPath);
}

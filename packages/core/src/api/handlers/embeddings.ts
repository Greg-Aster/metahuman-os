import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { systemPaths } from '../../paths.js';

interface EmbeddingsConfig {
  enabled?: boolean;
  model?: string;
  provider?: string;
  preloadAtStartup?: boolean;
  description?: string;
  localModels?: {
    endpoint?: string;
    model?: string;
  };
  indexContentMode?: 'user' | 'all' | 'agent';
  indexContentModeOptions?: Record<string, string>;
}

const embeddingsConfigPath = path.join(systemPaths.root, 'etc', 'embeddings.json');

function loadConfig(): EmbeddingsConfig {
  try {
    return JSON.parse(fs.readFileSync(embeddingsConfigPath, 'utf-8'));
  } catch {
    return { indexContentMode: 'user' };
  }
}

function saveConfig(config: EmbeddingsConfig): void {
  fs.writeFileSync(embeddingsConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function handleGetEmbeddingsConfig(): Promise<UnifiedResponse> {
  try {
    return { status: 200, data: loadConfig() };
  } catch (error) {
    return {
      status: 500,
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

export async function handleUpdateEmbeddingsConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body || {};
    const updatedConfig: EmbeddingsConfig = { ...loadConfig() };

    if (typeof body.indexContentMode === 'string' && ['user', 'all', 'agent'].includes(body.indexContentMode)) {
      updatedConfig.indexContentMode = body.indexContentMode;
    }

    saveConfig(updatedConfig);

    return {
      status: 200,
      data: {
        success: true,
        config: updatedConfig,
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

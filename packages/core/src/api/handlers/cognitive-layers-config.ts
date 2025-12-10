/**
 * Cognitive Layers Config API Handlers
 *
 * Unified handlers for cognitive layer configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { audit } from '../../audit.js';

interface CognitiveLayersConfig {
  useCognitivePipeline: boolean;
  enableSafetyChecks: boolean;
  enableResponseRefinement: boolean;
  enableBlockingMode: boolean;
}

// Default configuration
const DEFAULT_CONFIG: CognitiveLayersConfig = {
  useCognitivePipeline: true,
  enableSafetyChecks: true,
  enableResponseRefinement: true,
  enableBlockingMode: false,
};

function getConfigPath(): string {
  return path.join(systemPaths.etc, 'cognitive-layers.json');
}

function loadConfig(): CognitiveLayersConfig {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('[cognitive-layers-config] Failed to load config:', error);
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config: CognitiveLayersConfig): boolean {
  try {
    const configPath = getConfigPath();
    // Ensure etc/ directory exists
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('[cognitive-layers-config] Failed to save config:', error);
    return false;
  }
}

/**
 * GET /api/cognitive-layers-config - Get current cognitive layer settings
 */
export async function handleGetCognitiveLayersConfig(
  _req: UnifiedRequest
): Promise<UnifiedResponse> {
  try {
    const config = loadConfig();

    return successResponse({
      success: true,
      config,
    });
  } catch (error) {
    console.error('[cognitive-layers-config] GET error:', error);
    return { status: 500, error: 'Failed to load configuration' };
  }
}

/**
 * POST /api/cognitive-layers-config - Update cognitive layer settings
 */
export async function handleSetCognitiveLayersConfig(
  req: UnifiedRequest
): Promise<UnifiedResponse> {
  const { body } = req;

  try {
    const currentConfig = loadConfig();

    // Merge with current config (only update provided fields)
    const newConfig: CognitiveLayersConfig = {
      useCognitivePipeline: body?.useCognitivePipeline ?? currentConfig.useCognitivePipeline,
      enableSafetyChecks: body?.enableSafetyChecks ?? currentConfig.enableSafetyChecks,
      enableResponseRefinement:
        body?.enableResponseRefinement ?? currentConfig.enableResponseRefinement,
      enableBlockingMode: body?.enableBlockingMode ?? currentConfig.enableBlockingMode,
    };

    // Validation: Safety checks and refinement require pipeline to be enabled
    if (!newConfig.useCognitivePipeline) {
      newConfig.enableSafetyChecks = false;
      newConfig.enableResponseRefinement = false;
      newConfig.enableBlockingMode = false;
    }

    // Validation: Blocking mode requires refinement to be enabled
    if (newConfig.enableBlockingMode && !newConfig.enableResponseRefinement) {
      newConfig.enableBlockingMode = false;
    }

    // Save configuration
    const saved = saveConfig(newConfig);

    if (!saved) {
      return { status: 500, error: 'Failed to save configuration' };
    }

    // Audit the change
    audit({
      category: 'action',
      level: 'info',
      action: 'cognitive_layers_config_changed',
      actor: 'human',
      details: {
        previous: currentConfig,
        new: newConfig,
        changes: Object.keys(newConfig).filter(
          (key) =>
            currentConfig[key as keyof CognitiveLayersConfig] !==
            newConfig[key as keyof CognitiveLayersConfig]
        ),
      },
    });

    return successResponse({
      success: true,
      config: newConfig,
      message: 'Configuration updated successfully',
    });
  } catch (error) {
    console.error('[cognitive-layers-config] POST error:', error);
    return { status: 500, error: 'Failed to update configuration' };
  }
}

/**
 * API endpoint for managing cognitive layer configuration
 *
 * GET: Returns current cognitive layer settings
 * POST: Updates cognitive layer settings (saved to etc/cognitive-layers.json)
 */

import type { APIRoute } from 'astro';
import { paths } from '@metahuman/core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { audit } from '@metahuman/core';

interface CognitiveLayersConfig {
  useCognitivePipeline: boolean;
  enableSafetyChecks: boolean;
  enableResponseRefinement: boolean;
  enableBlockingMode: boolean;
}

const CONFIG_PATH = `${paths.root}/etc/cognitive-layers.json`;

// Default configuration
const DEFAULT_CONFIG: CognitiveLayersConfig = {
  useCognitivePipeline: true,
  enableSafetyChecks: true,
  enableResponseRefinement: true,
  enableBlockingMode: false
};

function loadConfig(): CognitiveLayersConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const data = readFileSync(CONFIG_PATH, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('[COGNITIVE_LAYERS_CONFIG] Failed to load config:', error);
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config: CognitiveLayersConfig): boolean {
  try {
    // Ensure etc/ directory exists
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('[COGNITIVE_LAYERS_CONFIG] Failed to save config:', error);
    return false;
  }
}

export const GET: APIRoute = async () => {
  try {
    const config = loadConfig();

    return new Response(
      JSON.stringify({
        success: true,
        config
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('[COGNITIVE_LAYERS_CONFIG] GET error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to load configuration'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const currentConfig = loadConfig();

    // Merge with current config (only update provided fields)
    const newConfig: CognitiveLayersConfig = {
      useCognitivePipeline: body.useCognitivePipeline ?? currentConfig.useCognitivePipeline,
      enableSafetyChecks: body.enableSafetyChecks ?? currentConfig.enableSafetyChecks,
      enableResponseRefinement: body.enableResponseRefinement ?? currentConfig.enableResponseRefinement,
      enableBlockingMode: body.enableBlockingMode ?? currentConfig.enableBlockingMode
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
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to save configuration'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Audit the change
    await audit({
      category: 'action',
      level: 'info',
      action: 'cognitive_layers_config_changed',
      actor: 'human',
      details: {
        previous: currentConfig,
        new: newConfig,
        changes: Object.keys(newConfig).filter(
          key => currentConfig[key as keyof CognitiveLayersConfig] !== newConfig[key as keyof CognitiveLayersConfig]
        )
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        config: newConfig,
        message: 'Configuration updated successfully'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('[COGNITIVE_LAYERS_CONFIG] POST error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to update configuration'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

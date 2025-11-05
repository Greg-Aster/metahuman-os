/**
 * Cognitive Layers - Configuration Loader
 *
 * Loads and validates layer configurations from etc/cognitive-layers.json
 * Supports hot-reload during development
 *
 * @module cognitive-layers/config-loader
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import type { CognitiveModeId } from '../cognitive-mode.js';
import type {
  LayerConfig,
  ModeLayerConfig,
  LayerConfigFile,
  ValidationResult,
  PipelineConfigError
} from './types.js';

// ============================================================================
// Configuration Cache
// ============================================================================

let configCache: LayerConfigFile | null = null;
let configLastModified: number = 0;

/**
 * Path to configuration file
 * Can be overridden via METAHUMAN_LAYER_CONFIG env var
 */
export function getConfigPath(): string {
  if (process.env.METAHUMAN_LAYER_CONFIG) {
    return process.env.METAHUMAN_LAYER_CONFIG;
  }

  // Default: etc/cognitive-layers.json relative to project root
  // Try to find project root (has package.json)
  let current = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, 'package.json'))) {
      return join(current, 'etc', 'cognitive-layers.json');
    }
    current = join(current, '..');
  }

  // Fallback
  return join(process.cwd(), 'etc', 'cognitive-layers.json');
}

// ============================================================================
// Load Configuration
// ============================================================================

/**
 * Load layer configuration from file
 *
 * Features:
 * - Hot-reload support (checks file modification time)
 * - Caching (only reload if file changed)
 * - Validation (ensures config structure is valid)
 *
 * @param forceReload - Force reload even if cached
 * @returns Complete layer configuration
 * @throws PipelineConfigError if config invalid or missing
 */
export function loadLayerConfigFile(forceReload = false): LayerConfigFile {
  const configPath = getConfigPath();

  // Check if file exists
  if (!existsSync(configPath)) {
    throw new Error(
      `Layer configuration not found at ${configPath}. ` +
      `Create etc/cognitive-layers.json or set METAHUMAN_LAYER_CONFIG env var.`
    ) as PipelineConfigError;
  }

  // Check if file changed (for hot-reload)
  const stats = statSync(configPath);
  const lastModified = stats.mtimeMs;

  if (!forceReload && configCache && lastModified === configLastModified) {
    // Use cached config
    return configCache;
  }

  try {
    // Load and parse JSON
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as LayerConfigFile;

    // Validate configuration
    const validation = validateLayerConfigFile(config);
    if (!validation.valid) {
      const error = new Error(
        `Invalid layer configuration: ${validation.errors?.join(', ')}`
      ) as PipelineConfigError;
      error.name = 'PipelineConfigError';
      throw error;
    }

    // Cache config
    configCache = config;
    configLastModified = lastModified;

    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Failed to parse layer configuration: ${error.message}`
      ) as PipelineConfigError;
    }
    throw error;
  }
}

/**
 * Load configuration for specific cognitive mode
 *
 * @param mode - Cognitive mode (dual, agent, emulation)
 * @param forceReload - Force reload config from file
 * @returns Layer configuration for mode
 */
export function loadLayerConfig(
  mode: CognitiveModeId,
  forceReload = false
): ModeLayerConfig {
  const config = loadLayerConfigFile(forceReload);
  return config[mode];
}

/**
 * Get configuration for specific layer in a mode
 *
 * @param mode - Cognitive mode
 * @param layerName - Name of layer
 * @returns Layer config or undefined if not found
 */
export function getLayerConfig(
  mode: CognitiveModeId,
  layerName: string
): LayerConfig | undefined {
  const modeConfig = loadLayerConfig(mode);
  return modeConfig.layers.find(l => l.name === layerName);
}

/**
 * Check if layer is enabled for a mode
 *
 * @param mode - Cognitive mode
 * @param layerName - Name of layer
 * @returns Whether layer is enabled
 */
export function isLayerEnabled(
  mode: CognitiveModeId,
  layerName: string
): boolean {
  const layerConfig = getLayerConfig(mode, layerName);
  return layerConfig?.enabled ?? false;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate complete layer configuration file
 *
 * Checks:
 * - All required modes present (dual, agent, emulation)
 * - Each mode has layers array
 * - Each layer has required fields (name, enabled)
 * - No duplicate layer names per mode
 *
 * @param config - Configuration to validate
 * @returns Validation result
 */
export function validateLayerConfigFile(config: LayerConfigFile): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required modes
  const requiredModes: CognitiveModeId[] = ['dual', 'agent', 'emulation'];
  for (const mode of requiredModes) {
    if (!config[mode]) {
      errors.push(`Missing configuration for mode '${mode}'`);
      continue;
    }

    // Validate mode config
    const modeValidation = validateModeConfig(mode, config[mode]);
    if (!modeValidation.valid) {
      errors.push(...(modeValidation.errors || []));
    }
    if (modeValidation.warnings) {
      warnings.push(...modeValidation.warnings);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Validate configuration for a single mode
 */
function validateModeConfig(
  mode: CognitiveModeId,
  config: ModeLayerConfig
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check layers array exists
  if (!Array.isArray(config.layers)) {
    errors.push(`Mode '${mode}': layers must be an array`);
    return { valid: false, errors };
  }

  // Check each layer
  const seenNames = new Set<string>();
  for (let i = 0; i < config.layers.length; i++) {
    const layer = config.layers[i];

    // Check required fields
    if (!layer.name || typeof layer.name !== 'string') {
      errors.push(`Mode '${mode}': layer ${i} missing 'name' field`);
      continue;
    }

    if (typeof layer.enabled !== 'boolean') {
      errors.push(`Mode '${mode}': layer '${layer.name}' missing 'enabled' field`);
    }

    // Check for duplicates
    if (seenNames.has(layer.name)) {
      errors.push(`Mode '${mode}': duplicate layer name '${layer.name}'`);
    }
    seenNames.add(layer.name);

    // Warn if config is not an object
    if (layer.config && typeof layer.config !== 'object') {
      warnings.push(`Mode '${mode}': layer '${layer.name}' config should be an object`);
    }
  }

  // Warn if no layers enabled
  const enabledCount = config.layers.filter(l => l.enabled).length;
  if (enabledCount === 0) {
    warnings.push(`Mode '${mode}': no layers enabled`);
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Clear configuration cache
 *
 * Useful for:
 * - Testing (reset state between tests)
 * - Hot-reload (force reload of config)
 */
export function clearConfigCache(): void {
  configCache = null;
  configLastModified = 0;
}

/**
 * Get configuration summary (for debugging)
 *
 * @returns Summary of loaded configuration
 */
export function getConfigSummary(): {
  configPath: string;
  loaded: boolean;
  lastModified: number;
  modes: {
    mode: CognitiveModeId;
    layerCount: number;
    enabledLayers: string[];
    disabledLayers: string[];
  }[];
} {
  const configPath = getConfigPath();
  const loaded = configCache !== null;

  if (!loaded) {
    return {
      configPath,
      loaded: false,
      lastModified: 0,
      modes: []
    };
  }

  const modes: CognitiveModeId[] = ['dual', 'agent', 'emulation'];
  const modeSummaries = modes.map(mode => {
    const config = configCache![mode];
    const enabled = config.layers.filter(l => l.enabled);
    const disabled = config.layers.filter(l => !l.enabled);

    return {
      mode,
      layerCount: config.layers.length,
      enabledLayers: enabled.map(l => l.name),
      disabledLayers: disabled.map(l => l.name)
    };
  });

  return {
    configPath,
    loaded: true,
    lastModified: configLastModified,
    modes: modeSummaries
  };
}

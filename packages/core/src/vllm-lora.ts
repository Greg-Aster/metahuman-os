/**
 * vLLM LoRA Adapter Support
 *
 * Handles discovery, validation, and configuration of LoRA adapters for vLLM.
 * vLLM loads LoRAs at startup via --lora-modules flag, then requests specify
 * which LoRA to use via the model parameter.
 *
 * Adapter Format: Safetensors (not GGUF - that's for Ollama)
 * Required Files: adapter_model.safetensors + adapter_config.json
 *
 * Path Pattern:
 *   {profilePath}/out/adapters/{date}/{timestamp}/adapter/
 *   ├── adapter_model.safetensors
 *   └── adapter_config.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { audit } from './audit.js';

// ============================================================================
// Types
// ============================================================================

export interface VllmLoraAdapter {
  /** Unique identifier (e.g., "greggles-2025-12-04") */
  name: string;
  /** Absolute path to adapter directory containing safetensors */
  path: string;
  /** Date from directory name (YYYY-MM-DD) */
  createdAt: string;
  /** Has required files (adapter_model.safetensors + adapter_config.json) */
  valid: boolean;
  /** Currently loaded in vLLM (set by comparing with /v1/models) */
  loaded: boolean;
  /** Base model from adapter_config.json */
  baseModel?: string;
  /** LoRA rank from adapter_config.json */
  loraRank?: number;
  /** File size of adapter_model.safetensors in bytes */
  sizeBytes?: number;
}

export interface VllmLoraConfig {
  /** Names of adapters to load at vLLM startup */
  enabledAdapters: string[];
  /** Maximum LoRA rank (vLLM --max-lora-rank flag, default: 64) */
  maxLoraRank: number;
}

export interface VllmLoraModule {
  /** Adapter name (used in API calls) */
  name: string;
  /** Absolute path to adapter directory */
  path: string;
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Discover all vLLM-compatible LoRA adapters in a user's profile
 *
 * Scans the adapters directory for directories containing safetensors files.
 * Returns adapters sorted by date (newest first).
 *
 * @param profileOutPath - Path to user's out directory (e.g., profiles/greggles/out)
 * @returns Array of discovered adapters
 */
export async function discoverVllmLoraAdapters(
  profileOutPath: string
): Promise<VllmLoraAdapter[]> {
  const adaptersDir = path.join(profileOutPath, 'adapters');

  if (!fs.existsSync(adaptersDir)) {
    return [];
  }

  const adapters: VllmLoraAdapter[] = [];

  try {
    // List date directories (e.g., 2025-12-04)
    const dateDirs = fs.readdirSync(adaptersDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
      .map(d => d.name);

    for (const dateDir of dateDirs) {
      const datePath = path.join(adaptersDir, dateDir);

      // List timestamp directories within date (e.g., 2025-12-04-004433-5a4ffd)
      const timestampDirs = fs.readdirSync(datePath, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const timestampDir of timestampDirs) {
        const adapterBasePath = path.join(datePath, timestampDir.name);
        const adapterPath = path.join(adapterBasePath, 'adapter');

        // Check if this has safetensors format (vLLM compatible)
        const validation = await validateVllmLoraAdapter(adapterPath);

        if (validation.hasSafetensors) {
          // Generate a unique name from the date/timestamp
          const name = `${dateDir}`;  // Use just the date for simplicity

          adapters.push({
            name,
            path: adapterPath,
            createdAt: dateDir,
            valid: validation.valid,
            loaded: false,  // Will be updated when comparing with vLLM
            baseModel: validation.baseModel,
            loraRank: validation.loraRank,
            sizeBytes: validation.sizeBytes,
          });
        }
      }
    }
  } catch (error) {
    console.error('[vllm-lora] Error discovering adapters:', error);
  }

  // Sort by date (newest first) and deduplicate by name
  const seen = new Set<string>();
  return adapters
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter(a => {
      if (seen.has(a.name)) return false;
      seen.add(a.name);
      return true;
    });
}

/**
 * Validate a LoRA adapter directory for vLLM compatibility
 *
 * vLLM requires safetensors format with adapter_config.json
 */
export async function validateVllmLoraAdapter(adapterPath: string): Promise<{
  valid: boolean;
  hasSafetensors: boolean;
  hasConfig: boolean;
  baseModel?: string;
  loraRank?: number;
  sizeBytes?: number;
  error?: string;
}> {
  const safetensorsPath = path.join(adapterPath, 'adapter_model.safetensors');
  const configPath = path.join(adapterPath, 'adapter_config.json');

  const hasSafetensors = fs.existsSync(safetensorsPath);
  const hasConfig = fs.existsSync(configPath);

  if (!hasSafetensors) {
    return { valid: false, hasSafetensors: false, hasConfig };
  }

  let baseModel: string | undefined;
  let loraRank: number | undefined;
  let sizeBytes: number | undefined;

  // Get file size
  try {
    const stats = fs.statSync(safetensorsPath);
    sizeBytes = stats.size;
  } catch { /* ignore */ }

  // Parse adapter config
  if (hasConfig) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      baseModel = config.base_model_name_or_path;
      loraRank = config.r;
    } catch (error) {
      console.warn('[vllm-lora] Failed to parse adapter_config.json:', error);
    }
  }

  return {
    valid: hasSafetensors && hasConfig,
    hasSafetensors,
    hasConfig,
    baseModel,
    loraRank,
    sizeBytes,
  };
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get vLLM LoRA configuration from user's models.json
 *
 * @param profileEtcPath - Path to user's etc directory
 * @returns LoRA configuration
 */
export function getVllmLoraConfig(profileEtcPath: string): VllmLoraConfig {
  const modelsPath = path.join(profileEtcPath, 'models.json');

  const defaultConfig: VllmLoraConfig = {
    enabledAdapters: [],
    maxLoraRank: 64,
  };

  if (!fs.existsSync(modelsPath)) {
    return defaultConfig;
  }

  try {
    const content = fs.readFileSync(modelsPath, 'utf-8');
    const models = JSON.parse(content);
    return {
      enabledAdapters: models.vllmLora?.enabledAdapters ?? [],
      maxLoraRank: models.vllmLora?.maxLoraRank ?? 64,
    };
  } catch (error) {
    console.error('[vllm-lora] Failed to read LoRA config:', error);
    return defaultConfig;
  }
}

/**
 * Save vLLM LoRA configuration to user's models.json
 *
 * @param profileEtcPath - Path to user's etc directory
 * @param config - LoRA configuration to save
 */
export function saveVllmLoraConfig(
  profileEtcPath: string,
  config: VllmLoraConfig,
  actor: string = 'system'
): void {
  const modelsPath = path.join(profileEtcPath, 'models.json');

  let models: Record<string, unknown> = {};

  if (fs.existsSync(modelsPath)) {
    try {
      const content = fs.readFileSync(modelsPath, 'utf-8');
      models = JSON.parse(content);
    } catch { /* start fresh */ }
  }

  models.vllmLora = {
    enabledAdapters: config.enabledAdapters,
    maxLoraRank: config.maxLoraRank,
  };

  fs.writeFileSync(modelsPath, JSON.stringify(models, null, 2));

  audit({
    level: 'info',
    category: 'data_change',
    event: 'vllm_lora_config_updated',
    actor,
    details: { config },
  });
}

/**
 * Add a LoRA adapter to the enabled list
 *
 * @param profileEtcPath - Path to user's etc directory
 * @param adapterName - Name of adapter to enable
 * @returns true if adapter was added (wasn't already enabled)
 */
export function enableVllmLoraAdapter(
  profileEtcPath: string,
  adapterName: string,
  actor: string = 'system'
): boolean {
  const config = getVllmLoraConfig(profileEtcPath);

  if (config.enabledAdapters.includes(adapterName)) {
    return false;  // Already enabled
  }

  config.enabledAdapters.push(adapterName);
  saveVllmLoraConfig(profileEtcPath, config, actor);
  return true;
}

/**
 * Remove a LoRA adapter from the enabled list
 *
 * @param profileEtcPath - Path to user's etc directory
 * @param adapterName - Name of adapter to disable
 * @returns true if adapter was removed
 */
export function disableVllmLoraAdapter(
  profileEtcPath: string,
  adapterName: string,
  actor: string = 'system'
): boolean {
  const config = getVllmLoraConfig(profileEtcPath);
  const index = config.enabledAdapters.indexOf(adapterName);

  if (index === -1) {
    return false;  // Wasn't enabled
  }

  config.enabledAdapters.splice(index, 1);
  saveVllmLoraConfig(profileEtcPath, config, actor);
  return true;
}

// ============================================================================
// vLLM Integration
// ============================================================================

/**
 * Build the --lora-modules argument for vLLM startup
 *
 * Format: name1=path1 name2=path2
 *
 * @param adapters - Array of adapters to load
 * @returns Formatted argument string, or empty string if no adapters
 */
export function buildLoraModulesArg(adapters: VllmLoraModule[]): string {
  if (!adapters.length) {
    return '';
  }

  return adapters
    .map(a => `${a.name}=${a.path}`)
    .join(' ');
}

/**
 * Get adapters to load at vLLM startup
 *
 * Combines enabled adapters from config with discovered adapters,
 * filtering to only valid adapters.
 *
 * @param profileOutPath - Path to user's out directory
 * @param profileEtcPath - Path to user's etc directory
 * @returns Array of LoRA modules ready for vLLM
 */
export async function getAdaptersToLoad(
  profileOutPath: string,
  profileEtcPath: string
): Promise<VllmLoraModule[]> {
  const config = getVllmLoraConfig(profileEtcPath);
  const discovered = await discoverVllmLoraAdapters(profileOutPath);

  // Filter to only enabled and valid adapters
  return discovered
    .filter(a => config.enabledAdapters.includes(a.name) && a.valid)
    .map(a => ({ name: a.name, path: a.path }));
}

/**
 * Check if a LoRA adapter needs to be loaded
 *
 * Compares the enabled config against currently loaded adapters.
 *
 * @param profileEtcPath - Path to user's etc directory
 * @param loadedAdapters - Names of currently loaded adapters (from vLLM)
 * @returns true if restart needed to load new adapters
 */
export function needsRestartForLora(
  profileEtcPath: string,
  loadedAdapters: string[]
): boolean {
  const config = getVllmLoraConfig(profileEtcPath);

  // Check if any enabled adapter is not loaded
  for (const name of config.enabledAdapters) {
    if (!loadedAdapters.includes(name)) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Format adapter size for display
 */
export function formatAdapterSize(sizeBytes: number | undefined): string {
  if (!sizeBytes) return 'unknown';

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Get a summary of adapter info for logging/display
 */
export function getAdapterSummary(adapter: VllmLoraAdapter): string {
  const parts = [adapter.name];
  if (adapter.baseModel) {
    parts.push(`base: ${adapter.baseModel}`);
  }
  if (adapter.loraRank) {
    parts.push(`rank: ${adapter.loraRank}`);
  }
  if (adapter.sizeBytes) {
    parts.push(`size: ${formatAdapterSize(adapter.sizeBytes)}`);
  }
  return parts.join(', ');
}

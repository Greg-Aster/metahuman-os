import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './path-builder.js';
import { storageClient } from './storage-client.js';
import { audit } from './audit.js';
import type { CognitiveModeId } from './cognitive-mode.js';
import type { TrustLevel } from './skills.js';

export interface TrustCouplingConfig {
  version: string;
  description: string;
  coupled: boolean;
  mappings: Record<CognitiveModeId, TrustLevel>;
  description_text: Record<CognitiveModeId, string>;
}

// Use storage router for user-specific config, fallback to system etc
function getCouplingConfigPath(): string {
  const result = storageClient.resolvePath({
    category: 'config',
    subcategory: 'etc',
    relativePath: 'trust-coupling.json',
  });
  return result.success && result.path ? result.path : path.join(systemPaths.etc, 'trust-coupling.json');
}

/**
 * Load trust coupling configuration
 */
export function loadTrustCoupling(): TrustCouplingConfig {
  const COUPLING_CONFIG_PATH = getCouplingConfigPath();
  if (!fs.existsSync(COUPLING_CONFIG_PATH)) {
    const fallback: TrustCouplingConfig = {
      version: '1.0.0',
      description: 'Trust level coupling with cognitive modes',
      coupled: true,
      mappings: {
        dual: 'supervised_auto',
        agent: 'suggest',
        emulation: 'observe',
      },
      description_text: {
        dual: 'Full cognitive mirroring with supervised autonomy',
        agent: 'Assistant mode with suggestion-based trust',
        emulation: 'Read-only demonstration mode with observe-only trust',
      },
    };
    fs.writeFileSync(COUPLING_CONFIG_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }

  try {
    const raw = fs.readFileSync(COUPLING_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as TrustCouplingConfig;
  } catch (error) {
    console.error('[trust-coupling] Failed to parse config, using defaults:', error);
    const fallback: TrustCouplingConfig = {
      version: '1.0.0',
      description: 'Trust level coupling with cognitive modes',
      coupled: true,
      mappings: {
        dual: 'supervised_auto',
        agent: 'suggest',
        emulation: 'observe',
      },
      description_text: {
        dual: 'Full cognitive mirroring with supervised autonomy',
        agent: 'Assistant mode with suggestion-based trust',
        emulation: 'Read-only demonstration mode with observe-only trust',
      },
    };
    fs.writeFileSync(COUPLING_CONFIG_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }
}

/**
 * Save trust coupling configuration
 */
export function saveTrustCoupling(config: TrustCouplingConfig, actor: string = 'system'): void {
  const COUPLING_CONFIG_PATH = getCouplingConfigPath();
  fs.writeFileSync(COUPLING_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');

  audit({
    level: 'info',
    category: 'security',
    event: 'trust_coupling_changed',
    actor,
    details: {
      coupled: config.coupled,
      mappings: config.mappings,
    },
  });
}

/**
 * Check if trust level is coupled to cognitive mode
 */
export function isCoupled(): boolean {
  const config = loadTrustCoupling();
  return config.coupled;
}

/**
 * Toggle coupling state
 */
export function toggleCoupling(actor: string = 'system'): boolean {
  const config = loadTrustCoupling();
  config.coupled = !config.coupled;
  saveTrustCoupling(config, actor);

  audit({
    level: 'info',
    category: 'security',
    event: 'trust_coupling_toggled',
    actor,
    details: {
      coupled: config.coupled,
    },
  });

  return config.coupled;
}

/**
 * Get the mapped trust level for a cognitive mode
 */
export function getMappedTrustLevel(mode: CognitiveModeId): TrustLevel {
  const config = loadTrustCoupling();
  return config.mappings[mode];
}

/**
 * Update the trust level mapping for a cognitive mode
 */
export function setMappedTrustLevel(
  mode: CognitiveModeId,
  trustLevel: TrustLevel,
  actor: string = 'system'
): void {
  const config = loadTrustCoupling();
  config.mappings[mode] = trustLevel;
  saveTrustCoupling(config, actor);
}

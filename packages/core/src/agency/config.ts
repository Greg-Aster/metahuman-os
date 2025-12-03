/**
 * Agency Configuration
 *
 * Loads and manages agency configuration from etc/agency.json
 * with user-specific overrides from profile storage.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  AgencyConfig,
  DesireSource,
  DesireSourceConfig,
} from './types.js';
import { DESIRE_SOURCE_WEIGHTS } from './types.js';
import { loadAgencyConfig as loadUserConfig } from './storage.js';

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Find the repository root.
 */
function findRepoRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  const fsRoot = path.parse(dir).root;
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === fsRoot) break;
    dir = parent;
  }
  return process.env.METAHUMAN_ROOT || path.join(process.env.HOME || '/home', 'metahuman');
}

const REPO_ROOT = findRepoRoot();
const SYSTEM_CONFIG_PATH = path.join(REPO_ROOT, 'etc', 'agency.json');

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Generate default source configurations from weights.
 */
function getDefaultSourceConfigs(): Record<DesireSource, DesireSourceConfig> {
  const sources: Record<DesireSource, DesireSourceConfig> = {} as Record<DesireSource, DesireSourceConfig>;

  for (const [source, weight] of Object.entries(DESIRE_SOURCE_WEIGHTS)) {
    sources[source as DesireSource] = {
      enabled: true,
      weight,
    };
  }

  return sources;
}

/**
 * Default agency configuration.
 */
export const DEFAULT_AGENCY_CONFIG: AgencyConfig = {
  enabled: true,
  mode: 'supervised',

  thresholds: {
    activation: 0.7,
    autoApprove: 0.85,
    decay: {
      enabled: true,
      ratePerHour: 0.02,
      minStrength: 0.1,
      reinforcementBoost: 0.15,
    },
  },

  sources: getDefaultSourceConfigs(),

  scheduling: {
    generatorIntervalMinutes: 30,
    evaluatorIntervalMinutes: 15,
    decayIntervalMinutes: 60,
    idleOnly: true,
  },

  limits: {
    maxActiveDesires: 10,
    maxPendingDesires: 50,
    maxDailyExecutions: 20,
    retentionDays: {
      completed: 90,
      rejected: 30,
      abandoned: 7,
    },
  },

  riskPolicy: {
    autoApproveRisk: ['none', 'low'],
    requireApprovalRisk: ['medium', 'high', 'critical'],
    blockRisk: ['critical'],
  },

  logging: {
    verbose: true,
    logToTerminal: true,
    logToInnerDialogue: true,
  },
};

// ============================================================================
// Configuration Loading
// ============================================================================

/** Cached system config */
let systemConfigCache: AgencyConfig | null = null;
let systemConfigMtime: number = 0;

/**
 * Load system configuration from etc/agency.json.
 */
export function loadSystemConfig(): AgencyConfig {
  try {
    // Check if file has changed
    const stats = fs.statSync(SYSTEM_CONFIG_PATH);
    if (systemConfigCache && stats.mtimeMs === systemConfigMtime) {
      return systemConfigCache;
    }

    const content = fs.readFileSync(SYSTEM_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(content) as Partial<AgencyConfig>;

    // Merge with defaults
    systemConfigCache = mergeConfig(DEFAULT_AGENCY_CONFIG, parsed);
    systemConfigMtime = stats.mtimeMs;

    return systemConfigCache;
  } catch (error) {
    // File doesn't exist or is invalid - return defaults
    return DEFAULT_AGENCY_CONFIG;
  }
}

/**
 * Load configuration for a specific user.
 * Merges system config with user overrides.
 */
export async function loadConfig(username?: string): Promise<AgencyConfig> {
  const systemConfig = loadSystemConfig();

  if (!username) {
    return systemConfig;
  }

  const userConfig = await loadUserConfig(username);
  if (!userConfig) {
    return systemConfig;
  }

  // Merge user overrides with system config
  return mergeConfig(systemConfig, userConfig);
}

/**
 * Deep merge two configurations.
 */
function mergeConfig(base: AgencyConfig, override: Partial<AgencyConfig>): AgencyConfig {
  const result = { ...base };

  if (override.enabled !== undefined) result.enabled = override.enabled;
  if (override.mode !== undefined) result.mode = override.mode;

  if (override.thresholds) {
    result.thresholds = {
      ...result.thresholds,
      ...override.thresholds,
      decay: {
        ...result.thresholds.decay,
        ...(override.thresholds.decay || {}),
      },
    };
  }

  if (override.sources) {
    result.sources = {
      ...result.sources,
      ...override.sources,
    };
  }

  if (override.scheduling) {
    result.scheduling = {
      ...result.scheduling,
      ...override.scheduling,
    };
  }

  if (override.limits) {
    result.limits = {
      ...result.limits,
      ...override.limits,
      retentionDays: {
        ...result.limits.retentionDays,
        ...(override.limits.retentionDays || {}),
      },
    };
  }

  if (override.riskPolicy) {
    result.riskPolicy = {
      ...result.riskPolicy,
      ...override.riskPolicy,
    };
  }

  if (override.logging) {
    result.logging = {
      ...result.logging,
      ...override.logging,
    };
  }

  return result;
}

// ============================================================================
// Configuration Validation
// ============================================================================

/**
 * Validate agency configuration.
 */
export function validateConfig(config: AgencyConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate thresholds
  if (config.thresholds.activation < 0 || config.thresholds.activation > 1) {
    errors.push('activation threshold must be between 0 and 1');
  }
  if (config.thresholds.autoApprove < 0 || config.thresholds.autoApprove > 1) {
    errors.push('autoApprove threshold must be between 0 and 1');
  }
  if (config.thresholds.activation > config.thresholds.autoApprove) {
    errors.push('activation threshold should be less than or equal to autoApprove');
  }

  // Validate decay
  if (config.thresholds.decay.ratePerHour < 0 || config.thresholds.decay.ratePerHour > 1) {
    errors.push('decay rate must be between 0 and 1');
  }
  if (config.thresholds.decay.minStrength < 0 || config.thresholds.decay.minStrength > 1) {
    errors.push('minimum strength must be between 0 and 1');
  }

  // Validate source weights
  for (const [source, sourceConfig] of Object.entries(config.sources)) {
    if (sourceConfig.weight < 0 || sourceConfig.weight > 1) {
      errors.push(`source ${source} weight must be between 0 and 1`);
    }
  }

  // Validate scheduling
  if (config.scheduling.generatorIntervalMinutes < 1) {
    errors.push('generator interval must be at least 1 minute');
  }
  if (config.scheduling.evaluatorIntervalMinutes < 1) {
    errors.push('evaluator interval must be at least 1 minute');
  }

  // Validate limits
  if (config.limits.maxActiveDesires < 1) {
    errors.push('maxActiveDesires must be at least 1');
  }
  if (config.limits.maxPendingDesires < 1) {
    errors.push('maxPendingDesires must be at least 1');
  }
  if (config.limits.maxDailyExecutions < 0) {
    errors.push('maxDailyExecutions must be non-negative');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Configuration Helpers
// ============================================================================

/**
 * Check if agency is enabled.
 */
export async function isAgencyEnabled(username?: string): Promise<boolean> {
  const config = await loadConfig(username);
  return config.enabled && config.mode !== 'off';
}

/**
 * Get the weight for a desire source.
 */
export async function getSourceWeight(source: DesireSource, username?: string): Promise<number> {
  const config = await loadConfig(username);
  const sourceConfig = config.sources[source];
  return sourceConfig?.enabled ? sourceConfig.weight : 0;
}

/**
 * Check if a source is enabled.
 */
export async function isSourceEnabled(source: DesireSource, username?: string): Promise<boolean> {
  const config = await loadConfig(username);
  return config.sources[source]?.enabled ?? false;
}

/**
 * Get enabled sources.
 */
export async function getEnabledSources(username?: string): Promise<DesireSource[]> {
  const config = await loadConfig(username);
  return Object.entries(config.sources)
    .filter(([, cfg]) => cfg.enabled)
    .map(([source]) => source as DesireSource);
}

/**
 * Check if a risk level can be auto-approved.
 */
export async function canAutoApprove(
  risk: string,
  strength: number,
  username?: string
): Promise<boolean> {
  const config = await loadConfig(username);

  // Check mode
  if (config.mode !== 'autonomous') {
    return false;
  }

  // Check strength threshold
  if (strength < config.thresholds.autoApprove) {
    return false;
  }

  // Check risk policy
  return config.riskPolicy.autoApproveRisk.includes(risk as typeof config.riskPolicy.autoApproveRisk[number]);
}

/**
 * Check if a risk level is blocked.
 */
export async function isRiskBlocked(risk: string, username?: string): Promise<boolean> {
  const config = await loadConfig(username);
  return config.riskPolicy.blockRisk.includes(risk as typeof config.riskPolicy.blockRisk[number]);
}

/**
 * Get scheduling interval in milliseconds.
 */
export async function getSchedulingInterval(
  type: 'generator' | 'evaluator' | 'decay',
  username?: string
): Promise<number> {
  const config = await loadConfig(username);

  switch (type) {
    case 'generator':
      return config.scheduling.generatorIntervalMinutes * 60 * 1000;
    case 'evaluator':
      return config.scheduling.evaluatorIntervalMinutes * 60 * 1000;
    case 'decay':
      return config.scheduling.decayIntervalMinutes * 60 * 1000;
    default:
      return 30 * 60 * 1000; // 30 minutes default
  }
}

/**
 * Get the path to the system config file.
 */
export function getSystemConfigPath(): string {
  return SYSTEM_CONFIG_PATH;
}

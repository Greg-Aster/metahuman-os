/**
 * Persistence for Active Operator policy configuration.
 *
 * Executable work and in-progress recovery live only in packages/core/src/queue.
 * This module persists autonomy policy configuration and nothing else.
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../paths.js';
import type { ActiveOperatorConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

const CONFIG_FILE = path.join(systemPaths.etc, 'active-operator.json');

function normalizeConfig(loaded: Partial<ActiveOperatorConfig>): ActiveOperatorConfig {
  return {
    autonomyMode: ['reactive', 'semi', 'full'].includes(loaded.autonomyMode || '')
      ? loaded.autonomyMode!
      : DEFAULT_CONFIG.autonomyMode,
    cooldownMs: Math.max(5_000, Number(loaded.cooldownMs ?? DEFAULT_CONFIG.cooldownMs)),
    maxConsecutiveTasks: Math.max(1, Number(loaded.maxConsecutiveTasks ?? DEFAULT_CONFIG.maxConsecutiveTasks)),
    maxEvaluationsPerHour: Math.max(1, Number(loaded.maxEvaluationsPerHour ?? DEFAULT_CONFIG.maxEvaluationsPerHour)),
    userPresenceCooldownMs: Math.max(0, Number(loaded.userPresenceCooldownMs ?? DEFAULT_CONFIG.userPresenceCooldownMs)),
  };
}

export function loadConfig(): ActiveOperatorConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch (error) {
    console.error('[active-operator] Failed to load config:', error);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: ActiveOperatorConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function updateConfig(updates: Partial<ActiveOperatorConfig>): ActiveOperatorConfig {
  const current = loadConfig();
  const updated = normalizeConfig({
    ...current,
    ...updates,
  });
  saveConfig(updated);
  return updated;
}

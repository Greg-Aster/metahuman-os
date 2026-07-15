import type { AutonomyMode } from '../queue/types.js';

/** Configuration for bounded autonomy admission above the work coordinator. */
export interface ActiveOperatorConfig {
  autonomyMode: AutonomyMode;
  cooldownMs: number;
  maxConsecutiveTasks: number;
  maxEvaluationsPerHour: number;
  userPresenceCooldownMs: number;
}

export const DEFAULT_CONFIG: ActiveOperatorConfig = {
  autonomyMode: 'reactive',
  cooldownMs: 30_000,
  maxConsecutiveTasks: 5,
  maxEvaluationsPerHour: 12,
  userPresenceCooldownMs: 60_000,
};

export type OperatorMode = AutonomyMode;

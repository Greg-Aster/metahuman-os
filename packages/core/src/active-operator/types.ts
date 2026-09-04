import type { AutonomyMode } from '../queue/types.js';

/** Configuration for autonomy mode and Robot Operator Full-mode pacing. */
export interface ActiveOperatorConfig {
  autonomyMode: AutonomyMode;
  cooldownMs: number;
}

export const DEFAULT_CONFIG: ActiveOperatorConfig = {
  autonomyMode: 'reactive',
  cooldownMs: 30_000,
};

export type OperatorMode = AutonomyMode;

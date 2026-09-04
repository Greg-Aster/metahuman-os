import type { AutonomyMode } from '../queue/types.js';

/** Configuration for the active autonomy mode. */
export interface ActiveOperatorConfig {
  autonomyMode: AutonomyMode;
}

export const DEFAULT_CONFIG: ActiveOperatorConfig = {
  autonomyMode: 'reactive',
};

export type OperatorMode = AutonomyMode;

import type { AutonomyMode } from '../queue/types.js';

/** Configuration for the active autonomy mode. */
export interface ActiveOperatorConfig {
  autonomyMode: AutonomyMode;
  semiInactivityMinutes: number;
}

export const DEFAULT_CONFIG: ActiveOperatorConfig = {
  autonomyMode: 'reactive',
  semiInactivityMinutes: 5,
};

export type OperatorMode = AutonomyMode;

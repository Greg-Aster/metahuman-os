export type AutonomyMode = 'reactive' | 'semi' | 'full';

export interface AutonomyModeDefinition {
  id: AutonomyMode;
  label: string;
  badge: 'R' | 'S' | 'F';
  description: string;
  buttonClass: string;
}

export const AUTONOMY_MODES: AutonomyModeDefinition[] = [
  {
    id: 'reactive',
    label: 'Reactive',
    badge: 'R',
    description: 'Active Operator is dormant; user requests and configured reactive events remain available.',
    buttonClass: 'reactive',
  },
  {
    id: 'semi',
    label: 'Semi-autonomous',
    badge: 'S',
    description: 'Active Operator requests each operation updated to 100% activation.',
    buttonClass: 'semi',
  },
  {
    id: 'full',
    label: 'Fully autonomous',
    badge: 'F',
    description: 'Active Operator requests the highest returned activation, even below 100%.',
    buttonClass: 'full',
  },
];

export function autonomyModeDefinition(mode: AutonomyMode): AutonomyModeDefinition {
  return AUTONOMY_MODES.find(candidate => candidate.id === mode) ?? AUTONOMY_MODES[0];
}

export function nextAutonomyMode(mode: AutonomyMode): AutonomyMode {
  if (mode === 'reactive') return 'semi';
  if (mode === 'semi') return 'full';
  return 'reactive';
}

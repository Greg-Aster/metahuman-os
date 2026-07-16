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
    description: 'Configured timers remain visible but proactive admissions are suppressed.',
    buttonClass: 'reactive',
  },
  {
    id: 'semi',
    label: 'Semi-autonomous',
    badge: 'S',
    description: 'Eligible configured triggers may add bounded, low-priority work.',
    buttonClass: 'semi',
  },
  {
    id: 'full',
    label: 'Fully autonomous',
    badge: 'F',
    description: 'Configured triggers and the bounded Active Operator policy may propose work.',
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

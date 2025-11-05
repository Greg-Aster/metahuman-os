/**
 * Environment Configuration
 *
 * Handles environment variable-based system configuration
 * including security triggers and operational modes.
 */

/**
 * System trigger configuration from environment variables
 */
export interface SystemTriggers {
  wetwareDeceased: boolean; // Disables dual consciousness mode
  highSecurity: boolean; // Locks system to emulation mode only
}

/**
 * Check if wetware deceased trigger is active
 *
 * When enabled, dual consciousness mode is disabled (grayed out in UI).
 * This represents the scenario where the biological counterpart is deceased,
 * and the digital consciousness operates independently.
 *
 * Environment Variable: WETWARE_DECEASED=true
 */
export function isWetwareDeceased(): boolean {
  return process.env.WETWARE_DECEASED === 'true';
}

/**
 * Check if high security mode is active
 *
 * When enabled, only emulation mode is allowed (other modes grayed out).
 * This provides maximum security by preventing any write operations
 * or autonomous actions.
 *
 * Environment Variable: HIGH_SECURITY=true
 */
export function isHighSecurity(): boolean {
  return process.env.HIGH_SECURITY === 'true';
}

/**
 * Get all active system triggers
 */
export function getSystemTriggers(): SystemTriggers {
  return {
    wetwareDeceased: isWetwareDeceased(),
    highSecurity: isHighSecurity(),
  };
}

/**
 * Get allowed cognitive modes based on system triggers
 *
 * Returns array of mode IDs that are currently allowed.
 */
export function getAllowedCognitiveModes(): ('dual' | 'agent' | 'emulation')[] {
  const triggers = getSystemTriggers();

  // High security: only emulation mode
  if (triggers.highSecurity) {
    return ['emulation'];
  }

  // Wetware deceased: agent and emulation only (no dual consciousness)
  if (triggers.wetwareDeceased) {
    return ['agent', 'emulation'];
  }

  // Normal: all modes available
  return ['dual', 'agent', 'emulation'];
}

/**
 * Check if a specific cognitive mode is allowed
 */
export function isModeAllowed(mode: 'dual' | 'agent' | 'emulation'): boolean {
  return getAllowedCognitiveModes().includes(mode);
}

/**
 * Get reason why a mode is disabled (for UI tooltips)
 */
export function getModeDisabledReason(
  mode: 'dual' | 'agent' | 'emulation'
): string | null {
  if (isModeAllowed(mode)) {
    return null;
  }

  const triggers = getSystemTriggers();

  if (triggers.highSecurity) {
    return 'High security mode: Only emulation mode is allowed';
  }

  if (triggers.wetwareDeceased && mode === 'dual') {
    return 'Wetware deceased: Dual consciousness mode unavailable';
  }

  return 'This mode is currently disabled';
}

/**
 * Get system status summary
 */
export function getSystemStatus(): {
  triggers: SystemTriggers;
  allowedModes: ('dual' | 'agent' | 'emulation')[];
  disabledModes: ('dual' | 'agent' | 'emulation')[];
  status: 'normal' | 'wetware_deceased' | 'high_security';
} {
  const triggers = getSystemTriggers();
  const allowedModes = getAllowedCognitiveModes();
  const allModes: ('dual' | 'agent' | 'emulation')[] = [
    'dual',
    'agent',
    'emulation',
  ];
  const disabledModes = allModes.filter((mode) => !allowedModes.includes(mode));

  let status: 'normal' | 'wetware_deceased' | 'high_security' = 'normal';
  if (triggers.highSecurity) {
    status = 'high_security';
  } else if (triggers.wetwareDeceased) {
    status = 'wetware_deceased';
  }

  return {
    triggers,
    allowedModes,
    disabledModes,
    status,
  };
}

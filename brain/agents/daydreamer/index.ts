/**
 * Daydreamer Agent — Entry Point
 *
 * Lighter version of dreamer that can run during waking hours.
 * Generates short, whimsical inner musings from memory fragments.
 */

export {
  run,
  runCycle,
  generateUserDaydream,
  type DaydreamerOptions,
  type DaydreamerResult,
  type UserDaydreamerStats,
} from './core.js';

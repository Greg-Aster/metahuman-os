/**
 * Active Operator Service
 *
 * @deprecated This module is deprecated. Use the service manager from @metahuman/core instead:
 *
 * ```typescript
 * import {
 *   startActiveOperatorService,
 *   stopActiveOperatorService,
 *   getActiveOperatorServiceStatus,
 *   enqueueUserMessage,
 * } from '@metahuman/core';
 * ```
 *
 * The canonical implementation is in packages/core/src/active-operator/service-manager.ts
 */

// Re-export from core package for backwards compatibility
export {
  startActiveOperatorService,
  stopActiveOperatorService,
  getActiveOperatorServiceStatus,
  enqueueUserMessage,
} from '../../packages/core/src/active-operator/service-manager.js';

// Backwards-compatible aliases
import { getActiveOperatorServiceStatus } from '../../packages/core/src/active-operator/service-manager.js';

/**
 * @deprecated Use getActiveOperatorServiceStatus instead
 */
export function getActiveOperatorStatus() {
  return getActiveOperatorServiceStatus();
}

/**
 * @deprecated Use getActiveOperatorServiceStatus().isRunning instead
 */
export function isActiveOperatorRunning(): boolean {
  return getActiveOperatorServiceStatus().isRunning;
}

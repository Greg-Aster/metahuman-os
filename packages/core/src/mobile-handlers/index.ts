/**
 * Mobile API Handlers
 *
 * Re-exports the unified API mobile adapter for nodejs-mobile.
 *
 * The unified API layer provides a single codebase that works for both:
 * - Web (Astro API routes)
 * - Mobile (nodejs-mobile message bridge)
 *
 * All handlers are now implemented in packages/core/src/api/handlers/
 * and routed through the unified router.
 */

// Re-export the unified API mobile adapter
export { handleMobileRequest } from '../api/adapters/mobile.js';
export type { MobileRequest, MobileResponse } from '../api/adapters/mobile.js';

// Re-export route listing for debugging
export { listRoutes } from '../api/router.js';

// Legacy exports for backward compatibility
// These will be deprecated in favor of the unified API
export type { MobileUserContext } from './types.js';
export { successResponse, errorResponse } from './types.js';

// Mobile agents register in-process executors with the core coordinator.
export {
  initializeMobileAgents,
  stopMobileAgents,
  type MobileAgentContext,
  type MobileAgentPriority,
  type MobileAgentRegistration,
} from './mobile-agents.js';

// Local model service (Transformers.js) lifecycle management
export { startLocalModelService, stopLocalModelService } from '../local-model-service-manager.js';

/**
 * Brain-owned mobile handler bundle entry.
 *
 * Re-exports the core mobile API adapter and concrete brain agent
 * registrations without making packages/core import brain modules.
 */

export {
  handleMobileRequest,
  listRoutes,
  successResponse,
  errorResponse,
  startLocalModelService,
  stopLocalModelService,
} from '@metahuman/core/mobile-handlers';

export type {
  MobileRequest,
  MobileResponse,
  MobileUserContext,
  MobileAgentContext,
  MobileAgentRegistration,
} from '@metahuman/core/mobile-handlers';

export {
  registerMobileAgents,
  initializeMobileAgents,
  stopMobileAgents,
  runOrganizer,
  runIngestor,
  runReflector,
  runDreamer,
  runCuriosity,
  runInnerCuriosity,
  runDigest,
  runProfileSync,
  runDesireGenerator,
  runDesirePlanner,
  runDesireExecutor,
  runDesireReviewer,
} from './mobile-agents.js';

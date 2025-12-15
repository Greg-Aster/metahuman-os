/**
 * @metahuman/agent-runtime
 *
 * Universal agent runtime for MetaHuman OS.
 * Works on both web (process-based) and mobile (in-process).
 *
 * Usage:
 *   import { getRuntime, registerAgent } from '@metahuman/agent-runtime';
 *
 *   // Register agents (typically at startup)
 *   registerAgent(profileSyncAgent);
 *   registerAgent(organizerAgent);
 *
 *   // Run an agent
 *   const runtime = getRuntime(ROOT);
 *   const result = await runtime.run('profile-sync', ctx, input);
 */

// Types
export type {
  AgentContext,
  AgentInput,
  AgentResult,
  AgentMeta,
  AgentRunFn,
  AgentModule,
  RunOptions,
  ResultEnvelope,
} from './types.js';

// Registry
export {
  registerAgent,
  getAgent,
  hasAgent,
  getAgentIds,
  getAllAgents,
  getAgentMetas,
  unregisterAgent,
  clearRegistry,
  getAgentsByTag,
  getLLMAgents,
  getAgentsByPriority,
} from './registry.js';

// Runtime
export {
  AgentRuntime,
  getRuntime,
  resetRuntime,
} from './runtime.js';

// Loader
export {
  loadAgents,
  loadAgent,
  discoverAgentDirectories,
  getAvailableAgentIds,
} from './loader.js';

// Executors (for advanced usage)
export type { Executor } from './executors/interface.js';
export { DEFAULT_TIMEOUT, errorResult, timeoutResult, withTimeout } from './executors/interface.js';
export { MobileInProcExecutor, getMobileExecutor } from './executors/mobile-inproc.js';
export { WebProcessExecutor, getWebExecutor } from './executors/web-process.js';

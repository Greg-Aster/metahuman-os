/**
 * Node Executors - Main Export
 * Provides backward compatibility by re-exporting everything from category files
 */

// Re-export types
export type { NodeExecutionContext, NodeExecutor } from './types.js';

// Re-export all executors from category files
export * from './input-executors.js';
export * from './context-executors.js';
export * from './routing-executors.js';
export * from './operator-executors.js';
export * from './llm-executors.js';
export * from './safety-executors.js';
export * from './output-executors.js';
export * from './control-flow-executors.js';
export * from './data-executors.js';
export * from './scratchpad-executors.js';
export * from './emulation-executors.js';
export * from './skill-executors.js';
export * from './agent-executors.js';
export * from './persona-executors.js';
export * from './curiosity-executors.js';

// Re-export registry functions and main registry
export { nodeExecutors, registerPluginExecutor, unregisterPluginExecutor, getNodeExecutor, hasRealImplementation } from './registry.js';

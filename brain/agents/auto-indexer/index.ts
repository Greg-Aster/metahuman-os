/**
 * Auto-Indexer Agent
 *
 * Automatically rebuilds vector indexes for semantic search.
 * Runs nightly or on-demand via CLI/scheduler.
 */

export { runCycle, rebuildIndex, processUserIndex, run } from './core.js';
export type { AutoIndexerOptions, AutoIndexerResult, IndexRebuildResult } from './core.js';

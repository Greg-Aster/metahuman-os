/**
 * @metahuman/server
 *
 * Server deployment components for MetaHuman OS.
 * This package is OPTIONAL - individual users running locally don't need it.
 *
 * Provides:
 * - Cloud GPU providers (RunPod Serverless, HuggingFace Inference)
 * - Request queuing for scaling (Redis-based)
 * - Cold start handling and progress reporting
 * - Multi-user storage utilities
 *
 * Usage:
 * 1. Install: pnpm add @metahuman/server (from workspace)
 * 2. Set DEPLOYMENT_MODE=server in environment
 * 3. Configure etc/deployment.json with server settings
 *
 * The main @metahuman/core package dynamically imports this when in server mode.
 */

// Provider Bridge - Single entry point for core to call server providers
export * from './provider-bridge.js';

// Providers - Cloud GPU inference (low-level, use bridge instead)
export * from './providers/index.js';

// Queue - Request queuing for scaling
export * from './queue/index.js';

// Scaling - Cold start handling, metrics
export * from './scaling/index.js';

// Storage - Network volume utilities
export * from './storage/index.js';

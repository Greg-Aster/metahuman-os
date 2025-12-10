/**
 * Unified API Layer
 *
 * Framework-agnostic API that works for both web and mobile.
 *
 * Usage:
 *
 * ```typescript
 * import { routeRequest } from '@metahuman/core/api';
 *
 * // In your adapter (Astro, mobile, etc.):
 * const response = await routeRequest({
 *   path: '/api/tasks',
 *   method: 'GET',
 *   user: { userId: '...', username: '...', role: 'owner', isAuthenticated: true },
 * });
 * ```
 */

// Types
export * from './types.js';

// Router
export { routeRequest, registerRoute, listRoutes } from './router.js';

// Adapters - export for convenient imports
export { astroHandler } from './adapters/astro.js';
export { handleHttpRequest } from './adapters/http.js';

// Handlers (for direct use if needed)
export * from './handlers/index.js';

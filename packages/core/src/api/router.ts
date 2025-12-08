/**
 * Unified API Router
 *
 * Routes requests to handlers based on path and method.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type {
  UnifiedRequest,
  UnifiedResponse,
  UnifiedHandler,
  RouteDefinition,
} from './types.js';
import {
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from './types.js';

// Import handlers (will be populated as we migrate routes)
// For now, start with a few proof-of-concept routes
import { handleStatus, handleBoot } from './handlers/system.js';
import { handleCapture, handleListMemories, handleSearchMemories } from './handlers/memories.js';
import { handleListTasks, handleCreateTask, handleUpdateTask, handleDeleteTask } from './handlers/tasks.js';
import { handleGetMe, handleLogin, handleLogout, handleListUsers, handleSyncUser } from './handlers/auth.js';
import { handleGetPersona, handleGetPersonaSummary } from './handlers/persona.js';
import { handleGetCognitiveMode, handleSetCognitiveMode } from './handlers/cognitive-mode.js';
import { handleGetBuffer, handleAppendBuffer, handleClearBuffer } from './handlers/conversation.js';
import {
  handleChat,
  handleClearChat,
  handleGetUsage,
  handleListProviders,
  handleSetProvider,
  handleSaveCredentials,
  handleDeleteCredentials,
} from './handlers/chat.js';
import {
  handleGetStatus as handleGetSystemCoderStatus,
  handleCaptureError,
  handleListErrors,
  handleGetError,
  handleIgnoreError,
  handleRequestFix,
  handleSubmitRequest,
  handleListRequests,
  handleGetRequest,
  handleUpdateRequest,
  handleListFixes,
  handleGetFix,
  handleApproveFix,
  handleRejectFix,
  handleApplyFix,
  handleRevertFix,
  handleGetMaintenanceStatus,
  handleRunMaintenance,
  handleGetMaintenanceReport,
  handleListMaintenanceReports,
} from './handlers/system-coder.js';

// ============================================================================
// Route Registry
// ============================================================================

const routes: RouteDefinition[] = [
  // System
  { method: 'GET', pattern: '/api/status', handler: handleStatus },
  { method: 'GET', pattern: '/api/boot', handler: handleBoot },

  // Auth
  { method: 'GET', pattern: '/api/auth/me', handler: handleGetMe },
  { method: 'POST', pattern: '/api/auth/login', handler: handleLogin },
  { method: 'POST', pattern: '/api/auth/logout', handler: handleLogout },
  { method: 'GET', pattern: '/api/auth/users', handler: handleListUsers },
  { method: 'GET', pattern: '/api/profile-sync/user', handler: handleSyncUser, requiresAuth: true },

  // Memories
  { method: 'POST', pattern: '/api/capture', handler: handleCapture, requiresAuth: true },
  { method: 'GET', pattern: '/api/memories', handler: handleListMemories, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/memories\/search/, handler: handleSearchMemories, requiresAuth: true },

  // Tasks
  { method: 'GET', pattern: '/api/tasks', handler: handleListTasks, requiresAuth: true },
  { method: 'POST', pattern: '/api/tasks', handler: handleCreateTask, requiresAuth: true },
  { method: ['PUT', 'PATCH'], pattern: /^\/api\/tasks\/[^\/]+$/, handler: handleUpdateTask, requiresAuth: true },
  { method: 'DELETE', pattern: /^\/api\/tasks\/[^\/]+$/, handler: handleDeleteTask, requiresAuth: true },

  // Persona
  { method: 'GET', pattern: '/api/persona', handler: handleGetPersona, requiresAuth: true },
  { method: 'GET', pattern: '/api/persona/summary', handler: handleGetPersonaSummary },

  // Cognitive Mode
  { method: 'GET', pattern: '/api/cognitive-mode', handler: handleGetCognitiveMode },
  { method: 'POST', pattern: '/api/cognitive-mode', handler: handleSetCognitiveMode, requiresAuth: true, guard: 'owner' },

  // Conversation Buffer
  { method: 'GET', pattern: /^\/api\/conversation-buffer/, handler: handleGetBuffer },
  { method: 'POST', pattern: '/api/conversation-buffer', handler: handleAppendBuffer, requiresAuth: true },
  { method: 'DELETE', pattern: /^\/api\/conversation-buffer/, handler: handleClearBuffer, requiresAuth: true },

  // Chat (mobile/offline mode - uses cloud providers directly)
  { method: 'POST', pattern: '/api/chat', handler: handleChat, requiresAuth: true },
  { method: 'DELETE', pattern: '/api/chat', handler: handleClearChat, requiresAuth: true },
  { method: 'GET', pattern: '/api/chat/usage', handler: handleGetUsage, requiresAuth: true },
  { method: 'GET', pattern: '/api/chat/providers', handler: handleListProviders, requiresAuth: true },
  { method: 'PUT', pattern: '/api/chat/provider', handler: handleSetProvider, requiresAuth: true },
  { method: 'POST', pattern: '/api/chat/credentials', handler: handleSaveCredentials, requiresAuth: true },
  { method: 'DELETE', pattern: '/api/chat/credentials', handler: handleDeleteCredentials, requiresAuth: true },

  // System Coder
  { method: 'GET', pattern: '/api/system-coder/status', handler: handleGetSystemCoderStatus, requiresAuth: true },
  { method: 'POST', pattern: '/api/system-coder/capture-error', handler: handleCaptureError, requiresAuth: true },
  { method: 'GET', pattern: '/api/system-coder/errors', handler: handleListErrors, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/system-coder\/errors\/[^\/]+$/, handler: handleGetError, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/errors\/[^\/]+\/ignore$/, handler: handleIgnoreError, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/errors\/[^\/]+\/fix$/, handler: handleRequestFix, requiresAuth: true },
  { method: 'POST', pattern: '/api/system-coder/request', handler: handleSubmitRequest, requiresAuth: true },
  { method: 'GET', pattern: '/api/system-coder/requests', handler: handleListRequests, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/system-coder\/requests\/[^\/]+$/, handler: handleGetRequest, requiresAuth: true },
  { method: 'PUT', pattern: /^\/api\/system-coder\/requests\/[^\/]+$/, handler: handleUpdateRequest, requiresAuth: true },

  // System Coder - Fixes
  { method: 'GET', pattern: '/api/system-coder/fixes', handler: handleListFixes, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/system-coder\/fixes\/[^\/]+$/, handler: handleGetFix, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/fixes\/[^\/]+\/approve$/, handler: handleApproveFix, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/fixes\/[^\/]+\/reject$/, handler: handleRejectFix, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/fixes\/[^\/]+\/apply$/, handler: handleApplyFix, requiresAuth: true },
  { method: 'POST', pattern: /^\/api\/system-coder\/fixes\/[^\/]+\/revert$/, handler: handleRevertFix, requiresAuth: true },

  // System Coder - Maintenance
  { method: 'GET', pattern: '/api/system-coder/maintenance/status', handler: handleGetMaintenanceStatus, requiresAuth: true },
  { method: 'POST', pattern: '/api/system-coder/maintenance/run', handler: handleRunMaintenance, requiresAuth: true },
  { method: 'GET', pattern: '/api/system-coder/maintenance/report', handler: handleGetMaintenanceReport, requiresAuth: true },
  { method: 'GET', pattern: '/api/system-coder/maintenance/reports', handler: handleListMaintenanceReports, requiresAuth: true },
];

// ============================================================================
// Route Matching
// ============================================================================

/**
 * Match a request to a route definition
 */
function matchRoute(method: string, path: string): RouteDefinition | null {
  // Normalize path (remove query string, trailing slash)
  const normalizedPath = path.split('?')[0].replace(/\/$/, '') || '/';

  for (const route of routes) {
    // Check method
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.includes(method)) continue;

    // Check pattern
    if (typeof route.pattern === 'string') {
      if (normalizedPath === route.pattern) {
        return route;
      }
    } else if (route.pattern instanceof RegExp) {
      if (route.pattern.test(normalizedPath)) {
        return route;
      }
    }
  }

  return null;
}

/**
 * Extract path parameters from a path (e.g., /api/tasks/task-123 -> { id: 'task-123' })
 */
function extractPathParams(path: string, pattern: string | RegExp): Record<string, string> {
  const params: Record<string, string> = {};

  // For regex patterns, extract the last path segment as 'id' by convention
  if (pattern instanceof RegExp) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 2) {
      params.id = segments[segments.length - 1];
    }
  }

  return params;
}

/**
 * Parse query string from path
 */
function parseQuery(path: string): Record<string, string> {
  const queryString = path.split('?')[1];
  if (!queryString) return {};

  const params: Record<string, string> = {};
  for (const param of queryString.split('&')) {
    const [key, value] = param.split('=');
    if (key) {
      params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
    }
  }
  return params;
}

// ============================================================================
// Security Guards
// ============================================================================

/**
 * Check if user passes the security guard
 */
function checkGuard(guard: string | undefined, user: UnifiedRequest['user']): boolean {
  if (!guard) return true;

  switch (guard) {
    case 'owner':
      return user.role === 'owner';
    case 'writeMode':
      // TODO: Check cognitive mode from config
      return user.isAuthenticated;
    case 'operatorMode':
      return user.role === 'owner';
    default:
      return true;
  }
}

// ============================================================================
// Main Router
// ============================================================================

/**
 * Route a request to the appropriate handler
 *
 * This is the main entry point - adapters call this with a UnifiedRequest
 */
export async function routeRequest(req: UnifiedRequest): Promise<UnifiedResponse> {
  // Find matching route
  const route = matchRoute(req.method, req.path);

  if (!route) {
    return notFoundResponse(`Route not found: ${req.method} ${req.path}`);
  }

  // Check authentication
  if (route.requiresAuth && !req.user.isAuthenticated) {
    return unauthorizedResponse();
  }

  // Check security guard
  if (!checkGuard(route.guard, req.user)) {
    return forbiddenResponse('Insufficient permissions');
  }

  // Extract path params and merge with existing
  const pathParams = extractPathParams(req.path, route.pattern);
  const query = { ...parseQuery(req.path), ...req.query };

  // Create enriched request
  const enrichedReq: UnifiedRequest = {
    ...req,
    params: { ...req.params, ...pathParams },
    query,
  };

  // Execute handler
  try {
    return await route.handler(enrichedReq);
  } catch (error) {
    console.error(`[router] Handler error for ${req.method} ${req.path}:`, error);
    return {
      status: 500,
      error: (error as Error).message || 'Internal server error',
    };
  }
}

/**
 * Register a new route dynamically
 */
export function registerRoute(route: RouteDefinition): void {
  routes.push(route);
}

/**
 * List all registered routes (for debugging)
 */
export function listRoutes(): Array<{ method: string | string[]; pattern: string }> {
  return routes.map(r => ({
    method: r.method,
    pattern: typeof r.pattern === 'string' ? r.pattern : r.pattern.source,
  }));
}

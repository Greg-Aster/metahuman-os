/**
 * Mobile Request Router
 *
 * Routes incoming mobile bridge requests to appropriate handlers
 */

import type { MobileRequest, MobileResponse, MobileUserContext, RouteDefinition } from './types.js';
import { errorResponse } from './types.js';
import { resolveUserFromToken } from './auth.js';
import { handleGetMe } from './auth.js';
import { handleCapture, handleListMemories, handleSearchMemories } from './memories.js';
import { handleGetBuffer, handleAppendBuffer, handleClearBuffer } from './conversation.js';
import { handleGetPersona, handleGetCognitiveMode, handleGetPersonaSummary } from './persona.js';
import { handleListTasks, handleCreateTask, handleUpdateTask, handleDeleteTask } from './tasks.js';

/**
 * Route definitions
 */
const routes: RouteDefinition[] = [
  // Auth
  { method: 'GET', pattern: '/api/auth/me', handler: handleGetMe },

  // Memories
  { method: 'POST', pattern: '/api/capture', handler: handleCapture, requiresAuth: true },
  { method: 'GET', pattern: '/api/memories', handler: handleListMemories, requiresAuth: true },
  { method: 'GET', pattern: /^\/api\/memories\/search/, handler: handleSearchMemories, requiresAuth: true },

  // Conversation buffer
  { method: 'GET', pattern: /^\/api\/conversation-buffer/, handler: handleGetBuffer },
  { method: 'POST', pattern: '/api/conversation-buffer', handler: handleAppendBuffer, requiresAuth: true },
  { method: 'DELETE', pattern: /^\/api\/conversation-buffer/, handler: handleClearBuffer, requiresAuth: true },

  // Persona
  { method: 'GET', pattern: '/api/persona', handler: handleGetPersona, requiresAuth: true },
  { method: 'GET', pattern: '/api/persona/summary', handler: handleGetPersonaSummary },
  { method: 'GET', pattern: '/api/cognitive-mode', handler: handleGetCognitiveMode },

  // Tasks
  { method: 'GET', pattern: '/api/tasks', handler: handleListTasks, requiresAuth: true },
  { method: 'POST', pattern: '/api/tasks', handler: handleCreateTask, requiresAuth: true },
  { method: 'PUT', pattern: /^\/api\/tasks\/[^\/]+$/, handler: handleUpdateTask, requiresAuth: true },
  { method: 'DELETE', pattern: /^\/api\/tasks\/[^\/]+$/, handler: handleDeleteTask, requiresAuth: true },
];

/**
 * Match a request to a route
 */
function matchRoute(method: string, path: string): RouteDefinition | null {
  // Normalize path (remove query string)
  const pathWithoutQuery = path.split('?')[0];

  for (const route of routes) {
    if (route.method !== method) continue;

    if (typeof route.pattern === 'string') {
      if (pathWithoutQuery === route.pattern) {
        return route;
      }
    } else if (route.pattern instanceof RegExp) {
      if (route.pattern.test(pathWithoutQuery)) {
        return route;
      }
    }
  }

  return null;
}

/**
 * Handle an incoming mobile request
 *
 * This is the main entry point for the mobile Node.js backend.
 * It resolves the user from the session token and routes to the appropriate handler.
 */
export async function handleMobileRequest(request: MobileRequest): Promise<MobileResponse> {
  try {
    // Resolve user from session token
    const user = resolveUserFromToken(request.sessionToken);

    // Find matching route
    const route = matchRoute(request.method, request.path);

    if (!route) {
      return errorResponse(request.id, 404, `Route not found: ${request.method} ${request.path}`);
    }

    // Check authentication requirement
    if (route.requiresAuth && !user.isAuthenticated) {
      return errorResponse(request.id, 401, 'Authentication required');
    }

    // Execute handler
    return await route.handler(request, user);
  } catch (error) {
    console.error('[mobile-router] Request failed:', error);
    return errorResponse(request.id, 500, (error as Error).message || 'Internal server error');
  }
}

/**
 * List all available routes (for debugging)
 */
export function listRoutes(): Array<{ method: string; pattern: string }> {
  return routes.map(r => ({
    method: r.method,
    pattern: typeof r.pattern === 'string' ? r.pattern : r.pattern.source,
  }));
}

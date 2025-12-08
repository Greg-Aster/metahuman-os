/**
 * Mobile Adapter
 *
 * Converts mobile message bridge requests to unified API format.
 * Used by nodejs-mobile main.js.
 */

import { routeRequest } from '../router.js';
import type { UnifiedRequest, UnifiedResponse, UnifiedUser } from '../types.js';
import { validateSession } from '../../sessions.js';
import { getUser } from '../../users.js';

/**
 * Mobile request from cordova-bridge
 */
export interface MobileRequest {
  id: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
  headers?: Record<string, string>;
  sessionToken?: string;
}

/**
 * Mobile response for cordova-bridge
 */
export interface MobileResponse {
  id: string;
  status: number;
  data?: any;
  error?: string;
}

/**
 * Resolve user from session token
 */
function resolveUser(sessionToken?: string): UnifiedUser {
  if (!sessionToken) {
    return {
      userId: 'anonymous',
      username: 'anonymous',
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  const session = validateSession(sessionToken);
  if (!session) {
    return {
      userId: 'anonymous',
      username: 'anonymous',
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  // Handle anonymous sessions
  if (session.role === 'anonymous') {
    return {
      userId: session.userId,
      username: 'anonymous',
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  // Get authenticated user
  const user = getUser(session.userId);
  if (!user) {
    return {
      userId: 'anonymous',
      username: 'anonymous',
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  return {
    userId: user.id,
    username: user.username,
    role: user.role as 'owner' | 'guest' | 'anonymous',
    isAuthenticated: true,
  };
}

/**
 * Parse query string from path
 */
function parseQueryFromPath(path: string): Record<string, string> {
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

/**
 * Handle a mobile request
 *
 * This is the main entry point for nodejs-mobile.
 * It converts the mobile message format to UnifiedRequest,
 * routes to the handler, and converts back to MobileResponse.
 */
export async function handleMobileRequest(msg: MobileRequest): Promise<MobileResponse> {
  // Resolve user from session token
  const user = resolveUser(msg.sessionToken);

  // Convert to unified request
  const unifiedReq: UnifiedRequest = {
    path: msg.path,
    method: msg.method,
    body: msg.body,
    query: parseQueryFromPath(msg.path),
    headers: msg.headers || {},
    user,
  };

  // Route to handler
  const unifiedRes = await routeRequest(unifiedReq);

  // Convert to mobile response
  return {
    id: msg.id,
    status: unifiedRes.status,
    data: unifiedRes.data,
    error: unifiedRes.error,
  };
}

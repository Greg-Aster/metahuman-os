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
 * Auth required error - indicates user must be redirected to auth gate
 */
export class MobileAuthRequiredError extends Error {
  constructor(message: string = 'Authentication required - redirect to auth gate') {
    super(message);
    this.name = 'MobileAuthRequiredError';
  }
}

/**
 * Resolve user from session token
 *
 * NO ANONYMOUS USERS - throws MobileAuthRequiredError if no valid session
 */
function resolveUser(sessionToken?: string): UnifiedUser {
  if (!sessionToken) {
    throw new MobileAuthRequiredError('No session token provided');
  }

  const session = validateSession(sessionToken);
  if (!session) {
    throw new MobileAuthRequiredError('Invalid or expired session');
  }

  // Get authenticated user
  const user = getUser(session.userId);
  if (!user) {
    throw new MobileAuthRequiredError('User not found');
  }

  return {
    userId: user.id,
    username: user.username,
    role: user.role as 'owner' | 'standard' | 'guest',
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
 *
 * If user is not authenticated, returns 401 with redirect hint.
 */
export async function handleMobileRequest(msg: MobileRequest): Promise<MobileResponse> {
  // Resolve user from session token - may throw MobileAuthRequiredError
  let user: UnifiedUser;
  try {
    user = resolveUser(msg.sessionToken);
  } catch (error) {
    if (error instanceof MobileAuthRequiredError) {
      return {
        id: msg.id,
        status: 401,
        error: 'Authentication required',
        data: {
          redirect: '/auth',
          message: 'Please login to continue',
        },
      };
    }
    throw error;
  }

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

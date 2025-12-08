/**
 * Unified API Types
 *
 * Framework-agnostic request/response types that work for both:
 * - Web (Astro API routes via HTTP)
 * - Mobile (nodejs-mobile via message bridge)
 *
 * This is the foundation of the unified API layer - ONE codebase for all platforms.
 */

/**
 * User context resolved by the adapter before calling handlers
 */
export interface UnifiedUser {
  userId: string;
  username: string;
  role: 'owner' | 'guest' | 'anonymous';
  isAuthenticated: boolean;
}

/**
 * Framework-agnostic request
 * Adapters convert their native format to this before calling handlers
 */
export interface UnifiedRequest {
  /** Request path (e.g., '/api/capture') */
  path: string;

  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  /** Request body (parsed JSON) */
  body?: any;

  /** Query parameters */
  query?: Record<string, string>;

  /** Request headers */
  headers?: Record<string, string>;

  /** User context (resolved by adapter) */
  user: UnifiedUser;

  /** Path parameters for dynamic routes (e.g., { id: 'task-123' }) */
  params?: Record<string, string>;

  /** Abort signal for cancellable operations */
  signal?: AbortSignal;

  /** Custom metadata from adapter (e.g., cognitive mode) */
  metadata?: Record<string, any>;
}

/**
 * Framework-agnostic response
 * Handlers return this, adapters convert to their native format
 */
export interface UnifiedResponse {
  /** HTTP status code */
  status: number;

  /** Response data (will be JSON serialized) */
  data?: any;

  /** Error message (mutually exclusive with data for errors) */
  error?: string;

  /** Response headers */
  headers?: Record<string, string>;

  /** For streaming responses (SSE) */
  stream?: AsyncIterable<string>;

  /** Cookie operations (for auth) */
  cookies?: CookieOperation[];
}

/**
 * Cookie operation for setting/deleting cookies
 */
export interface CookieOperation {
  action: 'set' | 'delete';
  name: string;
  value?: string;
  options?: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
    path?: string;
    maxAge?: number;
  };
}

/**
 * Unified handler function signature
 * All API handlers implement this - pure functions, no framework dependencies
 */
export type UnifiedHandler = (req: UnifiedRequest) => Promise<UnifiedResponse>;

/**
 * Route definition for the router
 */
export interface RouteDefinition {
  /** HTTP method(s) this route handles */
  method: string | string[];

  /** Path pattern (string for exact match, RegExp for patterns) */
  pattern: string | RegExp;

  /** Handler function */
  handler: UnifiedHandler;

  /** Whether this route requires authentication */
  requiresAuth?: boolean;

  /** Security guard (e.g., 'owner', 'writeMode', 'operatorMode') */
  guard?: 'owner' | 'writeMode' | 'operatorMode';
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Create a success response
 */
export function successResponse(data: any, status = 200): UnifiedResponse {
  return { status, data };
}

/**
 * Create an error response
 */
export function errorResponse(error: string, status = 500): UnifiedResponse {
  return { status, error };
}

/**
 * Create a 401 unauthorized response
 */
export function unauthorizedResponse(message = 'Authentication required'): UnifiedResponse {
  return { status: 401, error: message };
}

/**
 * Create a 403 forbidden response
 */
export function forbiddenResponse(message = 'Forbidden'): UnifiedResponse {
  return { status: 403, error: message };
}

/**
 * Create a 404 not found response
 */
export function notFoundResponse(message = 'Not found'): UnifiedResponse {
  return { status: 404, error: message };
}

/**
 * Create a 400 bad request response
 */
export function badRequestResponse(message = 'Bad request'): UnifiedResponse {
  return { status: 400, error: message };
}

/**
 * Create a streaming response (for SSE)
 */
export function streamResponse(stream: AsyncIterable<string>): UnifiedResponse {
  return {
    status: 200,
    stream,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  };
}

/**
 * Create a response that sets a cookie
 */
export function responseWithCookie(
  data: any,
  cookie: Omit<CookieOperation, 'action'> & { action?: 'set' }
): UnifiedResponse {
  return {
    status: 200,
    data,
    cookies: [{ action: 'set', ...cookie }],
  };
}

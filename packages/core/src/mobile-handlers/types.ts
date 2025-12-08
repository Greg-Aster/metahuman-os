/**
 * Mobile Handler Types
 *
 * Framework-agnostic request/response types for mobile handlers
 */

/**
 * Standardized request from mobile bridge
 */
export interface MobileRequest {
  id: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
  /** Session token (passed instead of cookies on mobile) */
  sessionToken?: string;
}

/**
 * Standardized response to mobile bridge
 */
export interface MobileResponse {
  id: string;
  status: number;
  data?: any;
  error?: string;
}

/**
 * User context resolved from session
 */
export interface MobileUserContext {
  userId: string;
  username: string;
  role: 'owner' | 'guest' | 'anonymous';
  isAuthenticated: boolean;
}

/**
 * Handler function signature
 */
export type MobileHandler = (
  request: MobileRequest,
  user: MobileUserContext
) => Promise<MobileResponse>;

/**
 * Route definition
 */
export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  pattern: string | RegExp;
  handler: MobileHandler;
  requiresAuth?: boolean;
}

/**
 * Create a success response
 */
export function successResponse(id: string, data: any): MobileResponse {
  return { id, status: 200, data };
}

/**
 * Create an error response
 */
export function errorResponse(id: string, status: number, error: string): MobileResponse {
  return { id, status, error };
}

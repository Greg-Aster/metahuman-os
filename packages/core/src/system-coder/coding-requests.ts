/**
 * System Coder - Coding Request Service
 *
 * Manages user-submitted coding requests (features, fixes, refactors, etc.)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { audit } from '../audit.js';
import { generateUUID } from '../uuid.js';
import { getProfilePaths } from '../path-builder.js';
import type {
  CodingRequest,
  CodingRequestSubmission,
  CodingRequestStatus,
  CodingRequestType,
} from './types.js';

// ============================================================================
// Path Helpers
// ============================================================================

function getSystemCoderDir(username: string): string {
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.state, 'system-coder');
}

function getRequestsDir(username: string): string {
  return path.join(getSystemCoderDir(username), 'requests');
}

/**
 * Ensure the requests directory exists
 */
function ensureRequestsDir(username: string): void {
  const dir = getRequestsDir(username);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Coding Request API
// ============================================================================

/**
 * Create a new coding request
 */
export function createCodingRequest(
  username: string,
  submission: CodingRequestSubmission
): CodingRequest {
  ensureRequestsDir(username);

  const timestamp = new Date().toISOString();
  const id = `req-${timestamp.replace(/[:.]/g, '-')}-${generateUUID().substring(0, 8)}`;

  const request: CodingRequest = {
    id,
    timestamp,
    type: submission.type,
    description: submission.description,
    context: submission.context,
    files: submission.files,
    status: 'pending',
    createdBy: username,
  };

  // Save to disk
  const requestPath = path.join(getRequestsDir(username), `${id}.json`);
  fs.writeFileSync(requestPath, JSON.stringify(request, null, 2));

  // Audit
  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_request_created',
    details: {
      requestId: id,
      type: request.type,
      descriptionPreview: request.description.substring(0, 100),
    },
    actor: username,
    userId: username,
  });

  return request;
}

/**
 * List coding requests with optional filtering
 */
export function listCodingRequests(
  username: string,
  options: {
    status?: CodingRequestStatus | CodingRequestStatus[];
    type?: CodingRequestType | CodingRequestType[];
    limit?: number;
    offset?: number;
  } = {}
): { requests: CodingRequest[]; total: number } {
  const requestsDir = getRequestsDir(username);

  if (!fs.existsSync(requestsDir)) {
    return { requests: [], total: 0 };
  }

  // Load all requests
  const files = fs.readdirSync(requestsDir).filter((f) => f.endsWith('.json'));
  let requests: CodingRequest[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(requestsDir, file), 'utf-8');
      requests.push(JSON.parse(content));
    } catch {
      // Skip malformed files
    }
  }

  // Sort by timestamp (newest first)
  requests.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply filters
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    requests = requests.filter((r) => statuses.includes(r.status));
  }

  if (options.type) {
    const types = Array.isArray(options.type) ? options.type : [options.type];
    requests = requests.filter((r) => types.includes(r.type));
  }

  const total = requests.length;

  // Apply pagination
  const offset = options.offset || 0;
  const limit = options.limit || 50;
  requests = requests.slice(offset, offset + limit);

  return { requests, total };
}

/**
 * Get a specific coding request by ID
 */
export function getCodingRequest(username: string, requestId: string): CodingRequest | null {
  const requestPath = path.join(getRequestsDir(username), `${requestId}.json`);

  if (!fs.existsSync(requestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Update coding request status
 */
export function updateCodingRequestStatus(
  username: string,
  requestId: string,
  status: CodingRequestStatus,
  result?: string
): boolean {
  const request = getCodingRequest(username, requestId);
  if (!request) {
    return false;
  }

  request.status = status;
  request.updatedAt = new Date().toISOString();
  if (result !== undefined) {
    request.result = result;
  }

  const requestPath = path.join(getRequestsDir(username), `${requestId}.json`);
  fs.writeFileSync(requestPath, JSON.stringify(request, null, 2));

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_request_updated',
    details: { requestId, status, result: result?.substring(0, 100) },
    actor: 'system-coder',
    userId: username,
  });

  return true;
}

/**
 * Delete a coding request
 */
export function deleteCodingRequest(username: string, requestId: string): boolean {
  const requestPath = path.join(getRequestsDir(username), `${requestId}.json`);

  if (!fs.existsSync(requestPath)) {
    return false;
  }

  fs.unlinkSync(requestPath);

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_request_deleted',
    details: { requestId },
    actor: username,
    userId: username,
  });

  return true;
}

// ============================================================================
// Exports
// ============================================================================

export { getRequestsDir };

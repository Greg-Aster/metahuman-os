/**
 * System Coder Handlers
 *
 * Unified handlers for system coder functionality:
 * - Error capture and management
 * - Coding requests
 * - Status and health
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, badRequestResponse, notFoundResponse } from '../types.js';
import {
  captureError,
  listErrors,
  getError,
  updateErrorStatus,
  getErrorStats,
  createCodingRequest,
  listCodingRequests,
  getCodingRequest,
  updateCodingRequestStatus,
  listFixes,
  getFix,
  updateFixStatus,
  applyFix,
  revertFix,
  getFixStats,
  generateFixForError,
  runMaintenance,
  getMaintenanceStatus,
  getLastReport,
  listReports,
  type CodingRequestSubmission,
  type CheckType,
} from '../../system-coder/index.js';

// ============================================================================
// Status Handlers
// ============================================================================

/**
 * GET /api/system-coder/status - Get system coder status
 */
export async function handleGetStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;

  // Get error stats
  const errorStats = getErrorStats(username);

  // Calculate health based on new errors
  let health: 'green' | 'yellow' | 'red' = 'green';
  const newErrors = errorStats.byStatus?.new || 0;

  if (newErrors > 10) {
    health = 'red';
  } else if (newErrors > 0) {
    health = 'yellow';
  }

  // Get fix stats
  const fixStats = getFixStats(username);
  const fixesPending = fixStats.byStatus?.pending || 0;
  const fixesApplied = fixStats.byStatus?.applied || 0;

  return successResponse({
    enabled: true,
    health,
    stats: {
      errorsNew: newErrors,
      errorsTotal: errorStats.total,
      fixesPending,
      fixesApplied,
    },
  });
}

// ============================================================================
// Error Handlers
// ============================================================================

/**
 * POST /api/system-coder/capture-error - Capture an error
 */
export async function handleCaptureError(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const { source, message, stack, context, severity, tags } = req.body || {};

  if (!source || !message) {
    return badRequestResponse('Source and message are required');
  }

  const validSources = ['terminal', 'web_console', 'build', 'test', 'runtime'];
  if (!validSources.includes(source)) {
    return badRequestResponse(`Invalid source. Must be one of: ${validSources.join(', ')}`);
  }

  const error = captureError(username, {
    source,
    message,
    stack,
    context,
    severity,
    tags,
  });

  return successResponse({
    captured: error !== null,
    errorId: error?.id,
  });
}

/**
 * GET /api/system-coder/errors - List captured errors
 */
export async function handleListErrors(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const { status, source, severity, limit, offset, includeStats } = req.query || {};

  const result = listErrors(username, {
    status: status as any,
    source: source as any,
    severity: severity as any,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  });

  const response: any = {
    errors: result.errors,
    pagination: {
      total: result.total,
      offset: offset ? parseInt(offset, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 50,
    },
  };

  if (includeStats === 'true') {
    response.stats = getErrorStats(username);
  }

  return successResponse(response);
}

/**
 * GET /api/system-coder/errors/:id - Get a specific error
 */
export async function handleGetError(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const errorId = req.params?.id;

  if (!errorId) {
    return badRequestResponse('Error ID is required');
  }

  const error = getError(username, errorId);

  if (!error) {
    return notFoundResponse('Error not found');
  }

  return successResponse({ error });
}

/**
 * POST /api/system-coder/errors/:id/ignore - Mark error as ignored
 */
export async function handleIgnoreError(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const errorId = req.params?.id;

  if (!errorId) {
    return badRequestResponse('Error ID is required');
  }

  const success = updateErrorStatus(username, errorId, 'ignored');

  if (!success) {
    return notFoundResponse('Error not found');
  }

  return successResponse({ success: true });
}

/**
 * POST /api/system-coder/errors/:id/fix - Request fix for error
 */
export async function handleRequestFix(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const errorId = req.params?.id;

  if (!errorId) {
    return badRequestResponse('Error ID is required');
  }

  // Check error exists
  const error = getError(username, errorId);
  if (!error) {
    return notFoundResponse('Error not found');
  }

  // Trigger fix generation via Big Brother
  const result = await generateFixForError(username, errorId);

  if (!result.success) {
    return successResponse({
      success: false,
      error: result.error || 'Failed to generate fix',
    });
  }

  return successResponse({
    success: true,
    fixId: result.fix?.id,
  });
}

// ============================================================================
// Coding Request Handlers
// ============================================================================

/**
 * POST /api/system-coder/request - Submit a coding request
 */
export async function handleSubmitRequest(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const { type, description, context, files } = req.body || {};

  if (!type || !description) {
    return badRequestResponse('Type and description are required');
  }

  const validTypes = ['feature', 'fix', 'refactor', 'docs', 'review', 'other'];
  if (!validTypes.includes(type)) {
    return badRequestResponse(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
  }

  const submission: CodingRequestSubmission = {
    type,
    description,
    context,
    files,
  };

  const request = createCodingRequest(username, submission);

  return successResponse({
    success: true,
    requestId: request.id,
  });
}

/**
 * GET /api/system-coder/requests - List coding requests
 */
export async function handleListRequests(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const { status, type, limit, offset } = req.query || {};

  const result = listCodingRequests(username, {
    status: status as any,
    type: type as any,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  });

  return successResponse({
    requests: result.requests,
    pagination: {
      total: result.total,
      offset: offset ? parseInt(offset, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 50,
    },
  });
}

/**
 * GET /api/system-coder/requests/:id - Get a specific request
 */
export async function handleGetRequest(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const requestId = req.params?.id;

  if (!requestId) {
    return badRequestResponse('Request ID is required');
  }

  const request = getCodingRequest(username, requestId);

  if (!request) {
    return notFoundResponse('Request not found');
  }

  return successResponse({ request });
}

/**
 * PUT /api/system-coder/requests/:id - Update request status
 */
export async function handleUpdateRequest(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const requestId = req.params?.id;
  const { status, result } = req.body || {};

  if (!requestId) {
    return badRequestResponse('Request ID is required');
  }

  if (!status) {
    return badRequestResponse('Status is required');
  }

  const validStatuses = ['pending', 'processing', 'completed', 'failed'];
  if (!validStatuses.includes(status)) {
    return badRequestResponse(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  const success = updateCodingRequestStatus(username, requestId, status, result);

  if (!success) {
    return notFoundResponse('Request not found');
  }

  return successResponse({ success: true });
}

// ============================================================================
// Fix Handlers
// ============================================================================

/**
 * GET /api/system-coder/fixes - List fixes
 */
export async function handleListFixes(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const { status, errorId, limit, offset } = req.query || {};

  const result = listFixes(username, {
    status: status as any,
    errorId: errorId as string,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  });

  return successResponse({
    fixes: result.fixes,
    pagination: {
      total: result.total,
      offset: offset ? parseInt(offset, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 50,
    },
  });
}

/**
 * GET /api/system-coder/fixes/:id - Get a specific fix
 */
export async function handleGetFix(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const fixId = req.params?.id;

  if (!fixId) {
    return badRequestResponse('Fix ID is required');
  }

  const fix = getFix(username, fixId);

  if (!fix) {
    return notFoundResponse('Fix not found');
  }

  return successResponse({ fix });
}

/**
 * POST /api/system-coder/fixes/:id/approve - Approve a fix
 */
export async function handleApproveFix(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const fixId = req.params?.id;

  if (!fixId) {
    return badRequestResponse('Fix ID is required');
  }

  const success = updateFixStatus(username, fixId, 'approved', {
    approvedBy: username,
  });

  if (!success) {
    return notFoundResponse('Fix not found');
  }

  return successResponse({ success: true });
}

/**
 * POST /api/system-coder/fixes/:id/reject - Reject a fix
 */
export async function handleRejectFix(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const fixId = req.params?.id;
  const { reason } = req.body || {};

  if (!fixId) {
    return badRequestResponse('Fix ID is required');
  }

  const success = updateFixStatus(username, fixId, 'rejected', {
    rejectedBy: username,
    rejectionReason: reason,
  });

  if (!success) {
    return notFoundResponse('Fix not found');
  }

  return successResponse({ success: true });
}

/**
 * POST /api/system-coder/fixes/:id/apply - Apply an approved fix
 */
export async function handleApplyFix(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const fixId = req.params?.id;

  if (!fixId) {
    return badRequestResponse('Fix ID is required');
  }

  const result = applyFix(username, fixId);

  if (!result.success) {
    return successResponse({
      success: false,
      error: result.error,
    });
  }

  return successResponse({ success: true });
}

/**
 * POST /api/system-coder/fixes/:id/revert - Revert an applied fix
 */
export async function handleRevertFix(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const fixId = req.params?.id;

  if (!fixId) {
    return badRequestResponse('Fix ID is required');
  }

  const result = revertFix(username, fixId);

  if (!result.success) {
    return successResponse({
      success: false,
      error: result.error,
    });
  }

  return successResponse({ success: true });
}

// ============================================================================
// Maintenance Handlers
// ============================================================================

/**
 * GET /api/system-coder/maintenance/status - Get maintenance status
 */
export async function handleGetMaintenanceStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const status = getMaintenanceStatus(username);
  return successResponse(status);
}

/**
 * POST /api/system-coder/maintenance/run - Run maintenance checks
 */
export async function handleRunMaintenance(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const { checks } = req.body || {};

  // Validate check types if provided
  if (checks && Array.isArray(checks)) {
    const validChecks: CheckType[] = [
      'type_errors',
      'unused_exports',
      'deprecated_apis',
      'security_vulnerabilities',
      'documentation_drift',
      'dead_code',
    ];

    for (const check of checks) {
      if (!validChecks.includes(check)) {
        return badRequestResponse(`Invalid check type: ${check}. Valid types: ${validChecks.join(', ')}`);
      }
    }
  }

  try {
    const report = await runMaintenance(username, checks as CheckType[] | undefined);
    return successResponse({
      success: true,
      report,
    });
  } catch (error) {
    return successResponse({
      success: false,
      error: (error as Error).message,
    });
  }
}

/**
 * GET /api/system-coder/maintenance/report - Get last maintenance report
 */
export async function handleGetMaintenanceReport(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const report = getLastReport(username);

  if (!report) {
    return successResponse({
      report: null,
      message: 'No maintenance report available. Run maintenance first.',
    });
  }

  return successResponse({ report });
}

/**
 * GET /api/system-coder/maintenance/reports - List maintenance reports
 */
export async function handleListMaintenanceReports(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = req.user.username;
  const { limit } = req.query || {};

  const reports = listReports(username, {
    limit: limit ? parseInt(limit, 10) : 10,
  });

  return successResponse({
    reports,
    total: reports.length,
  });
}

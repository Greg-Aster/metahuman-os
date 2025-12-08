/**
 * System Coder Agent - Core Module
 *
 * Exports all system coder functionality for error capture,
 * fix management, and documentation maintenance.
 */

// Types
export * from './types.js';

// Error Capture
export {
  captureError,
  listErrors,
  getError,
  updateErrorStatus,
  deleteError,
  getErrorStats,
  isErrorMessage,
  detectSeverity,
  ensureSystemCoderDirs,
  getSystemCoderDir,
  getErrorsDir,
  getFixesDir,
  getMaintenanceDir,
  DEFAULT_ERROR_PATTERNS,
} from './error-capture.js';

// Coding Requests
export {
  createCodingRequest,
  listCodingRequests,
  getCodingRequest,
  updateCodingRequestStatus,
  deleteCodingRequest,
  getRequestsDir,
} from './coding-requests.js';

// Fix Management
export {
  createFix,
  listFixes,
  getFix,
  updateFixStatus,
  applyFix,
  revertFix,
  deleteFix,
  getFixStats,
} from './fix-management.js';

// Fix Generation
export {
  generateFixForError,
  generateFixesForErrors,
} from './fix-generator.js';

// Maintenance
export {
  runMaintenance,
  getMaintenanceStatus,
  getLastReport,
  listReports,
  type CheckType,
  type MaintenanceIssue,
  type MaintenanceReport,
} from './maintenance-runner.js';

/**
 * System Coder Agent - Type Definitions
 *
 * Types for error capture, fix management, and documentation maintenance.
 */

// ============================================================================
// Error Capture Types
// ============================================================================

export type ErrorSource = 'terminal' | 'web_console' | 'build' | 'test' | 'runtime';
export type ErrorSeverity = 'error' | 'warning' | 'critical';
export type ErrorStatus = 'new' | 'reviewing' | 'fixed' | 'ignored' | 'wont_fix';

export interface ErrorContext {
  file?: string;
  line?: number;
  column?: number;
  command?: string;
  output?: string;
  cwd?: string;
  environment?: Record<string, string>;
}

export interface CapturedError {
  id: string;
  timestamp: string;
  source: ErrorSource;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context: ErrorContext;
  status: ErrorStatus;
  fixId?: string;
  createdBy?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface ErrorCaptureRequest {
  source: ErrorSource;
  severity?: ErrorSeverity;
  message: string;
  stack?: string;
  context?: Partial<ErrorContext>;
  tags?: string[];
}

// ============================================================================
// Fix Types
// ============================================================================

export type FixStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed' | 'reverted';
export type FixRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface FileChange {
  filePath: string;
  originalContent?: string;
  newContent: string;
  patch?: string;
  changeType: 'create' | 'modify' | 'delete';
}

export interface ProposedFix {
  id: string;
  timestamp: string;
  errorId: string;
  status: FixStatus;
  risk: FixRisk;

  // Fix details
  title: string;
  explanation: string;
  changes: FileChange[];

  // Testing
  testCommands?: string[];
  testResults?: TestResult[];

  // Metadata
  generatedBy: 'big_brother' | 'local_llm' | 'manual';
  confidence: number; // 0-1

  // Lifecycle
  approvedBy?: string;
  approvedAt?: string;
  appliedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;

  // Rollback support
  backupPaths?: string[];
  canRevert: boolean;
  revertedAt?: string;
}

export interface TestResult {
  command: string;
  passed: boolean;
  output: string;
  duration: number;
  timestamp: string;
}

// ============================================================================
// Maintenance Types
// ============================================================================

export type MaintenanceCheckType =
  | 'type_errors'
  | 'unused_exports'
  | 'deprecated_apis'
  | 'security_vulnerabilities'
  | 'documentation_drift'
  | 'dead_code'
  | 'circular_dependencies'
  | 'missing_tests';

export interface MaintenanceIssue {
  id: string;
  checkType: MaintenanceCheckType;
  severity: ErrorSeverity;
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
  autoFixable: boolean;
}

export interface MaintenanceReport {
  id: string;
  timestamp: string;
  duration: number;
  scope: string[];
  checksRun: MaintenanceCheckType[];
  issues: MaintenanceIssue[];
  summary: {
    total: number;
    byType: Record<MaintenanceCheckType, number>;
    bySeverity: Record<ErrorSeverity, number>;
    autoFixable: number;
  };
  previousReportId?: string;
  fixesGenerated: string[];
}

// ============================================================================
// Documentation Types
// ============================================================================

export interface DocumentationDrift {
  file: string;
  driftType: 'missing' | 'outdated' | 'invalid_path' | 'undocumented_feature';
  description: string;
  actualValue?: string;
  documentedValue?: string;
  severity: 'info' | 'warning' | 'error';
}

export interface DocumentationSyncResult {
  timestamp: string;
  filesChecked: string[];
  driftsFound: DocumentationDrift[];
  autoFixed: number;
  requiresManualReview: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface SystemCoderConfig {
  enabled: boolean;
  mode: 'supervised' | 'autonomous';

  errorCapture: {
    enabled: boolean;
    autoCapture: boolean;
    patterns: string[];
    excludePatterns?: string[];
    maxErrorsPerHour?: number;
  };

  maintenance: {
    enabled: boolean;
    intervalHours: number;
    scope: string[];
    checks: MaintenanceCheckType[];
    excludePaths?: string[];
  };

  fixes: {
    autoStage: boolean;
    requireApproval: boolean;
    testBeforeApprove: boolean;
    maxPendingFixes: number;
    autoApproveRisk: FixRisk[];
  };

  documentation: {
    autoUpdate: boolean;
    targets: string[];
    systemInitPath: string;
  };

  notifications: {
    onErrorCapture: boolean;
    onFixReady: boolean;
    onMaintenanceComplete: boolean;
  };
}

// ============================================================================
// API Response Types
// ============================================================================

export interface SystemCoderStatus {
  enabled: boolean;
  mode: 'supervised' | 'autonomous';
  stats: {
    errorsTotal: number;
    errorsNew: number;
    fixesPending: number;
    fixesApplied: number;
    lastMaintenanceRun?: string;
    nextMaintenanceRun?: string;
  };
}

export interface ErrorListResponse {
  errors: CapturedError[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
  };
}

export interface FixListResponse {
  fixes: ProposedFix[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
  };
}

// ============================================================================
// Coding Request Types
// ============================================================================

export type CodingRequestType = 'feature' | 'fix' | 'refactor' | 'docs' | 'review' | 'other';
export type CodingRequestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface CodingRequest {
  id: string;
  timestamp: string;
  type: CodingRequestType;
  description: string;
  context?: string;
  files?: string[];
  status: CodingRequestStatus;
  result?: string;
  createdBy?: string;
  updatedAt?: string;
  errorId?: string; // Link to error if created from error
}

export interface CodingRequestSubmission {
  type: CodingRequestType;
  description: string;
  context?: string;
  files?: string[];
}

export interface CodingRequestListResponse {
  requests: CodingRequest[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
  };
}

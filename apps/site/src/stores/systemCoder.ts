/**
 * System Coder Store
 *
 * Manages state for the system coder dashboard:
 * - Health status (for status widget indicator)
 * - Captured errors list
 * - Pending fixes list
 * - Maintenance status
 */

import { writable, derived, get } from 'svelte/store';
import { apiFetch } from '../lib/client/api-config';

// ============================================================================
// Types
// ============================================================================

export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown' | 'loading';

export interface SystemCoderStatus {
  enabled: boolean;
  health: HealthStatus;
  stats: {
    errorsNew: number;
    errorsTotal: number;
    fixesPending: number;
    fixesApplied: number;
  };
  lastMaintenanceRun?: string;
}

export interface CapturedError {
  id: string;
  timestamp: string;
  source: 'terminal' | 'web_console' | 'build' | 'test' | 'runtime';
  severity: 'error' | 'warning' | 'critical';
  message: string;
  stack?: string;
  context: {
    file?: string;
    line?: number;
    command?: string;
    output?: string;
  };
  status: 'new' | 'reviewing' | 'fixed' | 'ignored' | 'wont_fix';
  fixId?: string;
}

export interface SystemCoderState {
  status: SystemCoderStatus | null;
  errors: CapturedError[];
  loading: boolean;
  error: string | null;
  lastFetch: number;
}

// ============================================================================
// Store
// ============================================================================

const initialState: SystemCoderState = {
  status: null,
  errors: [],
  loading: false,
  error: null,
  lastFetch: 0,
};

const store = writable<SystemCoderState>(initialState);

// Derived stores for convenience
export const systemCoderHealth = derived(store, ($store) => $store.status?.health ?? 'unknown');
export const systemCoderStats = derived(store, ($store) => $store.status?.stats);
export const systemCoderErrors = derived(store, ($store) => $store.errors);
export const systemCoderLoading = derived(store, ($store) => $store.loading);

// ============================================================================
// Actions
// ============================================================================

/**
 * Fetch system coder status (for status widget)
 */
export async function fetchStatus(): Promise<void> {
  try {
    const response = await apiFetch('/api/system-coder/status');
    if (!response.ok) {
      throw new Error('Failed to fetch status');
    }

    const status = await response.json();
    store.update((state) => ({
      ...state,
      status,
      lastFetch: Date.now(),
    }));
  } catch (error) {
    store.update((state) => ({
      ...state,
      error: (error as Error).message,
    }));
  }
}

/**
 * Fetch list of captured errors
 */
export async function fetchErrors(options: {
  status?: string;
  source?: string;
  severity?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<void> {
  store.update((state) => ({ ...state, loading: true, error: null }));

  try {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.source) params.set('source', options.source);
    if (options.severity) params.set('severity', options.severity);
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.offset) params.set('offset', options.offset.toString());
    params.set('includeStats', 'true');

    const response = await apiFetch(`/api/system-coder/errors?${params}`);
    if (!response.ok) {
      throw new Error('Failed to fetch errors');
    }

    const data = await response.json();
    store.update((state) => ({
      ...state,
      errors: data.errors,
      loading: false,
      lastFetch: Date.now(),
    }));
  } catch (error) {
    store.update((state) => ({
      ...state,
      loading: false,
      error: (error as Error).message,
    }));
  }
}

/**
 * Capture an error (from frontend)
 */
export async function captureError(error: {
  source: 'web_console' | 'runtime';
  message: string;
  stack?: string;
  context?: {
    file?: string;
    line?: number;
    column?: number;
  };
}): Promise<boolean> {
  try {
    const response = await apiFetch('/api/system-coder/capture-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(error),
    });

    if (!response.ok) {
      return false;
    }

    const result = await response.json();

    // Refresh status if error was captured
    if (result.captured) {
      await fetchStatus();
    }

    return result.captured;
  } catch {
    return false;
  }
}

/**
 * Ignore an error
 */
export async function ignoreError(errorId: string): Promise<boolean> {
  try {
    const response = await apiFetch(`/api/system-coder/errors/${errorId}/ignore`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to ignore error');
    }

    // Update local state
    store.update((state) => ({
      ...state,
      errors: state.errors.map((e) =>
        e.id === errorId ? { ...e, status: 'ignored' as const } : e
      ),
    }));

    // Refresh status
    await fetchStatus();

    return true;
  } catch (error) {
    store.update((state) => ({
      ...state,
      error: (error as Error).message,
    }));
    return false;
  }
}

/**
 * Request a fix for an error
 */
export async function requestFix(errorId: string): Promise<boolean> {
  try {
    const response = await apiFetch(`/api/system-coder/errors/${errorId}/fix`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to request fix');
    }

    // Update local state
    store.update((state) => ({
      ...state,
      errors: state.errors.map((e) =>
        e.id === errorId ? { ...e, status: 'reviewing' as const } : e
      ),
    }));

    return true;
  } catch (error) {
    store.update((state) => ({
      ...state,
      error: (error as Error).message,
    }));
    return false;
  }
}

/**
 * Clear error message
 */
export function clearError(): void {
  store.update((state) => ({ ...state, error: null }));
}

/**
 * Reset store to initial state
 */
export function resetStore(): void {
  store.set(initialState);
}

// Export the store itself for subscriptions
export const systemCoderStore = store;

// ============================================================================
// Coding Request Types
// ============================================================================

export interface CodingRequest {
  id: string;
  timestamp: string;
  type: 'feature' | 'fix' | 'refactor' | 'docs' | 'review' | 'other';
  description: string;
  context?: string;
  files?: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
}

// ============================================================================
// Coding Request Actions
// ============================================================================

/**
 * Submit a coding request from user
 */
export async function submitCodingRequest(request: {
  type: CodingRequest['type'];
  description: string;
  context?: string;
  files?: string[];
}): Promise<{ success: boolean; requestId?: string; error?: string }> {
  try {
    const response = await apiFetch('/api/system-coder/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Failed to submit request' };
    }

    const result = await response.json();
    return { success: true, requestId: result.requestId };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Fetch coding requests list
 */
export async function fetchCodingRequests(): Promise<CodingRequest[]> {
  try {
    const response = await apiFetch('/api/system-coder/requests');
    if (!response.ok) return [];
    const data = await response.json();
    return data.requests || [];
  } catch {
    return [];
  }
}

// ============================================================================
// Fix Types
// ============================================================================

export interface FileChange {
  changeType: 'create' | 'modify' | 'delete';
  filePath: string;
  newContent: string;
  originalContent?: string;
}

export type FixRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type FixStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'reverted';

export interface ProposedFix {
  id: string;
  errorId: string;
  timestamp: string;
  title: string;
  explanation: string;
  changes: FileChange[];
  risk: FixRisk;
  status: FixStatus;
  generatedBy: 'big_brother' | 'user' | 'maintenance';
  confidence: number;
  testCommands?: string[];
  appliedAt?: string;
  approvedBy?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  error?: CapturedError;
}

// ============================================================================
// Fix Actions
// ============================================================================

/**
 * Fetch list of fixes
 */
export async function fetchFixes(options: {
  status?: string;
  errorId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ fixes: ProposedFix[]; total: number }> {
  try {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.errorId) params.set('errorId', options.errorId);
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.offset) params.set('offset', options.offset.toString());

    const response = await apiFetch(`/api/system-coder/fixes?${params}`);
    if (!response.ok) {
      throw new Error('Failed to fetch fixes');
    }

    const data = await response.json();
    return { fixes: data.fixes || [], total: data.pagination?.total || 0 };
  } catch (error) {
    console.error('Failed to fetch fixes:', error);
    return { fixes: [], total: 0 };
  }
}

/**
 * Get a single fix by ID
 */
export async function getFix(fixId: string): Promise<ProposedFix | null> {
  try {
    const response = await apiFetch(`/api/system-coder/fixes/${fixId}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.fix;
  } catch {
    return null;
  }
}

/**
 * Approve a fix
 */
export async function approveFix(fixId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiFetch(`/api/system-coder/fixes/${fixId}/approve`, {
      method: 'POST',
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Failed to approve fix' };
    }

    await fetchStatus();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Reject a fix
 */
export async function rejectFix(fixId: string, reason?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiFetch(`/api/system-coder/fixes/${fixId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Failed to reject fix' };
    }

    await fetchStatus();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Apply an approved fix
 */
export async function applyFix(fixId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiFetch(`/api/system-coder/fixes/${fixId}/apply`, {
      method: 'POST',
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Failed to apply fix' };
    }

    const result = await response.json();
    if (!result.success) {
      return { success: false, error: result.error };
    }

    await fetchStatus();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Revert an applied fix
 */
export async function revertFix(fixId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiFetch(`/api/system-coder/fixes/${fixId}/revert`, {
      method: 'POST',
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Failed to revert fix' };
    }

    const result = await response.json();
    if (!result.success) {
      return { success: false, error: result.error };
    }

    await fetchStatus();
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================================
// Maintenance Types
// ============================================================================

export type CheckType =
  | 'type_errors'
  | 'unused_exports'
  | 'deprecated_apis'
  | 'security_vulnerabilities'
  | 'documentation_drift'
  | 'dead_code';

export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface MaintenanceIssue {
  id: string;
  checkType: CheckType;
  severity: IssueSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export interface MaintenanceReport {
  id: string;
  timestamp: string;
  duration: number;
  checksRun: CheckType[];
  issues: MaintenanceIssue[];
  summary: {
    total: number;
    byType: Record<CheckType, number>;
    bySeverity: Record<IssueSeverity, number>;
  };
}

export interface MaintenanceStatus {
  isRunning: boolean;
  lastRun?: string;
  lastReportSummary?: MaintenanceReport['summary'];
}

// ============================================================================
// Maintenance Actions
// ============================================================================

/**
 * Get maintenance status
 */
export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  try {
    const response = await apiFetch('/api/system-coder/maintenance/status');
    if (!response.ok) {
      return { isRunning: false };
    }
    return await response.json();
  } catch {
    return { isRunning: false };
  }
}

/**
 * Run maintenance checks
 */
export async function runMaintenance(checks?: CheckType[]): Promise<{ success: boolean; report?: MaintenanceReport; error?: string }> {
  try {
    const response = await apiFetch('/api/system-coder/maintenance/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Failed to run maintenance' };
    }

    const result = await response.json();
    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, report: result.report };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get last maintenance report
 */
export async function getMaintenanceReport(): Promise<MaintenanceReport | null> {
  try {
    const response = await apiFetch('/api/system-coder/maintenance/report');
    if (!response.ok) return null;
    const data = await response.json();
    return data.report;
  } catch {
    return null;
  }
}

/**
 * List maintenance reports
 */
export async function listMaintenanceReports(limit?: number): Promise<MaintenanceReport[]> {
  try {
    const params = limit ? `?limit=${limit}` : '';
    const response = await apiFetch(`/api/system-coder/maintenance/reports${params}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.reports || [];
  } catch {
    return [];
  }
}

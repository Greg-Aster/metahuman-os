import fs from 'node:fs';
import path from 'node:path';
import { paths, timestamp } from './paths.js';

export interface AuditEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'critical';
  category: 'system' | 'decision' | 'action' | 'security' | 'data';
  event: string;
  details?: any;
  actor?: string; // 'human' | 'system' | 'agent' or specific agent/service name
}

export interface AuditLog {
  entries: AuditEntry[];
  metadata: {
    startTime: string;
    endTime: string;
    totalEntries: number;
  };
}

/**
 * Write an audit entry to the audit log
 */
export function audit(entry: Omit<AuditEntry, 'timestamp'>): void {
  const fullEntry: AuditEntry = {
    timestamp: timestamp(),
    ...entry,
  };

  const date = new Date().toISOString().slice(0, 10);
  const logFile = path.join(paths.logs, 'audit', `${date}.ndjson`);

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify(fullEntry) + '\n');
}

/**
 * Read audit log for a specific date
 */
export function readAuditLog(date: string): AuditEntry[] {
  const logFile = path.join(paths.logs, 'audit', `${date}.ndjson`);

  if (!fs.existsSync(logFile)) {
    return [];
  }

  const content = fs.readFileSync(logFile, 'utf8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as AuditEntry);
}

/**
 * Get audit summary for a date range
 */
export function getAuditSummary(startDate: string, endDate?: string): AuditLog {
  const end = endDate || startDate;
  const entries: AuditEntry[] = [];

  // Simple implementation: just read the one day for now
  const dayEntries = readAuditLog(startDate);
  entries.push(...dayEntries);

  return {
    entries,
    metadata: {
      startTime: startDate,
      endTime: end,
      totalEntries: entries.length,
    },
  };
}

/**
 * Check for security issues in audit log
 */
export function securityCheck(): { issues: AuditEntry[]; warnings: string[] } {
  const today = new Date().toISOString().slice(0, 10);
  const entries = readAuditLog(today);

  const issues = entries.filter(e =>
    e.level === 'critical' || e.level === 'error' || e.category === 'security'
  );

  const warnings: string[] = [];

  // Check for suspicious patterns
  const actionCount = entries.filter(e => e.category === 'action').length;
  if (actionCount > 100) {
    warnings.push(`High action count: ${actionCount} actions today`);
  }

  const errors = entries.filter(e => e.level === 'error').length;
  if (errors > 10) {
    warnings.push(`High error rate: ${errors} errors today`);
  }

  return { issues, warnings };
}

/**
 * Helper: Log a decision with full context
 */
export function auditDecision(decision: {
  situation: string;
  chosen: string;
  reasoning: string;
  confidence: number;
  maker: 'human' | 'system';
}): void {
  audit({
    level: 'info',
    category: 'decision',
    event: 'decision_made',
    details: decision,
    actor: decision.maker,
  });
}

/**
 * Helper: Log an action execution
 */
export function auditAction(action: {
  skill: string;
  inputs: any;
  success: boolean;
  output?: any;
  error?: string;
}): void {
  audit({
    level: action.success ? 'info' : 'warn',
    category: 'action',
    event: 'skill_executed',
    details: action,
    actor: 'system',
  });
}

/**
 * Helper: Log a security event
 */
export function auditSecurity(event: {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  details?: any;
}): void {
  const levelMap = {
    low: 'info' as const,
    medium: 'warn' as const,
    high: 'error' as const,
    critical: 'critical' as const,
  };

  audit({
    level: levelMap[event.severity],
    category: 'security',
    event: event.type,
    details: { description: event.description, ...event.details },
    actor: 'system',
  });
}

/**
 * Helper: Log data changes
 */
export function auditDataChange(change: {
  type: 'create' | 'update' | 'delete';
  resource: string;
  path: string;
  actor: string; // 'human' | 'system' | 'agent' or specific agent/service name
  details?: any;
}): void {
  audit({
    level: 'info',
    category: 'data',
    event: `data_${change.type}`,
    details: {
      resource: change.resource,
      path: change.path,
      ...change.details,
    },
    actor: change.actor,
  });
}

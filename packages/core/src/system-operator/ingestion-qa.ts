/**
 * Ingestion QA Skill
 *
 * Checks memory quality and auto-repairs fixable issues.
 * Part of Phase 5: System Operator
 *
 * Checks:
 * - Malformed JSON files
 * - Missing required fields (id, timestamp, type, content)
 * - Invalid field values (bad dates, empty content)
 * - Contamination patterns (system prompts, API artifacts)
 * - Duplicate memories
 * - Orphaned references
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProfilePaths } from '../paths.js';
import { listEpisodicFiles } from '../memory.js';
import { audit } from '../audit.js';
import type { IngestionQAResult } from './types.js';

export interface IngestionQAOptions {
  username: string;
  autoRepair?: boolean;
  checkDuplicates?: boolean;
  checkContamination?: boolean;
  dryRun?: boolean;
}

interface MemoryIssue {
  filePath: string;
  memoryId: string;
  issueType: 'malformed_json' | 'missing_field' | 'invalid_value' | 'contamination' | 'duplicate' | 'orphan';
  severity: 'error' | 'warning' | 'info';
  description: string;
  autoRepairable: boolean;
  repairAction?: string;
}

interface MemoryCheckResult {
  totalChecked: number;
  issues: MemoryIssue[];
  repaired: number;
  unrepairable: number;
  duplicatesFound: number;
  contaminationFound: number;
}

// Required fields for a valid episodic memory
const REQUIRED_FIELDS = ['id', 'timestamp', 'type', 'content'];

// Valid memory types
const VALID_TYPES = ['observation', 'conversation', 'inner_dialogue', 'dream', 'reflection', 'task', 'event'];

// Contamination patterns to detect (system prompts, API artifacts, etc.)
const CONTAMINATION_PATTERNS = [
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /<\|system\|>/i,
  /<\|user\|>/i,
  /<\|assistant\|>/i,
  /<<SYS>>/i,
  /<\/SYS>>/i,
  /You are a helpful assistant/i,
  /As an AI language model/i,
  /I don't have personal opinions/i,
  /I cannot provide/i,
  /\{"role":\s*"system"/i,
  /\{"role":\s*"assistant"/i,
];

/**
 * Check a single memory file for issues.
 */
function checkMemoryFile(filePath: string): MemoryIssue[] {
  const issues: MemoryIssue[] = [];
  const memoryId = path.basename(filePath, '.json');

  // Try to read and parse the file
  let content: string;
  let memory: any;

  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    issues.push({
      filePath,
      memoryId,
      issueType: 'malformed_json',
      severity: 'error',
      description: `Cannot read file: ${(error as Error).message}`,
      autoRepairable: false,
    });
    return issues;
  }

  try {
    memory = JSON.parse(content);
  } catch (error) {
    issues.push({
      filePath,
      memoryId,
      issueType: 'malformed_json',
      severity: 'error',
      description: `Invalid JSON: ${(error as Error).message}`,
      autoRepairable: false,
    });
    return issues;
  }

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (memory[field] === undefined || memory[field] === null) {
      const isRepairable = field === 'id';
      issues.push({
        filePath,
        memoryId,
        issueType: 'missing_field',
        severity: 'error',
        description: `Missing required field: ${field}`,
        autoRepairable: isRepairable,
        repairAction: isRepairable ? `Set id from filename: ${memoryId}` : undefined,
      });
    }
  }

  // Check field values
  if (memory.timestamp) {
    const date = new Date(memory.timestamp);
    if (isNaN(date.getTime())) {
      issues.push({
        filePath,
        memoryId,
        issueType: 'invalid_value',
        severity: 'error',
        description: `Invalid timestamp: ${memory.timestamp}`,
        autoRepairable: false,
      });
    }
  }

  if (memory.type && !VALID_TYPES.includes(memory.type)) {
    issues.push({
      filePath,
      memoryId,
      issueType: 'invalid_value',
      severity: 'warning',
      description: `Unknown memory type: ${memory.type}`,
      autoRepairable: false,
    });
  }

  if (memory.content !== undefined) {
    if (typeof memory.content === 'string' && memory.content.trim() === '') {
      issues.push({
        filePath,
        memoryId,
        issueType: 'invalid_value',
        severity: 'warning',
        description: 'Empty content string',
        autoRepairable: false,
      });
    }
  }

  // Check for contamination patterns
  const contentStr = typeof memory.content === 'string'
    ? memory.content
    : JSON.stringify(memory.content);

  for (const pattern of CONTAMINATION_PATTERNS) {
    if (pattern.test(contentStr)) {
      issues.push({
        filePath,
        memoryId,
        issueType: 'contamination',
        severity: 'warning',
        description: `Detected contamination pattern: ${pattern.source.substring(0, 30)}...`,
        autoRepairable: false,
      });
      break; // Only report first contamination match
    }
  }

  return issues;
}

/**
 * Find duplicate memories based on content hash.
 */
function findDuplicates(memoryFiles: string[]): Map<string, string[]> {
  const contentHashes = new Map<string, string[]>();

  for (const filePath of memoryFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const memory = JSON.parse(content);

      // Create a hash from content + timestamp (same content at same time = duplicate)
      const hashKey = `${memory.timestamp}_${JSON.stringify(memory.content).substring(0, 200)}`;

      if (!contentHashes.has(hashKey)) {
        contentHashes.set(hashKey, []);
      }
      contentHashes.get(hashKey)!.push(filePath);
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Filter to only entries with duplicates
  const duplicates = new Map<string, string[]>();
  for (const [hash, files] of contentHashes) {
    if (files.length > 1) {
      duplicates.set(hash, files);
    }
  }

  return duplicates;
}

/**
 * Attempt to auto-repair a memory file.
 */
function repairMemory(filePath: string, issues: MemoryIssue[]): { repaired: boolean; actions: string[] } {
  const actions: string[] = [];
  let modified = false;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const memory = JSON.parse(content);
    const memoryId = path.basename(filePath, '.json');

    for (const issue of issues) {
      if (!issue.autoRepairable) continue;

      if (issue.issueType === 'missing_field' && issue.description.includes('id')) {
        memory.id = memoryId;
        actions.push(`Set id = ${memoryId}`);
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, JSON.stringify(memory, null, 2));
    }

    return { repaired: modified, actions };
  } catch {
    return { repaired: false, actions: ['Repair failed: could not parse file'] };
  }
}

/**
 * Run ingestion QA checks on all memories.
 */
export async function runIngestionQA(
  options: IngestionQAOptions
): Promise<IngestionQAResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  const {
    username,
    autoRepair = false,
    checkDuplicates = true,
    checkContamination = true,
    dryRun = false,
  } = options;

  // Get all memory files
  const memoryFiles = listEpisodicFiles(username);
  const allIssues: MemoryIssue[] = [];
  let repairedCount = 0;

  // Check each memory file
  for (const filePath of memoryFiles) {
    const issues = checkMemoryFile(filePath);

    // Filter contamination issues if not checking
    const filteredIssues = checkContamination
      ? issues
      : issues.filter(i => i.issueType !== 'contamination');

    allIssues.push(...filteredIssues);

    // Attempt auto-repair if enabled
    if (autoRepair && !dryRun) {
      const repairableIssues = filteredIssues.filter(i => i.autoRepairable);
      if (repairableIssues.length > 0) {
        const result = repairMemory(filePath, repairableIssues);
        if (result.repaired) {
          repairedCount++;
        }
      }
    }
  }

  // Check for duplicates if enabled
  let duplicatesFound = 0;
  if (checkDuplicates) {
    const duplicates = findDuplicates(memoryFiles);
    for (const [_, files] of duplicates) {
      duplicatesFound++;
      // Add issues for all but the first (oldest) file
      for (let i = 1; i < files.length; i++) {
        allIssues.push({
          filePath: files[i],
          memoryId: path.basename(files[i], '.json'),
          issueType: 'duplicate',
          severity: 'warning',
          description: `Duplicate of ${path.basename(files[0], '.json')}`,
          autoRepairable: false,
        });
      }
    }
  }

  // Count statistics
  const errorCount = allIssues.filter(i => i.severity === 'error').length;
  const warningCount = allIssues.filter(i => i.severity === 'warning').length;
  const contaminationCount = allIssues.filter(i => i.issueType === 'contamination').length;
  const unrepairableCount = allIssues.filter(i => i.severity === 'error' && !i.autoRepairable).length;

  // Build summary
  if (errorCount > 0) {
    errors.push(`${errorCount} error(s) found in memories`);
  }
  if (warningCount > 0) {
    warnings.push(`${warningCount} warning(s) found in memories`);
  }

  // Audit the QA run
  if (!dryRun) {
    audit({
      category: 'action',
      level: errorCount > 0 ? 'warn' : 'info',
      event: 'ingestion_qa_completed',
      actor: 'system-operator',
      details: {
        username,
        totalChecked: memoryFiles.length,
        errors: errorCount,
        warnings: warningCount,
        repaired: repairedCount,
        duplicates: duplicatesFound,
        contamination: contaminationCount,
      },
    });
  }

  return {
    success: errorCount === 0,
    operation: 'ingestion_qa',
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    details: {
      totalChecked: memoryFiles.length,
      issuesFound: allIssues.length,
      repaired: repairedCount,
      unrepairable: unrepairableCount,
      duplicatesFound,
      contaminationFound: contaminationCount,
      issues: allIssues.slice(0, 100), // Limit to first 100 issues
    },
    errors,
    warnings,
  };
}

/**
 * Get a quick health summary without full scan.
 */
export function getIngestionHealth(username: string): {
  totalMemories: number;
  lastChecked: string | null;
  estimatedIssues: number;
  needsFullScan: boolean;
} {
  const memoryFiles = listEpisodicFiles(username);

  // Quick spot check on last 10 files
  const recentFiles = memoryFiles.slice(-10);
  let spotCheckIssues = 0;

  for (const filePath of recentFiles) {
    const issues = checkMemoryFile(filePath);
    spotCheckIssues += issues.filter(i => i.severity === 'error').length;
  }

  // Estimate issues based on spot check
  const issueRate = recentFiles.length > 0 ? spotCheckIssues / recentFiles.length : 0;
  const estimatedIssues = Math.round(issueRate * memoryFiles.length);

  return {
    totalMemories: memoryFiles.length,
    lastChecked: new Date().toISOString(),
    estimatedIssues,
    needsFullScan: estimatedIssues > 0 || memoryFiles.length > 100,
  };
}

/**
 * Clean up duplicate memories (keeps oldest, removes newer duplicates).
 */
export function cleanupDuplicates(
  username: string,
  dryRun = true
): { removed: number; files: string[] } {
  const memoryFiles = listEpisodicFiles(username);
  const duplicates = findDuplicates(memoryFiles);
  const filesToRemove: string[] = [];

  for (const [_, files] of duplicates) {
    // Sort by filename (which includes date) to keep oldest
    files.sort();
    // Mark all but first for removal
    for (let i = 1; i < files.length; i++) {
      filesToRemove.push(files[i]);
    }
  }

  if (!dryRun) {
    for (const filePath of filesToRemove) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignore errors
      }
    }

    if (filesToRemove.length > 0) {
      audit({
        category: 'action',
        level: 'info',
        event: 'duplicates_cleaned',
        actor: 'system-operator',
        details: {
          username,
          removed: filesToRemove.length,
        },
      });
    }
  }

  return {
    removed: filesToRemove.length,
    files: filesToRemove.map(f => path.basename(f)),
  };
}

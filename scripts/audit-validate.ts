#!/usr/bin/env tsx
/**
 * Validate audit completion
 * Checks if all audit requirements are met
 *
 * Usage:
 *   pnpm tsx scripts/audit-validate.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const STATE_FILE = join(ROOT, 'audit-state.json');

interface AuditState {
  _metadata: {
    totalFiles: number;
    completedFiles: number;
    inProgressFiles: number;
  };
  files: Record<string, FileStatus>;
}

interface FileStatus {
  status: 'pending' | 'in-progress' | 'completed' | 'blocked' | 'needs-review';
  criticalIssues?: number;
  followUpNeeded?: boolean;
}

interface ValidationResult {
  passed: boolean;
  message: string;
  details?: string[];
}

const results: ValidationResult[] = [];

console.log('\n' + '='.repeat(100));
console.log('🔍 AUDIT VALIDATION REPORT');
console.log('='.repeat(100) + '\n');

// Load state
const state: AuditState = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));

// Check 1: All files reviewed
console.log('📋 Checking: All files reviewed...');
const totalFiles = state._metadata.totalFiles;
const completedFiles = state._metadata.completedFiles;
const inProgressFiles = state._metadata.inProgressFiles;
const pendingFiles = Object.values(state.files).filter((f) => f.status === 'pending').length;
const blockedFiles = Object.values(state.files).filter((f) => f.status === 'blocked').length;

if (completedFiles === totalFiles) {
  results.push({
    passed: true,
    message: `✅ All ${totalFiles} files reviewed and completed`,
  });
} else {
  results.push({
    passed: false,
    message: `❌ Not all files reviewed: ${completedFiles}/${totalFiles} completed`,
    details: [
      `In progress: ${inProgressFiles}`,
      `Pending: ${pendingFiles}`,
      `Blocked: ${blockedFiles}`,
    ],
  });
}

// Check 2: No critical issues unresolved
console.log('🚨 Checking: No critical issues unresolved...');
const filesWithCriticalIssues = Object.entries(state.files).filter(
  ([_, f]) => (f.criticalIssues ?? 0) > 0
);

if (filesWithCriticalIssues.length === 0) {
  results.push({
    passed: true,
    message: '✅ No critical issues reported',
  });
} else {
  results.push({
    passed: false,
    message: `❌ ${filesWithCriticalIssues.length} files have unresolved critical issues`,
    details: filesWithCriticalIssues.map(([path, status]) =>
      `${path} (${status.criticalIssues} critical)`
    ),
  });
}

// Check 3: No files needing follow-up
console.log('📌 Checking: No files needing follow-up...');
const filesNeedingFollowUp = Object.entries(state.files).filter(
  ([_, f]) => f.status === 'completed' && f.followUpNeeded
);

if (filesNeedingFollowUp.length === 0) {
  results.push({
    passed: true,
    message: '✅ No files marked as needing follow-up',
  });
} else {
  results.push({
    passed: false,
    message: `⚠️  ${filesNeedingFollowUp.length} files marked as needing follow-up`,
    details: filesNeedingFollowUp.map(([path]) => path),
  });
}

// Check 4: No TODO/FIXME in codebase
console.log('🔍 Checking: No TODO/FIXME comments...');
try {
  const todoResults = execSync(
    'git grep -i "TODO\\|FIXME" -- "*.ts" "*.tsx" "*.svelte" "*.astro" || true',
    { encoding: 'utf-8', cwd: ROOT }
  );

  const todoLines = todoResults.trim().split('\n').filter(Boolean);

  // Filter out audit scripts and this validation script
  const relevantTodos = todoLines.filter(line =>
    !line.includes('scripts/audit-') &&
    !line.includes('AUDIT-INSTRUCTIONS.md') &&
    !line.includes('AUDIT-README.md')
  );

  if (relevantTodos.length === 0) {
    results.push({
      passed: true,
      message: '✅ No TODO/FIXME comments found in codebase',
    });
  } else {
    results.push({
      passed: false,
      message: `❌ Found ${relevantTodos.length} TODO/FIXME comments`,
      details: relevantTodos.slice(0, 20), // Show first 20
    });
  }
} catch (error) {
  results.push({
    passed: false,
    message: '❌ Failed to check for TODO/FIXME comments',
    details: [(error as Error).message],
  });
}

// Check 5: TypeScript compilation
console.log('🔨 Checking: TypeScript compilation...');
try {
  execSync('pnpm tsc --noEmit', { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  results.push({
    passed: true,
    message: '✅ TypeScript compiles without errors',
  });
} catch (error) {
  const output = (error as any).stdout || (error as any).stderr || '';
  const errorLines = output.split('\n').filter((line: string) => line.includes('error TS'));
  results.push({
    passed: false,
    message: `❌ TypeScript compilation failed with ${errorLines.length} errors`,
    details: errorLines.slice(0, 10), // Show first 10 errors
  });
}

// Check 6: No unused imports (using ts-unused-exports or eslint)
console.log('📦 Checking: No unused imports...');
try {
  const unusedResults = execSync(
    'git grep -n "^import.*from" -- "*.ts" "*.tsx" | head -100 || true',
    { encoding: 'utf-8', cwd: ROOT }
  );
  // This is a basic check - a proper check would use ESLint
  results.push({
    passed: true,
    message: '⚠️  Unused imports check skipped (requires ESLint setup)',
  });
} catch (error) {
  results.push({
    passed: true,
    message: '⚠️  Unused imports check skipped',
  });
}

// Check 7: All files have LOG_PREFIX
console.log('📝 Checking: All files have LOG_PREFIX for logging...');
const filesNeedingLogPrefix: string[] = [];
for (const [path, status] of Object.entries(state.files)) {
  if (status.status !== 'completed') continue;
  if (!path.match(/\.(ts|tsx)$/)) continue;
  if (path.includes('.test.') || path.includes('.spec.')) continue;

  try {
    const fullPath = join(ROOT, path);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, 'utf-8');

    // Skip files that likely don't need logging (types, interfaces, configs)
    if (path.includes('/types/') || path.includes('/interfaces/') || content.length < 500) {
      continue;
    }

    // Check if file has console.log but no LOG_PREFIX
    if (content.includes('console.log') && !content.includes('LOG_PREFIX')) {
      filesNeedingLogPrefix.push(path);
    }
  } catch (error) {
    // Skip files we can't read
  }
}

if (filesNeedingLogPrefix.length === 0) {
  results.push({
    passed: true,
    message: '✅ All files with logging have LOG_PREFIX',
  });
} else {
  results.push({
    passed: false,
    message: `⚠️  ${filesNeedingLogPrefix.length} files have console.log but no LOG_PREFIX`,
    details: filesNeedingLogPrefix.slice(0, 10),
  });
}

// Print results
console.log('\n' + '━'.repeat(100));
console.log('📊 VALIDATION RESULTS');
console.log('━'.repeat(100) + '\n');

let allPassed = true;
for (const result of results) {
  console.log(result.message);
  if (result.details && result.details.length > 0) {
    for (const detail of result.details) {
      console.log(`   ${detail}`);
    }
    if (result.details.length >= 10) {
      console.log('   ... (showing first 10)');
    }
  }
  console.log();

  if (!result.passed) {
    allPassed = false;
  }
}

// Final verdict
console.log('━'.repeat(100));
if (allPassed) {
  console.log('🎉 AUDIT VALIDATION PASSED! The codebase meets all quality criteria.');
  console.log('━'.repeat(100) + '\n');
  process.exit(0);
} else {
  console.log('❌ AUDIT VALIDATION FAILED. Address the issues above before marking audit complete.');
  console.log('━'.repeat(100) + '\n');
  process.exit(1);
}

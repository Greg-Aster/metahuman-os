#!/usr/bin/env tsx
/**
 * Initialize audit-state.json with all files in the codebase
 * Run this ONCE before starting the audit
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const STATE_FILE = join(ROOT, 'audit-state.json');

interface AuditState {
  _metadata: {
    auditStarted: string;
    auditVersion: string;
    totalFiles: number;
    completedFiles: number;
    inProgressFiles: number;
    activeAgents: string[];
    lastUpdated: string;
  };
  _instructions: Record<string, unknown>;
  files: Record<string, FileStatus>;
}

interface FileStatus {
  status: 'pending' | 'in-progress' | 'completed' | 'blocked' | 'needs-review';
  reviewer?: string;
  started?: string;
  completed?: string;
  issuesFound?: number;
  issuesFixed?: number;
  criticalIssues?: number;
  followUpNeeded?: boolean;
  notes?: string;
}

console.log('🔍 Discovering files in codebase...');

// Use git to find all tracked TypeScript/JavaScript files
const gitFiles = execSync('git ls-files', { encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean);

// Filter to source files we care about
const sourceFiles = gitFiles.filter((file) => {
  // Include TypeScript and Svelte files
  if (!file.match(/\.(ts|tsx|js|jsx|svelte|astro)$/)) return false;

  // Exclude certain directories
  if (file.match(/node_modules|\.next|dist|build|out|coverage/)) return false;
  if (file.match(/\.test\.|\.spec\./)) return false; // Exclude test files for now
  if (file.startsWith('scripts/audit-')) return false; // Exclude audit scripts themselves

  return true;
});

console.log(`📁 Found ${sourceFiles.length} source files`);

// Categorize files by tier
const tiers = {
  tier1: [] as string[], // Critical infrastructure
  tier2: [] as string[], // Agent system
  tier3: [] as string[], // Web UI
  tier4: [] as string[], // CLI
  tier5: [] as string[], // Everything else
};

for (const file of sourceFiles) {
  // Tier 1: Critical core infrastructure
  if (
    file === 'packages/core/src/auth.ts' ||
    file === 'packages/core/src/users.ts' ||
    file === 'packages/core/src/security-policy.ts' ||
    file === 'packages/core/src/path-builder.ts' ||
    file === 'packages/core/src/audit.ts' ||
    file === 'packages/core/src/llm.ts' ||
    file === 'packages/core/src/memory.ts' ||
    file === 'packages/core/src/identity.ts'
  ) {
    tiers.tier1.push(file);
  }
  // Tier 2: Agent system
  else if (
    file.startsWith('packages/core/src/agent-') ||
    file.startsWith('brain/agents/')
  ) {
    tiers.tier2.push(file);
  }
  // Tier 3: Web UI
  else if (file.startsWith('apps/site/')) {
    tiers.tier3.push(file);
  }
  // Tier 4: CLI
  else if (file.startsWith('packages/cli/')) {
    tiers.tier4.push(file);
  }
  // Tier 5: Everything else
  else {
    tiers.tier5.push(file);
  }
}

console.log('\n📊 File distribution by tier:');
console.log(`  Tier 1 (Critical):  ${tiers.tier1.length} files`);
console.log(`  Tier 2 (Agents):    ${tiers.tier2.length} files`);
console.log(`  Tier 3 (Web UI):    ${tiers.tier3.length} files`);
console.log(`  Tier 4 (CLI):       ${tiers.tier4.length} files`);
console.log(`  Tier 5 (Other):     ${tiers.tier5.length} files`);

// Load existing state
const existingState: AuditState = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));

// Build files object
const files: Record<string, FileStatus> = {};
const allTierFiles = [
  ...tiers.tier1,
  ...tiers.tier2,
  ...tiers.tier3,
  ...tiers.tier4,
  ...tiers.tier5,
];

for (const file of allTierFiles) {
  // Preserve existing status if file was already being audited
  if (existingState.files[file]) {
    files[file] = existingState.files[file];
  } else {
    files[file] = {
      status: 'pending',
    };
  }
}

// Update state
const newState: AuditState = {
  ...existingState,
  _metadata: {
    ...existingState._metadata,
    auditStarted: existingState._metadata.auditStarted || new Date().toISOString(),
    totalFiles: allTierFiles.length,
    completedFiles: Object.values(files).filter((f) => f.status === 'completed').length,
    inProgressFiles: Object.values(files).filter((f) => f.status === 'in-progress').length,
    lastUpdated: new Date().toISOString(),
  },
  files,
};

// Write back
writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2), 'utf-8');

console.log('\n✅ Audit state initialized!');
console.log(`📝 ${STATE_FILE}`);
console.log(`\n📋 Status:`);
console.log(`  Total files:       ${newState._metadata.totalFiles}`);
console.log(`  Completed:         ${newState._metadata.completedFiles}`);
console.log(`  In progress:       ${newState._metadata.inProgressFiles}`);
console.log(`  Pending:           ${newState._metadata.totalFiles - newState._metadata.completedFiles - newState._metadata.inProgressFiles}`);
console.log('\n🚀 Ready to start audit. Run: pnpm tsx scripts/audit-agent.ts');

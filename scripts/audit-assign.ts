#!/usr/bin/env tsx
/**
 * Manual file assignment helper
 * Generates file lists that can be manually assigned to specific agents
 *
 * Usage:
 *   pnpm tsx scripts/audit-assign.ts --agents=5
 *   pnpm tsx scripts/audit-assign.ts --agents=10
 *
 * This will split pending files into N roughly equal chunks
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const STATE_FILE = join(ROOT, 'audit-state.json');

interface AuditState {
  _metadata: Record<string, unknown>;
  files: Record<string, FileStatus>;
}

interface FileStatus {
  status: 'pending' | 'in-progress' | 'completed' | 'blocked' | 'needs-review';
  reviewer?: string;
}

// Parse args
const args = process.argv.slice(2);
const numAgentsArg = args.find((arg) => arg.startsWith('--agents='));
const numAgents = numAgentsArg ? parseInt(numAgentsArg.split('=')[1]) : 5;

if (isNaN(numAgents) || numAgents < 1) {
  console.error('❌ Invalid number of agents. Use --agents=N where N >= 1');
  process.exit(1);
}

const state: AuditState = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));

// Get pending files
const pending = Object.entries(state.files)
  .filter(([_, status]) => status.status === 'pending')
  .map(([path]) => path);

if (pending.length === 0) {
  console.log('✅ No pending files! All files are completed or in-progress.');
  process.exit(0);
}

console.log(`\n📋 Splitting ${pending.length} pending files across ${numAgents} agents...\n`);

// Calculate chunk size
const chunkSize = Math.ceil(pending.length / numAgents);

// Split into chunks
const assignments: string[][] = [];
for (let i = 0; i < numAgents; i++) {
  const start = i * chunkSize;
  const end = Math.min(start + chunkSize, pending.length);
  assignments.push(pending.slice(start, end));
}

// Display assignments
for (let i = 0; i < assignments.length; i++) {
  const agentName = `Agent-${i + 1}`;
  const files = assignments[i];

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`👤 ${agentName} (${files.length} files)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Save to file
  const assignmentFile = join(ROOT, `audit-assignment-${agentName}.txt`);
  writeFileSync(assignmentFile, files.join('\n'), 'utf-8');

  console.log(`📁 Saved to: ${assignmentFile}\n`);

  // Show first 10 files
  const preview = files.slice(0, 10);
  for (const file of preview) {
    console.log(`   ${file}`);
  }
  if (files.length > 10) {
    console.log(`   ... and ${files.length - 10} more (see file)`);
  }
  console.log();
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('📝 Manual Assignment Instructions:\n');
console.log('1. Each agent should work ONLY on files in their assignment file');
console.log('2. Before starting a file, claim it in audit-state.json');
console.log('3. Follow the comprehensive checklist in AUDIT-INSTRUCTIONS.md');
console.log('4. Update audit-scratchpad.md after each file');
console.log('5. Mark completed in audit-state.json when done\n');
console.log('💡 Or use the automated agent script: pnpm tsx scripts/audit-agent.ts\n');

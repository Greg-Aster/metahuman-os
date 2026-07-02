#!/usr/bin/env tsx
console.error(
  'Deprecated audit workflow. Use docs/technical/AUDIT_PROTOCOL.md, pnpm audit:inventory, and pnpm check:architecture instead.',
);
process.exit(1);

/**
 * Audit Agent Script
 * Run this in multiple terminals for parallel auditing
 *
 * Usage:
 *   pnpm tsx scripts/audit-agent.ts --agent=Agent-1
 *   pnpm tsx scripts/audit-agent.ts --agent=Agent-2
 *
 * Each instance will:
 * 1. Find next available file to audit
 * 2. Claim it in audit-state.json
 * 3. Guide through comprehensive review
 * 4. Update state when complete
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

const ROOT = process.cwd();
const STATE_FILE = join(ROOT, 'audit-state.json');
const SCRATCHPAD_FILE = join(ROOT, 'audit-scratchpad.md');
const INSTRUCTIONS_FILE = join(ROOT, 'AUDIT-INSTRUCTIONS.md');

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

// Parse command line args
const args = process.argv.slice(2);
const agentName = args.find((arg) => arg.startsWith('--agent='))?.split('=')[1] || `Agent-${Date.now()}`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function loadState(): AuditState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

function saveState(state: AuditState): void {
  state._metadata.lastUpdated = new Date().toISOString();
  state._metadata.completedFiles = Object.values(state.files).filter(
    (f) => f.status === 'completed'
  ).length;
  state._metadata.inProgressFiles = Object.values(state.files).filter(
    (f) => f.status === 'in-progress'
  ).length;

  // Update active agents
  const agents = new Set<string>();
  for (const file of Object.values(state.files)) {
    if (file.status === 'in-progress' && file.reviewer) {
      agents.add(file.reviewer);
    }
  }
  state._metadata.activeAgents = Array.from(agents);

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function getNextFile(state: AuditState, agentName: string): string | null {
  // Find pending files
  const pending = Object.entries(state.files)
    .filter(([_, status]) => status.status === 'pending')
    .map(([path]) => path);

  if (pending.length === 0) {
    return null;
  }

  // Return first pending file
  return pending[0];
}

function claimFile(filePath: string, agentName: string): void {
  const state = loadState();
  state.files[filePath] = {
    status: 'in-progress',
    reviewer: agentName,
    started: new Date().toISOString(),
  };
  saveState(state);
}

function completeFile(
  filePath: string,
  agentName: string,
  data: {
    issuesFound: number;
    issuesFixed: number;
    criticalIssues: number;
    followUpNeeded: boolean;
    notes: string;
  }
): void {
  const state = loadState();
  state.files[filePath] = {
    status: 'completed',
    reviewer: agentName,
    started: state.files[filePath]?.started,
    completed: new Date().toISOString(),
    ...data,
  };
  saveState(state);
}

function displayProgress(state: AuditState): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 AUDIT PROGRESS');
  console.log('='.repeat(80));
  console.log(`Total files:       ${state._metadata.totalFiles}`);
  console.log(`✅ Completed:      ${state._metadata.completedFiles} (${((state._metadata.completedFiles / state._metadata.totalFiles) * 100).toFixed(1)}%)`);
  console.log(`🔄 In progress:    ${state._metadata.inProgressFiles}`);
  console.log(`⏳ Pending:        ${state._metadata.totalFiles - state._metadata.completedFiles - state._metadata.inProgressFiles}`);
  console.log(`👥 Active agents:  ${state._metadata.activeAgents.join(', ') || 'None'}`);
  console.log('='.repeat(80) + '\n');
}

async function displayChecklist(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('📋 COMPREHENSIVE AUDIT CHECKLIST');
  console.log('='.repeat(80));
  console.log(`
Phase 1: Initial Assessment (5 min)
  □ Read entire file
  □ Understand file purpose
  □ Check file location & naming
  □ Review imports & exports

Phase 2: Code Quality (15 min)
  □ TypeScript standards (no any, proper types)
  □ Import/export hygiene (no unused, no circular deps)
  □ Error handling (try/catch, logging, context)
  □ Logging & observability (LOG_PREFIX, entry/exit/errors)

Phase 3: Architecture (10 min)
  □ File organization (correct package, single responsibility)
  □ Pattern adherence (uses utilities, follows patterns)
  □ Security & safety (input validation, auth checks)

Phase 4: Functional Correctness (20 min)
  □ Logic review (all paths reachable, edge cases)
  □ Integration review (works with callers & dependencies)
  □ Performance review (no unnecessary loops, efficient)

Phase 5: Documentation (5 min)
  □ JSDoc comments
  □ Explanatory comments
  □ No TODOs/FIXMEs

Phase 6: Testing (5 min)
  □ File is testable
  □ Pure functions separated

Phase 7: Legacy & Duplication (10 min)
  □ No deprecated functions
  □ No commented-out code
  □ No copy-pasted logic
  □ No duplicate constants

TOTAL: ~70 minutes per file (minimum)
  `);
  console.log('='.repeat(80) + '\n');
}

async function conductAudit(): Promise<void> {
  console.log(`\n🤖 Audit Agent: ${agentName}`);
  console.log(`📅 Started: ${new Date().toISOString()}\n`);

  let state = loadState();
  displayProgress(state);

  // Main audit loop
  while (true) {
    state = loadState();

    const nextFile = getNextFile(state, agentName);

    if (!nextFile) {
      console.log('\n🎉 No more files to audit! All files completed or in-progress.');
      console.log('\n📊 Final Progress:');
      displayProgress(state);
      break;
    }

    console.log('\n' + '━'.repeat(80));
    console.log(`📁 NEXT FILE: ${nextFile}`);
    console.log('━'.repeat(80));

    const start = await question('\n▶️  Start audit of this file? (y/n/q to quit): ');

    if (start.toLowerCase() === 'q') {
      console.log('\n👋 Quitting...');
      break;
    }

    if (start.toLowerCase() !== 'y') {
      console.log('⏭️  Skipping...');
      continue;
    }

    // Claim the file
    claimFile(nextFile, agentName);
    console.log(`\n✅ Claimed: ${nextFile}`);

    // Display checklist
    await displayChecklist();

    console.log('\n🔍 START YOUR COMPREHENSIVE REVIEW NOW');
    console.log('📖 Reference: AUDIT-INSTRUCTIONS.md');
    console.log('📝 Scratchpad: audit-scratchpad.md');
    console.log('\n⏱️  Estimated time: 60-90 minutes for thorough review');
    console.log('\n⚠️  DO NOT RUSH. Quality over speed.\n');

    // Wait for completion
    await question('Press ENTER when you have COMPLETED the audit and are ready to log results...');

    // Collect results
    console.log('\n' + '━'.repeat(80));
    console.log('📊 AUDIT RESULTS FOR: ' + nextFile);
    console.log('━'.repeat(80) + '\n');

    const issuesFoundStr = await question('How many issues did you find? ');
    const issuesFixedStr = await question('How many issues did you fix? ');
    const criticalIssuesStr = await question('How many CRITICAL issues? ');
    const followUpStr = await question('Does this file need follow-up? (y/n): ');
    const notes = await question('Brief summary (one line): ');

    const issuesFound = parseInt(issuesFoundStr) || 0;
    const issuesFixed = parseInt(issuesFixedStr) || 0;
    const criticalIssues = parseInt(criticalIssuesStr) || 0;
    const followUpNeeded = followUpStr.toLowerCase() === 'y';

    // Complete the file
    completeFile(nextFile, agentName, {
      issuesFound,
      issuesFixed,
      criticalIssues,
      followUpNeeded,
      notes,
    });

    console.log('\n✅ File marked as COMPLETED');

    // Remind to update scratchpad
    console.log('\n📝 REMINDER: Update audit-scratchpad.md with your findings!');
    console.log('   Use the template in the scratchpad file.');

    const scratchpadUpdated = await question('\nHave you updated the scratchpad? (y/n): ');
    if (scratchpadUpdated.toLowerCase() !== 'y') {
      console.log('\n⚠️  WARNING: Please update the scratchpad before continuing!');
      await question('Press ENTER when scratchpad is updated...');
    }

    // Show updated progress
    state = loadState();
    displayProgress(state);

    // Ask if continuing
    const continueAudit = await question('\n▶️  Continue to next file? (y/n): ');
    if (continueAudit.toLowerCase() !== 'y') {
      console.log('\n👋 Stopping for now. Run this script again to resume.');
      break;
    }
  }

  rl.close();
}

// Run the agent
conductAudit().catch((error) => {
  console.error('❌ Error:', error);
  rl.close();
  process.exit(1);
});

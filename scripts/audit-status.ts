#!/usr/bin/env tsx
console.error(
  'Deprecated audit workflow. Use docs/technical/AUDIT_PROTOCOL.md, pnpm audit:inventory, and pnpm check:architecture instead.',
);
process.exit(1);

/**
 * Display current audit status
 * Run this to see what's being worked on and what's left
 */

import { readFileSync } from 'fs';
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

const state: AuditState = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));

// Calculate actual completed count from state
const actualCompleted = Object.values(state.files).filter(f => f.status === 'completed').length;
const actualInProgress = Object.values(state.files).filter(f => f.status === 'in-progress').length;
const actualPending = Object.values(state.files).filter(f => f.status === 'pending').length;

// Get actual agents working
const activeAgentsList = Array.from(new Set(
  Object.values(state.files)
    .filter(f => f.status === 'in-progress' && f.reviewer)
    .map(f => f.reviewer!)
));

console.log('\n' + '='.repeat(100));
console.log('📊 REAL-TIME AUDIT STATUS');
console.log('='.repeat(100));

// Progress bar
const progressPercent = ((actualCompleted / state._metadata.totalFiles) * 100).toFixed(1);
const barLength = 50;
const filledLength = Math.floor((actualCompleted / state._metadata.totalFiles) * barLength);
const progressBar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

console.log('\n📈 Overall Progress:');
console.log(`   [${progressBar}] ${progressPercent}%`);
console.log(`   Total files:       ${state._metadata.totalFiles}`);
console.log(`   ✅ Completed:      ${actualCompleted}`);
console.log(`   🔄 In progress:    ${actualInProgress}`);
console.log(`   ⏳ Pending:        ${actualPending}`);
console.log(`   🚫 Blocked:        ${Object.values(state.files).filter((f) => f.status === 'blocked').length}`);

// Recent commits
try {
  const recentCommits = execSync('git log --oneline --since="6 hours ago" | grep -i "audit(" || true', { encoding: 'utf-8', cwd: ROOT })
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 5);

  console.log('\n📦 Recent Audit Commits (last 6 hours):');
  if (recentCommits.length === 0) {
    console.log('   None');
  } else {
    for (const commit of recentCommits) {
      console.log(`   ${commit}`);
    }
  }
} catch {}

// Recently completed files
const recentlyCompleted = Object.entries(state.files)
  .filter(([_, f]) => f.status === 'completed')
  .sort((a, b) => {
    const timeA = a[1].completed ? new Date(a[1].completed).getTime() : 0;
    const timeB = b[1].completed ? new Date(b[1].completed).getTime() : 0;
    return timeB - timeA;
  })
  .slice(0, 10);

console.log('\n🎉 Recently Completed Files:');
if (recentlyCompleted.length === 0) {
  console.log('   None yet');
} else {
  for (const [path, status] of recentlyCompleted) {
    const timeAgo = status.completed
      ? Math.floor((Date.now() - new Date(status.completed).getTime()) / 60000)
      : '?';
    console.log(`   ${path}`);
    console.log(`      By: ${status.reviewer} | ${timeAgo} min ago | Issues: ${status.issuesFound || 0} found, ${status.issuesFixed || 0} fixed`);
  }
}

console.log('\n👥 Active Agents:');
if (activeAgentsList.length === 0) {
  console.log('   None');
} else {
  console.log(`   ${activeAgentsList.length} agents working: ${activeAgentsList.join(', ')}`);
  for (const agent of activeAgentsList) {
    const filesInProgress = Object.entries(state.files)
      .filter(([_, f]) => f.status === 'in-progress' && f.reviewer === agent)
      .map(([path]) => path);
    console.log(`\n   ${agent}:`);
    for (const file of filesInProgress) {
      const status = state.files[file];
      const elapsed = status.started
        ? Math.floor((Date.now() - new Date(status.started).getTime()) / 60000)
        : 0;
      console.log(`      📝 ${file}`);
      console.log(`         ⏱️  ${elapsed} minutes in (expected: 60-90 min)`);
    }
  }
}


console.log('\n🚫 Blocked Files:');
const blocked = Object.entries(state.files).filter(([_, f]) => f.status === 'blocked');
if (blocked.length === 0) {
  console.log('   None');
} else {
  for (const [path, status] of blocked) {
    console.log(`   ${path}`);
    console.log(`      Notes: ${status.notes || 'No notes'}`);
  }
}

console.log('\n⚠️  Files Needing Follow-Up:');
const needsFollowUp = Object.entries(state.files).filter(
  ([_, f]) => f.status === 'completed' && f.followUpNeeded
);
if (needsFollowUp.length === 0) {
  console.log('   None');
} else {
  for (const [path, status] of needsFollowUp) {
    console.log(`   ${path}`);
    console.log(`      Reviewer: ${status.reviewer}`);
    console.log(`      Notes: ${status.notes || 'No notes'}`);
  }
}

console.log('\n🔴 Critical Issues Found:');
const criticalFiles = Object.entries(state.files).filter(
  ([_, f]) => (f.criticalIssues ?? 0) > 0
);
if (criticalFiles.length === 0) {
  console.log('   None reported');
} else {
  for (const [path, status] of criticalFiles) {
    console.log(`   ${path}`);
    console.log(`      Critical issues: ${status.criticalIssues}`);
    console.log(`      Total issues found: ${status.issuesFound}`);
    console.log(`      Issues fixed: ${status.issuesFixed}`);
    console.log(`      Notes: ${status.notes || 'No notes'}`);
  }
}

console.log('\n📊 Quality Metrics:');
const completed = Object.values(state.files).filter((f) => f.status === 'completed');
const totalIssuesFound = completed.reduce((sum, f) => sum + (f.issuesFound ?? 0), 0);
const totalIssuesFixed = completed.reduce((sum, f) => sum + (f.issuesFixed ?? 0), 0);
const totalCriticalIssues = completed.reduce((sum, f) => sum + (f.criticalIssues ?? 0), 0);
const avgIssuesPerFile = completed.length > 0 ? (totalIssuesFound / completed.length).toFixed(1) : 0;

console.log(`   Files completed:        ${completed.length}`);
console.log(`   Total issues found:     ${totalIssuesFound}`);
console.log(`   Total issues fixed:     ${totalIssuesFixed}`);
console.log(`   Critical issues:        ${totalCriticalIssues}`);
console.log(`   Avg issues per file:    ${avgIssuesPerFile}`);
console.log(`   Fix rate:               ${totalIssuesFound > 0 ? ((totalIssuesFixed / totalIssuesFound) * 100).toFixed(0) : 100}%`);

// Agent productivity
console.log('\n👤 Agent Productivity:');
const agentStats = new Map<string, { completed: number; issues: number }>();
for (const [_, file] of Object.entries(state.files)) {
  if (file.status === 'completed' && file.reviewer) {
    const current = agentStats.get(file.reviewer) || { completed: 0, issues: 0 };
    agentStats.set(file.reviewer, {
      completed: current.completed + 1,
      issues: current.issues + (file.issuesFound || 0)
    });
  }
}

if (agentStats.size === 0) {
  console.log('   No files completed yet');
} else {
  const sorted = Array.from(agentStats.entries()).sort((a, b) => b[1].completed - a[1].completed);
  for (const [agent, stats] of sorted) {
    console.log(`   ${agent}: ${stats.completed} files, ${stats.issues} issues found`);
  }
}

// Time estimates
const auditStart = new Date(state._metadata.auditStarted).getTime();
const now = Date.now();
const hoursElapsed = (now - auditStart) / (1000 * 60 * 60);
const filesPerHour = completed.length / hoursElapsed;
const remainingFiles = actualPending + actualInProgress;
const etaHours = filesPerHour > 0 ? (remainingFiles / filesPerHour / activeAgentsList.length).toFixed(1) : '∞';

console.log('\n⏱️  Time Estimates:');
console.log(`   Audit running for:      ${hoursElapsed.toFixed(1)} hours`);
console.log(`   Files completed/hour:   ${filesPerHour.toFixed(2)}`);
console.log(`   Active agents:          ${activeAgentsList.length}`);
console.log(`   Remaining files:        ${remainingFiles}`);
if (filesPerHour > 0 && activeAgentsList.length > 0) {
  console.log(`   Est. time remaining:    ${etaHours} hours (with ${activeAgentsList.length} agents)`);
  const etaDays = (parseFloat(etaHours) / 24).toFixed(1);
  if (parseFloat(etaDays) > 1) {
    console.log(`                           (~${etaDays} days)`);
  }
} else {
  console.log(`   Est. time remaining:    Calculating...`);
}

console.log('\n⏭️  Next Pending Files (Tier 1 Priority):');
const tier1Files = [
  'packages/core/src/path-builder.ts',
  'packages/core/src/model-router.ts',
  'packages/core/src/model-resolver.ts',
  'packages/core/src/embeddings.ts',
  'packages/core/src/vector-index.ts'
].filter(f => state.files[f]?.status === 'pending');

const otherPending = Object.entries(state.files)
  .filter(([path, f]) => f.status === 'pending' && !tier1Files.includes(path))
  .map(([path]) => path)
  .slice(0, 5);

if (tier1Files.length > 0) {
  console.log('   🔴 Tier 1 Critical (do these first):');
  for (const file of tier1Files) {
    console.log(`      ${file}`);
  }
}

if (otherPending.length > 0) {
  console.log('   ⚪ Other pending:');
  for (const file of otherPending) {
    console.log(`      ${file}`);
  }
}

console.log('\n' + '='.repeat(100));
console.log(`⏰ Last updated: ${new Date().toLocaleString()}`);
console.log('='.repeat(100) + '\n');

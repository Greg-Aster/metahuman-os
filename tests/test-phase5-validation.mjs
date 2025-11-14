#!/usr/bin/env node
/**
 * Phase 5 Validation Tests
 * Validates CLI commands and advanced features
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test results
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    failures.push({ name, error: error.message });
    failed++;
  }
}

console.log('\n=== Phase 5 Validation Tests ===\n');

// Test 1: persona.ts CLI command file exists
test('packages/cli/src/commands/persona.ts exists', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  if (!fs.existsSync(personaPath)) {
    throw new Error('persona.ts not found');
  }
});

// Test 2: persona.ts imports session-manager
test('persona.ts imports session-manager', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  const content = fs.readFileSync(personaPath, 'utf-8');

  if (!content.includes("from '@metahuman/core/persona/session-manager'")) {
    throw new Error('Does not import session-manager');
  }
});

// Test 3: persona.ts has personaGenerate function
test('persona.ts exports personaGenerate function', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  const content = fs.readFileSync(personaPath, 'utf-8');

  if (!content.includes('export async function personaGenerate(')) {
    throw new Error('personaGenerate function not found');
  }
});

// Test 4: personaGenerate supports --resume flag
test('personaGenerate supports --resume option', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  const content = fs.readFileSync(personaPath, 'utf-8');

  if (!content.includes('options.resume')) {
    throw new Error('Does not support resume option');
  }
});

// Test 5: persona.ts has personaSessions function
test('persona.ts exports personaSessions function', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  const content = fs.readFileSync(personaPath, 'utf-8');

  if (!content.includes('export async function personaSessions(')) {
    throw new Error('personaSessions function not found');
  }
});

// Test 6: persona.ts has personaView function
test('persona.ts exports personaView function', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  const content = fs.readFileSync(personaPath, 'utf-8');

  if (!content.includes('export async function personaView(')) {
    throw new Error('personaView function not found');
  }
});

// Test 7: persona.ts has personaApply function
test('persona.ts exports personaApply function', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  const content = fs.readFileSync(personaPath, 'utf-8');

  if (!content.includes('export async function personaApply(')) {
    throw new Error('personaApply function not found');
  }
});

// Test 8: persona.ts has personaDiscard function
test('persona.ts exports personaDiscard function', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  const content = fs.readFileSync(personaPath, 'utf-8');

  if (!content.includes('export async function personaDiscard(')) {
    throw new Error('personaDiscard function not found');
  }
});

// Test 9: persona.ts has personaCleanup function
test('persona.ts exports personaCleanup function', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  const content = fs.readFileSync(personaPath, 'utf-8');

  if (!content.includes('export async function personaCleanup(')) {
    throw new Error('personaCleanup function not found');
  }
});

// Test 10: personaCommand dispatches to all generator commands
test('personaCommand dispatches generate, sessions, view, apply, discard, cleanup', () => {
  const personaPath = path.join(__dirname, 'packages/cli/src/commands/persona.ts');
  const content = fs.readFileSync(personaPath, 'utf-8');

  const commands = ['generate', 'sessions', 'view', 'apply', 'discard', 'cleanup'];

  for (const cmd of commands) {
    if (!content.includes(`case '${cmd}':`)) {
      throw new Error(`Missing case for ${cmd} command`);
    }
  }
});

// Test 11: cleanup.ts module exists
test('packages/core/src/persona/cleanup.ts exists', () => {
  const cleanupPath = path.join(__dirname, 'packages/core/src/persona/cleanup.ts');
  if (!fs.existsSync(cleanupPath)) {
    throw new Error('cleanup.ts not found');
  }
});

// Test 12: cleanup.ts exports cleanupSessions
test('cleanup.ts exports cleanupSessions function', () => {
  const cleanupPath = path.join(__dirname, 'packages/core/src/persona/cleanup.ts');
  const content = fs.readFileSync(cleanupPath, 'utf-8');

  if (!content.includes('export async function cleanupSessions(')) {
    throw new Error('cleanupSessions function not exported');
  }
});

// Test 13: cleanup.ts exports previewCleanup
test('cleanup.ts exports previewCleanup function', () => {
  const cleanupPath = path.join(__dirname, 'packages/core/src/persona/cleanup.ts');
  const content = fs.readFileSync(cleanupPath, 'utf-8');

  if (!content.includes('export async function previewCleanup(')) {
    throw new Error('previewCleanup function not exported');
  }
});

// Test 14: cleanup.ts supports maxAgeInDays option
test('cleanup.ts supports maxAgeInDays option', () => {
  const cleanupPath = path.join(__dirname, 'packages/core/src/persona/cleanup.ts');
  const content = fs.readFileSync(cleanupPath, 'utf-8');

  if (!content.includes('maxAgeInDays')) {
    throw new Error('Does not support maxAgeInDays option');
  }
});

// Test 15: cleanup.ts supports dryRun option
test('cleanup.ts supports dryRun option', () => {
  const cleanupPath = path.join(__dirname, 'packages/core/src/persona/cleanup.ts');
  const content = fs.readFileSync(cleanupPath, 'utf-8');

  if (!content.includes('dryRun')) {
    throw new Error('Does not support dryRun option');
  }
});

// Test 16: cleanup.ts supports archiveBeforeDelete option
test('cleanup.ts supports archiveBeforeDelete option', () => {
  const cleanupPath = path.join(__dirname, 'packages/core/src/persona/cleanup.ts');
  const content = fs.readFileSync(cleanupPath, 'utf-8');

  if (!content.includes('archiveBeforeDelete')) {
    throw new Error('Does not support archiveBeforeDelete option');
  }
});

// Test 17: core index exports cleanup module
test('packages/core/src/index.ts exports cleanup module', () => {
  const indexPath = path.join(__dirname, 'packages/core/src/index.ts');
  const content = fs.readFileSync(indexPath, 'utf-8');

  if (!content.includes("from './persona/cleanup'")) {
    throw new Error('cleanup module not exported from core');
  }
});

// Test 18: PersonaGenerator has auto-resume notification
test('PersonaGenerator.svelte has auto-resume notification', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('showResumeNotification')) {
    throw new Error('Does not have showResumeNotification variable');
  }

  if (!content.includes('resume-notification')) {
    throw new Error('Does not have resume-notification UI element');
  }
});

// Test 19: Auto-resume checks localStorage and sessions
test('PersonaGenerator auto-resume checks localStorage and active sessions', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('localStorage.getItem')) {
    throw new Error('Does not check localStorage');
  }

  if (!content.includes("status === 'active'")) {
    throw new Error('Does not filter for active sessions');
  }
});

// Test 20: Auto-resume notification has Resume and Start Fresh actions
test('Auto-resume notification has resume and dismiss actions', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('Resume Interview')) {
    throw new Error('Missing Resume Interview button');
  }

  if (!content.includes('Start Fresh')) {
    throw new Error('Missing Start Fresh button');
  }

  if (!content.includes('localStorage.removeItem')) {
    throw new Error('Start Fresh does not clear localStorage');
  }
});

// Print results
console.log('\n' + '='.repeat(50));
console.log(`Total: ${passed + failed} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== Failures ===');
  failures.forEach(({ name, error }) => {
    console.log(`\n${name}:`);
    console.log(`  ${error}`);
  });
  process.exit(1);
} else {
  console.log('\n✓ All Phase 5 tests passed!');
  process.exit(0);
}

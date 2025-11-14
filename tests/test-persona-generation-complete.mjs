#!/usr/bin/env node
/**
 * Complete Persona Generation System Validation
 *
 * Validates all components of the persona generation system are in place:
 * - Backend modules (session-manager, question-generator, extractor, merger, cleanup)
 * - API endpoints (start, load, answer, finalize, apply, discard)
 * - UI components (PersonaGenerator, ReviewApplyDialog)
 * - CLI commands (persona generate, sessions, view, apply, discard, cleanup)
 * - Configuration (persona-generator.json, psychotherapist.json, models.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

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

console.log('\n' + '='.repeat(80));
console.log('COMPLETE PERSONA GENERATION SYSTEM VALIDATION');
console.log('='.repeat(80));
console.log('');

console.log('Backend Modules:');
console.log('-'.repeat(80));

test('session-manager.ts', () => {
  const filePath = path.join(rootDir, 'packages/core/src/persona/session-manager.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('question-generator.ts', () => {
  const filePath = path.join(rootDir, 'packages/core/src/persona/question-generator.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('extractor.ts', () => {
  const filePath = path.join(rootDir, 'packages/core/src/persona/extractor.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('merger.ts', () => {
  const filePath = path.join(rootDir, 'packages/core/src/persona/merger.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('cleanup.ts', () => {
  const filePath = path.join(rootDir, 'packages/core/src/persona/cleanup.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

console.log('');
console.log('API Endpoints:');
console.log('-'.repeat(80));

test('start.ts', () => {
  const filePath = path.join(rootDir, 'apps/site/src/pages/api/persona/generator/start.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('load.ts', () => {
  const filePath = path.join(rootDir, 'apps/site/src/pages/api/persona/generator/load.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('answer.ts', () => {
  const filePath = path.join(rootDir, 'apps/site/src/pages/api/persona/generator/answer.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('finalize.ts', () => {
  const filePath = path.join(rootDir, 'apps/site/src/pages/api/persona/generator/finalize.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('apply.ts', () => {
  const filePath = path.join(rootDir, 'apps/site/src/pages/api/persona/generator/apply.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('discard.ts', () => {
  const filePath = path.join(rootDir, 'apps/site/src/pages/api/persona/generator/discard.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

console.log('');
console.log('UI Components:');
console.log('-'.repeat(80));

test('PersonaGenerator.svelte', () => {
  const filePath = path.join(rootDir, 'apps/site/src/components/PersonaGenerator.svelte');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('ReviewApplyDialog.svelte', () => {
  const filePath = path.join(rootDir, 'apps/site/src/components/ReviewApplyDialog.svelte');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

console.log('');
console.log('CLI Commands:');
console.log('-'.repeat(80));

test('persona.ts (with generator commands)', () => {
  const filePath = path.join(rootDir, 'packages/cli/src/commands/persona.ts');
  if (!fs.existsSync(filePath)) throw new Error('File not found');

  const content = fs.readFileSync(filePath, 'utf-8');

  if (!content.includes('personaGenerate')) throw new Error('Missing personaGenerate');
  if (!content.includes('personaSessions')) throw new Error('Missing personaSessions');
  if (!content.includes('personaView')) throw new Error('Missing personaView');
  if (!content.includes('personaApply')) throw new Error('Missing personaApply');
  if (!content.includes('personaDiscard')) throw new Error('Missing personaDiscard');
  if (!content.includes('personaCleanup')) throw new Error('Missing personaCleanup');
});

console.log('');
console.log('Configuration Files:');
console.log('-'.repeat(80));

test('etc/persona-generator.json', () => {
  const filePath = path.join(rootDir, 'etc/persona-generator.json');
  if (!fs.existsSync(filePath)) throw new Error('File not found');

  const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!config.categories) throw new Error('Missing categories');
  if (!config.baselineQuestions) throw new Error('Missing baselineQuestions');
});

test('persona/profiles/psychotherapist.json', () => {
  const filePath = path.join(rootDir, 'persona/profiles/psychotherapist.json');
  if (!fs.existsSync(filePath)) throw new Error('File not found');

  const profile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!profile.role) throw new Error('Missing role');
  if (!profile.methodology) throw new Error('Missing methodology');
});

test('etc/models.json (psychotherapist role)', () => {
  const filePath = path.join(rootDir, 'etc/models.json');
  if (!fs.existsSync(filePath)) throw new Error('File not found');

  const models = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (!models.defaults.psychotherapist) throw new Error('Missing psychotherapist in defaults');
  if (!models.models['default.psychotherapist']) throw new Error('Missing default.psychotherapist model');
  if (!models.cognitiveModeMappings.dual.psychotherapist) throw new Error('Missing psychotherapist in dual mode');
  if (!models.cognitiveModeMappings.agent.psychotherapist) throw new Error('Missing psychotherapist in agent mode');
});

console.log('');
console.log('Validation Tests:');
console.log('-'.repeat(80));

test('test-phase0-validation.mjs', () => {
  const filePath = path.join(__dirname, 'test-phase0-validation.mjs');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('test-phase1-validation.mjs', () => {
  const filePath = path.join(__dirname, 'test-phase1-validation.mjs');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('test-phase2-validation.mjs', () => {
  const filePath = path.join(__dirname, 'test-phase2-validation.mjs');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('test-phase3-validation.mjs', () => {
  const filePath = path.join(__dirname, 'test-phase3-validation.mjs');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('test-phase4-validation.mjs', () => {
  const filePath = path.join(__dirname, 'test-phase4-validation.mjs');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

test('test-phase5-validation.mjs', () => {
  const filePath = path.join(__dirname, 'test-phase5-validation.mjs');
  if (!fs.existsSync(filePath)) throw new Error('File not found');
});

console.log('');
console.log('='.repeat(80));
console.log(`Total: ${passed + failed} checks`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log('='.repeat(80));

if (failed > 0) {
  console.log('\n=== Failures ===');
  failures.forEach(({ name, error }) => {
    console.log(`\n${name}:`);
    console.log(`  ${error}`);
  });
  process.exit(1);
} else {
  console.log('\n✓ COMPLETE SYSTEM VALIDATION PASSED!');
  console.log('');
  console.log('All persona generation components are in place:');
  console.log('  ✓ 5 backend modules');
  console.log('  ✓ 6 API endpoints');
  console.log('  ✓ 2 UI components');
  console.log('  ✓ 6 CLI commands');
  console.log('  ✓ 3 configuration files');
  console.log('  ✓ 6 phase validation tests');
  console.log('');
  process.exit(0);
}

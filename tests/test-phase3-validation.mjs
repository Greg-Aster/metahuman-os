#!/usr/bin/env node
/**
 * Phase 3 Validation Tests
 * Validates persona extraction, merging, and API endpoints
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

console.log('\n=== Phase 3 Validation Tests ===\n');

// Test 1: Extractor module exists
test('packages/core/src/persona/extractor.ts exists', () => {
  const extractorPath = path.join(__dirname, 'packages/core/src/persona/extractor.ts');
  if (!fs.existsSync(extractorPath)) {
    throw new Error('extractor.ts not found');
  }
});

// Test 2: Extractor exports key functions
test('extractor.ts exports extractPersonaFromTranscript and extractPersonaFromSession', () => {
  const extractorPath = path.join(__dirname, 'packages/core/src/persona/extractor.ts');
  const content = fs.readFileSync(extractorPath, 'utf-8');

  if (!content.includes('export async function extractPersonaFromTranscript')) {
    throw new Error('extractPersonaFromTranscript not exported');
  }

  if (!content.includes('export async function extractPersonaFromSession')) {
    throw new Error('extractPersonaFromSession not exported');
  }
});

// Test 3: Extractor defines PersonaDraft type
test('extractor.ts exports PersonaDraft type', () => {
  const extractorPath = path.join(__dirname, 'packages/core/src/persona/extractor.ts');
  const content = fs.readFileSync(extractorPath, 'utf-8');

  if (!content.includes('export interface PersonaDraft')) {
    throw new Error('PersonaDraft interface not exported');
  }
});

// Test 4: Merger module exists
test('packages/core/src/persona/merger.ts exists', () => {
  const mergerPath = path.join(__dirname, 'packages/core/src/persona/merger.ts');
  if (!fs.existsSync(mergerPath)) {
    throw new Error('merger.ts not found');
  }
});

// Test 5: Merger exports key functions
test('merger.ts exports mergePersonaDraft, loadExistingPersona, savePersona, generateDiffText', () => {
  const mergerPath = path.join(__dirname, 'packages/core/src/persona/merger.ts');
  const content = fs.readFileSync(mergerPath, 'utf-8');

  const requiredExports = [
    'export function mergePersonaDraft',
    'export function loadExistingPersona',
    'export function savePersona',
    'export function generateDiffText',
  ];

  for (const exportName of requiredExports) {
    if (!content.includes(exportName)) {
      throw new Error(`${exportName} not found`);
    }
  }
});

// Test 6: Merger defines types
test('merger.ts exports MergeStrategy, DiffEntry, PersonaDiff types', () => {
  const mergerPath = path.join(__dirname, 'packages/core/src/persona/merger.ts');
  const content = fs.readFileSync(mergerPath, 'utf-8');

  const requiredTypes = [
    'export type MergeStrategy',
    'export interface DiffEntry',
    'export interface PersonaDiff',
  ];

  for (const typeName of requiredTypes) {
    if (!content.includes(typeName)) {
      throw new Error(`${typeName} not found`);
    }
  }
});

// Test 7: Onboarding extract-persona.ts refactored to use shared extractor
test('onboarding extract-persona.ts imports from extractor and merger', () => {
  const onboardingPath = path.join(__dirname, 'apps/site/src/pages/api/onboarding/extract-persona.ts');
  const content = fs.readFileSync(onboardingPath, 'utf-8');

  if (!content.includes("from '@metahuman/core/persona/extractor'")) {
    throw new Error('Does not import from extractor module');
  }

  if (!content.includes("from '@metahuman/core/persona/merger'")) {
    throw new Error('Does not import from merger module');
  }
});

// Test 8: Onboarding extract-persona.ts uses shared functions
test('onboarding extract-persona.ts uses extractPersonaFromTranscript, mergePersonaDraft, savePersona', () => {
  const onboardingPath = path.join(__dirname, 'apps/site/src/pages/api/onboarding/extract-persona.ts');
  const content = fs.readFileSync(onboardingPath, 'utf-8');

  const requiredFunctions = [
    'extractPersonaFromTranscript',
    'loadExistingPersona',
    'mergePersonaDraft',
    'savePersona',
  ];

  for (const funcName of requiredFunctions) {
    if (!content.includes(funcName)) {
      throw new Error(`Does not use ${funcName}`);
    }
  }
});

// Test 9: Finalize API endpoint exists
test('apps/site/src/pages/api/persona/generator/finalize.ts exists', () => {
  const finalizePath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/finalize.ts');
  if (!fs.existsSync(finalizePath)) {
    throw new Error('finalize.ts not found');
  }
});

// Test 10: Finalize endpoint uses extractor and merger
test('finalize.ts imports and uses extractPersonaFromSession, mergePersonaDraft', () => {
  const finalizePath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/finalize.ts');
  const content = fs.readFileSync(finalizePath, 'utf-8');

  if (!content.includes('extractPersonaFromSession')) {
    throw new Error('Does not use extractPersonaFromSession');
  }

  if (!content.includes('mergePersonaDraft')) {
    throw new Error('Does not use mergePersonaDraft');
  }

  if (!content.includes('generateDiffText')) {
    throw new Error('Does not use generateDiffText');
  }
});

// Test 11: Apply API endpoint exists
test('apps/site/src/pages/api/persona/generator/apply.ts exists', () => {
  const applyPath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/apply.ts');
  if (!fs.existsSync(applyPath)) {
    throw new Error('apply.ts not found');
  }
});

// Test 12: Apply endpoint uses merger functions
test('apply.ts imports and uses mergePersonaDraft, savePersona', () => {
  const applyPath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/apply.ts');
  const content = fs.readFileSync(applyPath, 'utf-8');

  if (!content.includes('mergePersonaDraft')) {
    throw new Error('Does not use mergePersonaDraft');
  }

  if (!content.includes('savePersona')) {
    throw new Error('Does not use savePersona');
  }

  if (!content.includes('loadExistingPersona')) {
    throw new Error('Does not use loadExistingPersona');
  }
});

// Test 13: Apply endpoint validates merge strategy
test('apply.ts validates merge strategy (replace, merge, append)', () => {
  const applyPath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/apply.ts');
  const content = fs.readFileSync(applyPath, 'utf-8');

  if (!content.includes("'replace', 'merge', 'append'")) {
    throw new Error('Does not validate merge strategy options');
  }
});

// Test 14: Apply endpoint creates backup before applying
test('apply.ts creates backup before applying changes', () => {
  const applyPath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/apply.ts');
  const content = fs.readFileSync(applyPath, 'utf-8');

  if (!content.includes('backupDir') || !content.includes('backupPath')) {
    throw new Error('Does not create backup before applying');
  }
});

// Test 15: Core package exports persona modules
test('packages/core/src/index.ts exports persona modules', () => {
  const indexPath = path.join(__dirname, 'packages/core/src/index.ts');
  const content = fs.readFileSync(indexPath, 'utf-8');

  const requiredExports = [
    "./persona/session-manager",
    "./persona/question-generator",
    "./persona/extractor",
    "./persona/merger",
  ];

  for (const exportPath of requiredExports) {
    if (!content.includes(exportPath)) {
      throw new Error(`Missing export for ${exportPath}`);
    }
  }
});

// Test 16: Finalize endpoint supports training data export
test('finalize.ts supports copyToTraining option', () => {
  const finalizePath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/finalize.ts');
  const content = fs.readFileSync(finalizePath, 'utf-8');

  if (!content.includes('copyToTraining')) {
    throw new Error('Does not support copyToTraining option');
  }

  if (!content.includes('persona-interviews')) {
    throw new Error('Does not export to training directory');
  }
});

// Test 17: Finalize endpoint saves summary.json
test('finalize.ts saves summary.json to session directory', () => {
  const finalizePath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/finalize.ts');
  const content = fs.readFileSync(finalizePath, 'utf-8');

  if (!content.includes('summary.json')) {
    throw new Error('Does not save summary.json');
  }
});

// Test 18: Finalize endpoint marks session as finalized
test('finalize.ts marks session status as finalized', () => {
  const finalizePath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/finalize.ts');
  const content = fs.readFileSync(finalizePath, 'utf-8');

  if (!content.includes("status === 'finalized'") && !content.includes("status = 'finalized'")) {
    throw new Error('Does not handle finalized status');
  }
});

// Test 19: Apply endpoint marks session as applied
test('apply.ts marks session status as applied', () => {
  const applyPath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/apply.ts');
  const content = fs.readFileSync(applyPath, 'utf-8');

  if (!content.includes("status = 'applied'")) {
    throw new Error('Does not mark session as applied');
  }
});

// Test 20: Apply endpoint verifies session is finalized before applying
test('apply.ts verifies session is finalized before applying', () => {
  const applyPath = path.join(__dirname, 'apps/site/src/pages/api/persona/generator/apply.ts');
  const content = fs.readFileSync(applyPath, 'utf-8');

  if (!content.includes("status !== 'finalized'")) {
    throw new Error('Does not verify session is finalized');
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
  console.log('\n✓ All Phase 3 tests passed!');
  process.exit(0);
}

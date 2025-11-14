#!/usr/bin/env node
/**
 * Phase 4 Validation Tests
 * Validates UI integration for persona generator
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

console.log('\n=== Phase 4 Validation Tests ===\n');

// Test 1: PersonaGenerator component exists
test('apps/site/src/components/PersonaGenerator.svelte exists', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  if (!fs.existsSync(componentPath)) {
    throw new Error('PersonaGenerator.svelte not found');
  }
});

// Test 2: PersonaGenerator imports ReviewApplyDialog
test('PersonaGenerator.svelte imports ReviewApplyDialog', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes("import ReviewApplyDialog from './ReviewApplyDialog.svelte'")) {
    throw new Error('Does not import ReviewApplyDialog');
  }
});

// Test 3: PersonaGenerator has start session functionality
test('PersonaGenerator.svelte has startNewSession function', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('async function startNewSession()')) {
    throw new Error('startNewSession function not found');
  }

  if (!content.includes('/api/persona/generator/start')) {
    throw new Error('Does not call start API endpoint');
  }
});

// Test 4: PersonaGenerator has resume session functionality
test('PersonaGenerator.svelte has resumeSession function', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('async function resumeSession(')) {
    throw new Error('resumeSession function not found');
  }

  if (!content.includes('/api/persona/generator/load')) {
    throw new Error('Does not call load API endpoint');
  }
});

// Test 5: PersonaGenerator has answer submission
test('PersonaGenerator.svelte has submitAnswer function', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('async function submitAnswer()')) {
    throw new Error('submitAnswer function not found');
  }

  if (!content.includes('/api/persona/generator/answer')) {
    throw new Error('Does not call answer API endpoint');
  }
});

// Test 6: PersonaGenerator has finalize functionality
test('PersonaGenerator.svelte has finalizeSession function', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('async function finalizeSession()')) {
    throw new Error('finalizeSession function not found');
  }

  if (!content.includes('/api/persona/generator/finalize')) {
    throw new Error('Does not call finalize API endpoint');
  }
});

// Test 7: PersonaGenerator has apply functionality
test('PersonaGenerator.svelte has handleApply function', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('async function handleApply(')) {
    throw new Error('handleApply function not found');
  }

  if (!content.includes('/api/persona/generator/apply')) {
    throw new Error('Does not call apply API endpoint');
  }
});

// Test 8: PersonaGenerator has discard functionality
test('PersonaGenerator.svelte has discardSession function', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('async function discardSession()')) {
    throw new Error('discardSession function not found');
  }

  if (!content.includes('/api/persona/generator/discard')) {
    throw new Error('Does not call discard API endpoint');
  }
});

// Test 9: PersonaGenerator displays progress meter
test('PersonaGenerator.svelte displays category coverage progress', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('categoryCoverage')) {
    throw new Error('Does not reference categoryCoverage');
  }

  if (!content.includes('progress-bar')) {
    throw new Error('Does not have progress bar UI');
  }
});

// Test 10: PersonaGenerator uses localStorage for session persistence
test('PersonaGenerator.svelte persists session to localStorage', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/PersonaGenerator.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('localStorage.setItem')) {
    throw new Error('Does not save to localStorage');
  }

  if (!content.includes('persona-generator-session')) {
    throw new Error('Does not use expected localStorage key');
  }
});

// Test 11: ReviewApplyDialog component exists
test('apps/site/src/components/ReviewApplyDialog.svelte exists', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/ReviewApplyDialog.svelte');
  if (!fs.existsSync(componentPath)) {
    throw new Error('ReviewApplyDialog.svelte not found');
  }
});

// Test 12: ReviewApplyDialog accepts reviewData prop
test('ReviewApplyDialog.svelte has reviewData prop', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/ReviewApplyDialog.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('export let reviewData')) {
    throw new Error('reviewData prop not exported');
  }
});

// Test 13: ReviewApplyDialog has merge strategy selector
test('ReviewApplyDialog.svelte has merge strategy selector', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/ReviewApplyDialog.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('selectedStrategy')) {
    throw new Error('Does not have selectedStrategy variable');
  }

  const strategies = ['replace', 'merge', 'append'];
  for (const strategy of strategies) {
    if (!content.includes(strategy)) {
      throw new Error(`Does not include ${strategy} strategy`);
    }
  }
});

// Test 14: ReviewApplyDialog displays diff preview
test('ReviewApplyDialog.svelte displays diff information', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/ReviewApplyDialog.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('diff.summary')) {
    throw new Error('Does not display diff summary');
  }

  if (!content.includes('diff.changes')) {
    throw new Error('Does not display diff changes');
  }
});

// Test 15: ReviewApplyDialog has apply and discard actions
test('ReviewApplyDialog.svelte has onApply and onDiscard callbacks', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/ReviewApplyDialog.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('export let onApply')) {
    throw new Error('onApply callback not exported');
  }

  if (!content.includes('export let onDiscard')) {
    throw new Error('onDiscard callback not exported');
  }
});

// Test 16: CenterContent imports PersonaGenerator
test('CenterContent.svelte imports PersonaGenerator', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/CenterContent.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes("import PersonaGenerator from './PersonaGenerator.svelte'")) {
    throw new Error('Does not import PersonaGenerator');
  }
});

// Test 17: CenterContent has generator tab
test('CenterContent.svelte has generator in systemTab type and tab buttons', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/CenterContent.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes("'generator'")) {
    throw new Error('generator not in systemTab type');
  }

  if (!content.includes("systemTab==='generator'")) {
    throw new Error('generator tab button not found');
  }
});

// Test 18: CenterContent renders PersonaGenerator
test('CenterContent.svelte renders PersonaGenerator when generator tab active', () => {
  const componentPath = path.join(__dirname, 'apps/site/src/components/CenterContent.svelte');
  const content = fs.readFileSync(componentPath, 'utf-8');

  if (!content.includes('<PersonaGenerator />')) {
    throw new Error('PersonaGenerator component not rendered');
  }

  // Check it's in the right conditional block
  if (!content.match(/systemTab === 'generator'[\s\S]*?<PersonaGenerator/)) {
    throw new Error('PersonaGenerator not rendered in generator tab conditional');
  }
});

// Test 19: psychotherapist in etc/models.json
test('etc/models.json includes psychotherapist role', () => {
  const modelsPath = path.join(__dirname, 'etc/models.json');
  const content = fs.readFileSync(modelsPath, 'utf-8');
  const models = JSON.parse(content);

  if (!models.defaults.psychotherapist) {
    throw new Error('psychotherapist not in defaults');
  }

  if (!models.models['default.psychotherapist']) {
    throw new Error('default.psychotherapist model not defined');
  }
});

// Test 20: psychotherapist in cognitive mode mappings (dual and agent)
test('etc/models.json includes psychotherapist in dual and agent modes', () => {
  const modelsPath = path.join(__dirname, 'etc/models.json');
  const content = fs.readFileSync(modelsPath, 'utf-8');
  const models = JSON.parse(content);

  // Psychotherapist should be in dual and agent modes
  // Emulation mode is minimal (chat-only) and doesn't need psychotherapist
  const modes = ['dual', 'agent'];
  for (const mode of modes) {
    if (!models.cognitiveModeMappings[mode].psychotherapist) {
      throw new Error(`psychotherapist not in ${mode} mode mapping`);
    }
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
  console.log('\n✓ All Phase 4 tests passed!');
  process.exit(0);
}

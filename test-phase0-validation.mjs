#!/usr/bin/env node
/**
 * Phase 0 Validation Test
 * Tests all Phase 0 implementation criteria
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

console.log('🧪 Testing Phase 0 Validation Criteria\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}\n`);
    failed++;
  }
}

// Test 1: etc/persona-generator.json loads successfully
test('etc/persona-generator.json loads successfully', () => {
  const configPath = path.join(ROOT, 'etc', 'persona-generator.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  if (!config.baselineQuestions || config.baselineQuestions.length === 0) {
    throw new Error('baselineQuestions missing or empty');
  }
  if (!config.categories || config.categories.length === 0) {
    throw new Error('categories missing or empty');
  }
  if (typeof config.maxQuestionsPerSession !== 'number') {
    throw new Error('maxQuestionsPerSession must be a number');
  }
});

// Test 2: psychotherapist role in etc/models.json
test('psychotherapist role defined in etc/models.json', () => {
  const modelsPath = path.join(ROOT, 'etc', 'models.json');
  const models = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));

  if (!models.defaults.psychotherapist) {
    throw new Error('psychotherapist not in defaults');
  }
  if (!models.models['default.psychotherapist']) {
    throw new Error('default.psychotherapist model not defined');
  }
  if (!models.roleHierarchy.psychotherapist) {
    throw new Error('psychotherapist not in roleHierarchy');
  }
  if (!models.cognitiveModeMappings.dual.psychotherapist) {
    throw new Error('psychotherapist not in dual cognitive mode');
  }
  if (!models.cognitiveModeMappings.agent.psychotherapist) {
    throw new Error('psychotherapist not in agent cognitive mode');
  }
});

// Test 3: persona/profiles/psychotherapist.json exists and is valid
test('persona/profiles/psychotherapist.json exists and is valid', () => {
  const profilePath = path.join(ROOT, 'persona', 'profiles', 'psychotherapist.json');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));

  if (profile.role !== 'psychotherapist') {
    throw new Error('role field must be "psychotherapist"');
  }
  if (!profile.interviewingTechniques) {
    throw new Error('interviewingTechniques missing');
  }
  if (!profile.privacyAndEthics) {
    throw new Error('privacyAndEthics missing');
  }
});

// Test 4: paths.ts includes personaInterviews (check source code)
test('paths.ts includes personaInterviews paths', () => {
  const pathsFile = path.join(ROOT, 'packages', 'core', 'src', 'paths.ts');
  const content = fs.readFileSync(pathsFile, 'utf-8');

  if (!content.includes('personaInterviews')) {
    throw new Error('personaInterviews not found in paths.ts');
  }
  if (!content.includes('personaInterviewsIndex')) {
    throw new Error('personaInterviewsIndex not found in paths.ts');
  }

  // Check it appears in both getProfilePaths and rootPaths
  const getProfilePathsMatch = /personaInterviews:\s*path\.join\(profileRoot,/;
  const rootPathsMatch = /personaInterviews:\s*path\.join\(ROOT,/;

  if (!getProfilePathsMatch.test(content)) {
    throw new Error('personaInterviews not in getProfilePaths()');
  }
  if (!rootPathsMatch.test(content)) {
    throw new Error('personaInterviews not in rootPaths fallback');
  }
});

// Test 5: model-resolver.ts includes psychotherapist in ModelRole union
test('model-resolver.ts includes psychotherapist in ModelRole', () => {
  const resolverFile = path.join(ROOT, 'packages', 'core', 'src', 'model-resolver.ts');
  const content = fs.readFileSync(resolverFile, 'utf-8');

  // Check for psychotherapist in the ModelRole union type
  const modelRoleRegex = /export\s+type\s+ModelRole\s*=\s*[^;]+\bpsychotherapist\b[^;]+;/;
  if (!modelRoleRegex.test(content)) {
    throw new Error('psychotherapist not found in ModelRole union type');
  }
});

// Test 6: Create test profile directory structure
test('Can create persona/interviews directory structure', () => {
  const testProfile = path.join(ROOT, 'profiles', 'test-phase0');
  const interviewsDir = path.join(testProfile, 'persona', 'interviews');

  // Create directory
  fs.mkdirSync(interviewsDir, { recursive: true });

  // Verify it exists
  if (!fs.existsSync(interviewsDir)) {
    throw new Error('Failed to create interviews directory');
  }

  // Cleanup
  fs.rmSync(testProfile, { recursive: true, force: true });
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  console.log('❌ Phase 0 validation FAILED');
  process.exit(1);
} else {
  console.log('✅ Phase 0 validation PASSED - Ready for Phase 1!');
  process.exit(0);
}

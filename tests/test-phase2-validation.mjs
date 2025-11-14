#!/usr/bin/env node
/**
 * Phase 2 Validation Test
 * Tests question generation and LLM integration functionality
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

console.log('🧪 Testing Phase 2 Validation Criteria\n');

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

// Test 1: question-generator.ts exists with required exports
test('question-generator.ts exists with required exports', () => {
  const generatorPath = path.join(ROOT, 'packages', 'core', 'src', 'persona', 'question-generator.ts');
  if (!fs.existsSync(generatorPath)) {
    throw new Error('question-generator.ts not found');
  }

  const content = fs.readFileSync(generatorPath, 'utf-8');

  const requiredExports = ['generateNextQuestion', 'getCompletionStatus'];
  for (const exportName of requiredExports) {
    if (!content.includes(`export async function ${exportName}`) && !content.includes(`export function ${exportName}`)) {
      throw new Error(`${exportName} function not found or not exported`);
    }
  }
});

// Test 2: question-generator exported from core index
test('question-generator exported from @metahuman/core', () => {
  const indexPath = path.join(ROOT, 'packages', 'core', 'src', 'index.ts');
  const content = fs.readFileSync(indexPath, 'utf-8');

  if (!content.includes("export * from './persona/question-generator'")) {
    throw new Error('question-generator not exported from core index.ts');
  }
});

// Test 3: question-generator uses psychotherapist role
test('question-generator uses psychotherapist role', () => {
  const generatorPath = path.join(ROOT, 'packages', 'core', 'src', 'persona', 'question-generator.ts');
  const content = fs.readFileSync(generatorPath, 'utf-8');

  if (!content.includes("role: 'psychotherapist'")) {
    throw new Error('question-generator not using psychotherapist role');
  }

  if (!content.includes('callLLM')) {
    throw new Error('question-generator not calling LLM');
  }
});

// Test 4: question-generator loads configuration
test('question-generator loads persona-generator.json config', () => {
  const generatorPath = path.join(ROOT, 'packages', 'core', 'src', 'persona', 'question-generator.ts');
  const content = fs.readFileSync(generatorPath, 'utf-8');

  if (!content.includes('persona-generator.json')) {
    throw new Error('question-generator not loading configuration file');
  }

  if (!content.includes('maxQuestionsPerSession')) {
    throw new Error('question-generator not using maxQuestionsPerSession config');
  }
});

// Test 5: question-generator loads psychotherapist profile
test('question-generator loads psychotherapist profile', () => {
  const generatorPath = path.join(ROOT, 'packages', 'core', 'src', 'persona', 'question-generator.ts');
  const content = fs.readFileSync(generatorPath, 'utf-8');

  if (!content.includes('psychotherapist.json')) {
    throw new Error('question-generator not loading psychotherapist profile');
  }
});

// Test 6: question-generator identifies category gaps
test('question-generator has category gap detection', () => {
  const generatorPath = path.join(ROOT, 'packages', 'core', 'src', 'persona', 'question-generator.ts');
  const content = fs.readFileSync(generatorPath, 'utf-8');

  if (!content.includes('identifyCategoryGaps')) {
    throw new Error('question-generator missing category gap detection');
  }

  if (!content.includes('categoryCoverage')) {
    throw new Error('question-generator not tracking category coverage');
  }
});

// Test 7: answer.ts API route exists
test('answer.ts API route exists', () => {
  const answerPath = path.join(ROOT, 'apps', 'site', 'src', 'pages', 'api', 'persona', 'generator', 'answer.ts');
  if (!fs.existsSync(answerPath)) {
    throw new Error('answer.ts not found');
  }
});

// Test 8: answer.ts uses question generator
test('answer.ts integrates question generator', () => {
  const answerPath = path.join(ROOT, 'apps', 'site', 'src', 'pages', 'api', 'persona', 'generator', 'answer.ts');
  const content = fs.readFileSync(answerPath, 'utf-8');

  if (!content.includes('generateNextQuestion')) {
    throw new Error('answer.ts not calling generateNextQuestion');
  }

  if (!content.includes('recordAnswer')) {
    throw new Error('answer.ts not recording answers');
  }

  if (!content.includes('getCompletionStatus')) {
    throw new Error('answer.ts not checking completion status');
  }
});

// Test 9: answer.ts validates authentication and ownership
test('answer.ts has proper security checks', () => {
  const answerPath = path.join(ROOT, 'apps', 'site', 'src', 'pages', 'api', 'persona', 'generator', 'answer.ts');
  const content = fs.readFileSync(answerPath, 'utf-8');

  if (!content.includes('withUserContext')) {
    throw new Error('answer.ts missing withUserContext wrapper');
  }

  if (!content.includes('tryResolveProfilePath')) {
    throw new Error('answer.ts missing path safety check');
  }

  if (!content.includes('session.userId !== ctx.userId')) {
    throw new Error('answer.ts missing session ownership check');
  }

  if (!content.includes("session.status !== 'active'")) {
    throw new Error('answer.ts not checking session status');
  }
});

// Test 10: answer.ts handles completion correctly
test('answer.ts marks sessions as completed', () => {
  const answerPath = path.join(ROOT, 'apps', 'site', 'src', 'pages', 'api', 'persona', 'generator', 'answer.ts');
  const content = fs.readFileSync(answerPath, 'utf-8');

  if (!content.includes("status.isComplete")) {
    throw new Error('answer.ts not checking isComplete status');
  }

  if (!content.includes("'completed'")) {
    throw new Error('answer.ts not marking sessions as completed');
  }
});

// Test 11: psychotherapist prompt file exists
test('psychotherapist reasoning prompt exists', () => {
  const promptPath = path.join(ROOT, 'packages', 'core', 'src', 'reasoning', 'prompts', 'psychotherapist.ts');
  if (!fs.existsSync(promptPath)) {
    throw new Error('psychotherapist.ts prompt file not found');
  }

  const content = fs.readFileSync(promptPath, 'utf-8');

  if (!content.includes('psychotherapistSystemPrompt')) {
    throw new Error('psychotherapistSystemPrompt export not found');
  }

  // Check for key interviewing concepts
  const keyPhrases = [
    'motivational interviewing',
    'open-ended',
    'reflective listening',
    'category',
    'privacy',
  ];

  for (const phrase of keyPhrases) {
    if (!content.toLowerCase().includes(phrase.toLowerCase())) {
      throw new Error(`Prompt missing key concept: ${phrase}`);
    }
  }
});

// Test 12: reasoning config supports custom models
test('reasoning config supports configurable models', () => {
  const configPath = path.join(ROOT, 'packages', 'core', 'src', 'reasoning', 'config.ts');
  const content = fs.readFileSync(configPath, 'utf-8');

  if (!content.includes('overrides.planningModel')) {
    throw new Error('reasoning config not supporting custom planningModel');
  }

  if (!content.includes('overrides.responseModel')) {
    throw new Error('reasoning config not supporting custom responseModel');
  }
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  console.log('❌ Phase 2 validation FAILED');
  process.exit(1);
} else {
  console.log('✅ Phase 2 validation PASSED - Ready for Phase 3!');
  console.log('\n📝 Next Steps:');
  console.log('   • Test LLM question generation with actual API calls');
  console.log('   • Verify category coverage tracking works correctly');
  console.log('   • Test interview completion detection');
  console.log('   • Proceed to Phase 3 (Persona Extraction & Merging)\n');
  process.exit(0);
}

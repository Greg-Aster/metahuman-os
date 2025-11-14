#!/usr/bin/env node
/**
 * Phase 1 Validation Test
 * Tests session storage and management functionality
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

console.log('🧪 Testing Phase 1 Validation Criteria\n');

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

// Test 1: session-manager.ts exists and exports required functions
test('session-manager.ts exists with required exports', () => {
  const sessionManagerPath = path.join(ROOT, 'packages', 'core', 'src', 'persona', 'session-manager.ts');
  if (!fs.existsSync(sessionManagerPath)) {
    throw new Error('session-manager.ts not found');
  }

  const content = fs.readFileSync(sessionManagerPath, 'utf-8');

  const requiredExports = [
    'startSession',
    'loadSession',
    'saveSession',
    'listSessions',
    'discardSession',
    'addQuestion',
    'recordAnswer',
  ];

  for (const exportName of requiredExports) {
    if (!content.includes(`export async function ${exportName}`)) {
      throw new Error(`${exportName} function not found or not exported`);
    }
  }

  // Check TypeScript interfaces
  const requiredInterfaces = ['Session', 'Question', 'Answer', 'SessionIndex', 'CategoryCoverage'];
  for (const interfaceName of requiredInterfaces) {
    if (!content.includes(`export interface ${interfaceName}`)) {
      throw new Error(`${interfaceName} interface not found or not exported`);
    }
  }
});

// Test 2: session-manager exported from core index
test('session-manager exported from @metahuman/core', () => {
  const indexPath = path.join(ROOT, 'packages', 'core', 'src', 'index.ts');
  const content = fs.readFileSync(indexPath, 'utf-8');

  if (!content.includes("export * from './persona/session-manager'")) {
    throw new Error('session-manager not exported from core index.ts');
  }
});

// Test 3: API routes exist
test('API routes exist (start, load, discard)', () => {
  const apiDir = path.join(ROOT, 'apps', 'site', 'src', 'pages', 'api', 'persona', 'generator');

  const requiredRoutes = ['start.ts', 'load.ts', 'discard.ts'];
  for (const route of requiredRoutes) {
    const routePath = path.join(apiDir, route);
    if (!fs.existsSync(routePath)) {
      throw new Error(`${route} not found`);
    }
  }
});

// Test 4: start.ts uses withUserContext and tryResolveProfilePath
test('start.ts has proper authentication and path safety', () => {
  const startPath = path.join(ROOT, 'apps', 'site', 'src', 'pages', 'api', 'persona', 'generator', 'start.ts');
  const content = fs.readFileSync(startPath, 'utf-8');

  if (!content.includes('withUserContext')) {
    throw new Error('start.ts missing withUserContext wrapper');
  }
  if (!content.includes('tryResolveProfilePath')) {
    throw new Error('start.ts missing tryResolveProfilePath call');
  }
  if (!content.includes("ctx.role === 'anonymous'")) {
    throw new Error('start.ts missing anonymous user check');
  }
});

// Test 5: load.ts has session ownership validation
test('load.ts validates session ownership', () => {
  const loadPath = path.join(ROOT, 'apps', 'site', 'src', 'pages', 'api', 'persona', 'generator', 'load.ts');
  const content = fs.readFileSync(loadPath, 'utf-8');

  if (!content.includes('session.userId !== ctx.userId')) {
    throw new Error('load.ts missing session ownership check');
  }
  if (!content.includes('withUserContext')) {
    throw new Error('load.ts missing withUserContext wrapper');
  }
});

// Test 6: discard.ts has proper authorization
test('discard.ts has proper authorization checks', () => {
  const discardPath = path.join(ROOT, 'apps', 'site', 'src', 'pages', 'api', 'persona', 'generator', 'discard.ts');
  const content = fs.readFileSync(discardPath, 'utf-8');

  if (!content.includes('tryResolveProfilePath')) {
    throw new Error('discard.ts missing path safety check');
  }
  if (!content.includes('session.userId !== ctx.userId')) {
    throw new Error('discard.ts missing session ownership check');
  }
});

// Test 7: Session directory structure can be created
test('Can create session directory structure', () => {
  const testProfile = path.join(ROOT, 'profiles', 'test-phase1');
  const interviewsDir = path.join(testProfile, 'persona', 'interviews');

  // Create directory
  fs.mkdirSync(interviewsDir, { recursive: true });

  // Create test session file
  const testSession = {
    sessionId: 'test-session-123',
    userId: 'test-user',
    username: 'testuser',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [],
    answers: [],
    categoryCoverage: {
      values: 0,
      goals: 0,
      style: 0,
      biography: 0,
      current_focus: 0,
    },
  };

  const sessionPath = path.join(interviewsDir, 'test-session-123.json');
  fs.writeFileSync(sessionPath, JSON.stringify(testSession, null, 2), 'utf-8');

  // Verify it exists and can be read
  if (!fs.existsSync(sessionPath)) {
    throw new Error('Failed to create session file');
  }

  const loaded = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
  if (loaded.sessionId !== 'test-session-123') {
    throw new Error('Session data corrupted');
  }

  // Create index file
  const indexPath = path.join(interviewsDir, 'index.json');
  const index = {
    latestSessionId: 'test-session-123',
    totalSessions: 1,
    completedCount: 0,
    sessions: [
      {
        sessionId: 'test-session-123',
        status: 'active',
        createdAt: testSession.createdAt,
        updatedAt: testSession.updatedAt,
        questionCount: 0,
        answerCount: 0,
      },
    ],
  };

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  if (!fs.existsSync(indexPath)) {
    throw new Error('Failed to create index file');
  }

  // Cleanup
  fs.rmSync(testProfile, { recursive: true, force: true });
});

// Test 8: session-manager uses audit logging
test('session-manager uses audit logging', () => {
  const sessionManagerPath = path.join(ROOT, 'packages', 'core', 'src', 'persona', 'session-manager.ts');
  const content = fs.readFileSync(sessionManagerPath, 'utf-8');

  if (!content.includes("import { audit }")) {
    throw new Error('session-manager missing audit import');
  }

  const requiredAuditActions = ['session_started', 'session_aborted', 'question_asked', 'answer_recorded'];
  for (const action of requiredAuditActions) {
    if (!content.includes(action)) {
      throw new Error(`Missing audit action: ${action}`);
    }
  }
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  console.log('❌ Phase 1 validation FAILED');
  process.exit(1);
} else {
  console.log('✅ Phase 1 validation PASSED - Ready for Phase 2!');
  console.log('\n📝 Next Steps:');
  console.log('   • Test API endpoints with actual HTTP requests');
  console.log('   • Verify multi-user session isolation');
  console.log('   • Test session index updates');
  console.log('   • Proceed to Phase 2 (LLM Integration)\n');
  process.exit(0);
}

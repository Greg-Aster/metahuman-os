#!/usr/bin/env node
/**
 * Phase 5: Integration Tests for Security Policy
 *
 * Tests the actual HTTP endpoints with security policy applied:
 * - /api/security/policy (policy retrieval)
 * - /api/operator (protected by requireOperatorMode middleware)
 * - /api/cognitive-mode (mode switching)
 */

import { saveCognitiveMode } from '../packages/core/src/cognitive-mode.ts';

console.log('\n' + '='.repeat(70));
console.log('Phase 5: Security Policy Integration Tests');
console.log('='.repeat(70) + '\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    failed++;
  }
}

/**
 * Helper to make API calls
 */
async function apiCall(endpoint, options = {}) {
  const url = `http://localhost:4321${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { status: response.status, body };
}

// ============================================================================
// Setup: Check if dev server is running
// ============================================================================

console.log('[Setup] Checking if dev server is running...\n');

try {
  const { status } = await apiCall('/api/status');
  if (status !== 200) {
    console.error('❌ Dev server not responding correctly');
    console.error('Please start dev server: cd apps/site && pnpm dev');
    process.exit(1);
  }
  console.log('✓ Dev server is running\n');
} catch (error) {
  console.error('❌ Dev server is not running');
  console.error('Please start dev server: cd apps/site && pnpm dev');
  console.error(`Error: ${error.message}\n`);
  process.exit(1);
}

// ============================================================================
// Test 1: Security Policy Endpoint
// ============================================================================

console.log('[1/4] Testing /api/security/policy Endpoint...\n');

await test('Policy endpoint returns 200 OK', async () => {
  const { status } = await apiCall('/api/security/policy');
  assertEquals(status, 200, 'Should return 200 OK');
});

await test('Policy response has correct structure', async () => {
  const { body } = await apiCall('/api/security/policy');
  assert(body.success, 'Response should have success=true');
  assert(body.policy, 'Response should have policy object');
  assert(typeof body.policy.canWriteMemory === 'boolean', 'Should have canWriteMemory');
  assert(typeof body.policy.canUseOperator === 'boolean', 'Should have canUseOperator');
  assert(body.policy.mode, 'Should have mode field');
  assert(body.policy.role, 'Should have role field');
});

await test('Policy reflects dual mode correctly', async () => {
  saveCognitiveMode('dual', 'test');
  // Wait a moment for file system
  await new Promise(resolve => setTimeout(resolve, 100));

  const { body } = await apiCall('/api/security/policy');
  assertEquals(body.policy.mode, 'dual', 'Mode should be dual');
  assertEquals(body.policy.canWriteMemory, true, 'Dual mode should allow writes');
  assertEquals(body.policy.canUseOperator, true, 'Dual mode should allow operator');
});

await test('Policy reflects emulation mode correctly', async () => {
  saveCognitiveMode('emulation', 'test');
  await new Promise(resolve => setTimeout(resolve, 100));

  const { body } = await apiCall('/api/security/policy');
  assertEquals(body.policy.mode, 'emulation', 'Mode should be emulation');
  assertEquals(body.policy.canWriteMemory, false, 'Emulation should block writes');
  assertEquals(body.policy.canUseOperator, false, 'Emulation should block operator');
});

await test('Policy shows owner role for local users', async () => {
  const { body } = await apiCall('/api/security/policy');
  assertEquals(body.policy.role, 'owner', 'Local users should be owner');
});

// ============================================================================
// Test 2: Operator Endpoint Protection
// ============================================================================

console.log('\n[2/4] Testing /api/operator Endpoint Protection...\n');

await test('Operator blocks requests in emulation mode', async () => {
  saveCognitiveMode('emulation', 'test');
  await new Promise(resolve => setTimeout(resolve, 100));

  const { status, body } = await apiCall('/api/operator', {
    method: 'POST',
    body: JSON.stringify({ goal: 'Test operator in emulation' }),
  });

  assertEquals(status, 403, 'Should return 403 Forbidden');
  assert(body.error, 'Should have error message');
  assert(body.error.includes('emulation') || body.error.includes('not allowed'),
    'Error should mention restriction');
});

await test('Operator allows requests in dual mode', async () => {
  saveCognitiveMode('dual', 'test');
  await new Promise(resolve => setTimeout(resolve, 100));

  const { status } = await apiCall('/api/operator', {
    method: 'POST',
    body: JSON.stringify({ goal: 'Echo test' }),
  });

  // Should not be 403 (may be other errors like missing skills, but policy allows it)
  assert(status !== 403, `Should not return 403 (got ${status})`);
});

await test('Operator allows requests in agent mode', async () => {
  saveCognitiveMode('agent', 'test');
  await new Promise(resolve => setTimeout(resolve, 100));

  const { status } = await apiCall('/api/operator', {
    method: 'POST',
    body: JSON.stringify({ goal: 'Echo test' }),
  });

  // Should not be 403 (agent mode allows operator for owner)
  assert(status !== 403, `Should not return 403 (got ${status})`);
});

// ============================================================================
// Test 3: Cognitive Mode Switching
// ============================================================================

console.log('\n[3/4] Testing Cognitive Mode Switching...\n');

await test('Mode can be switched via API', async () => {
  const { status, body } = await apiCall('/api/cognitive-mode', {
    method: 'POST',
    body: JSON.stringify({ mode: 'dual' }),
  });

  assertEquals(status, 200, 'Should return 200 OK');
  assert(body.success, 'Should have success=true');
  assertEquals(body.mode, 'dual', 'Should confirm mode change');
});

await test('Invalid mode returns error', async () => {
  const { status, body } = await apiCall('/api/cognitive-mode', {
    method: 'POST',
    body: JSON.stringify({ mode: 'invalid' }),
  });

  assert(status >= 400, 'Should return error status');
  assert(body.error, 'Should have error message');
});

await test('GET mode returns current mode', async () => {
  saveCognitiveMode('agent', 'test');
  await new Promise(resolve => setTimeout(resolve, 100));

  const { status, body } = await apiCall('/api/cognitive-mode', {
    method: 'GET',
  });

  assertEquals(status, 200, 'Should return 200 OK');
  assertEquals(body.mode, 'agent', 'Should return current mode');
});

// ============================================================================
// Test 4: Security Policy Consistency
// ============================================================================

console.log('\n[4/4] Testing Policy Consistency Across Modes...\n');

await test('Policy updates reflect immediately after mode change', async () => {
  // Switch to emulation
  await apiCall('/api/cognitive-mode', {
    method: 'POST',
    body: JSON.stringify({ mode: 'emulation' }),
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  // Check policy
  const { body } = await apiCall('/api/security/policy');
  assertEquals(body.policy.mode, 'emulation', 'Policy should reflect new mode');
  assertEquals(body.policy.canUseOperator, false, 'Should block operator');
});

await test('All three modes have distinct permissions', async () => {
  const modes = ['dual', 'agent', 'emulation'];
  const results = [];

  for (const mode of modes) {
    saveCognitiveMode(mode, 'test');
    await new Promise(resolve => setTimeout(resolve, 100));

    const { body } = await apiCall('/api/security/policy');
    results.push({
      mode,
      canWriteMemory: body.policy.canWriteMemory,
      canUseOperator: body.policy.canUseOperator,
    });
  }

  // Dual: both true
  assert(results[0].canWriteMemory && results[0].canUseOperator,
    'Dual should allow both');

  // Agent: writes true, operator true
  assert(results[1].canWriteMemory && results[1].canUseOperator,
    'Agent should allow both');

  // Emulation: both false
  assert(!results[2].canWriteMemory && !results[2].canUseOperator,
    'Emulation should block both');
});

// ============================================================================
// Cleanup & Results
// ============================================================================

// Restore to dual mode
saveCognitiveMode('dual', 'test');

console.log('\n' + '='.repeat(70));
console.log('Test Results Summary');
console.log('='.repeat(70));
console.log(`Total Tests: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log('='.repeat(70));

if (failed > 0) {
  console.log('\n❌ SOME TESTS FAILED\n');
  process.exit(1);
} else {
  console.log('\n✅ ALL TESTS PASSED\n');
  console.log('Integration tests validate:');
  console.log('- Security policy endpoint returns correct state');
  console.log('- Operator endpoint enforces mode-based restrictions');
  console.log('- Mode switching via API works correctly');
  console.log('- Policy updates reflect immediately after changes');
  console.log('');
  process.exit(0);
}

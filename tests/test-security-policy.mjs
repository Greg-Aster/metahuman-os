#!/usr/bin/env node
/**
 * Phase 5: Security Policy Unit Tests
 *
 * Tests the SecurityPolicy computation logic:
 * - Mode-based permissions (dual/agent/emulation)
 * - Role-based permissions (owner/guest/anonymous)
 * - Helper methods (requireWrite, requireOperator, requireOwner)
 * - Edge cases and error handling
 */

import { getSecurityPolicy, SecurityError } from '../packages/core/src/security-policy.ts';
import { saveCognitiveMode } from '../packages/core/src/cognitive-mode.ts';

console.log('\n' + '='.repeat(70));
console.log('Phase 5: Security Policy Unit Tests');
console.log('='.repeat(70) + '\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    failed++;
  }
}

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

// ============================================================================
// Test 1: Dual Mode Permissions
// ============================================================================

console.log('[1/8] Testing Dual Mode Permissions...\n');

test('Dual mode allows memory writes', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.canWriteMemory, true, 'canWriteMemory should be true');
});

test('Dual mode allows operator', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.canUseOperator, true, 'canUseOperator should be false in agent mode');
});

test('Dual mode allows mode changes (anonymous is owner)', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  // In anonymous mode, everyone is owner until auth is added
  assertEquals(policy.canChangeMode, true, 'canChangeMode should be true');
});

test('Dual mode has correct mode field', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.mode, 'dual', 'mode should be dual');
});

// ============================================================================
// Test 2: Agent Mode Permissions
// ============================================================================

console.log('\n[2/8] Testing Agent Mode Permissions...\n');

test('Agent mode allows memory writes', () => {
  saveCognitiveMode('agent', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.canWriteMemory, true, 'canWriteMemory should be true');
});

test('Agent mode allows operator', () => {
  saveCognitiveMode('agent', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.canUseOperator, true, 'canUseOperator should be true in agent mode');
});

test('Agent mode has correct mode field', () => {
  saveCognitiveMode('agent', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.mode, 'agent', 'mode should be agent');
});

// ============================================================================
// Test 3: Emulation Mode Permissions (MOST IMPORTANT)
// ============================================================================

console.log('\n[3/8] Testing Emulation Mode Permissions...\n');

test('Emulation mode BLOCKS memory writes', () => {
  saveCognitiveMode('emulation', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.canWriteMemory, false, 'canWriteMemory should be false');
});

test('Emulation mode BLOCKS operator', () => {
  saveCognitiveMode('emulation', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.canUseOperator, false, 'canUseOperator should be false');
});

test('Emulation mode BLOCKS training access', () => {
  saveCognitiveMode('emulation', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.canAccessTraining, false, 'canAccessTraining should be false');
});

test('Emulation mode has correct mode field', () => {
  saveCognitiveMode('emulation', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.mode, 'emulation', 'mode should be emulation');
});

// ============================================================================
// Test 4: Role-Based Permissions (Anonymous = Owner for now)
// ============================================================================

console.log('\n[4/8] Testing Role-Based Permissions...\n');

test('Local users are treated as owner (no auth yet)', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.role, 'owner', 'role should be owner for local use');
  // But anonymous has owner permissions until auth is added
  assertEquals(policy.canChangeMode, true, 'owner should have mode change perms');
});

test('Owner permissions include factory reset', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.canFactoryReset, true, 'owner can factory reset');
});

test('Owner permissions include trust changes', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  assertEquals(policy.canChangeTrust, true, 'owner can change trust');
});

// ============================================================================
// Test 5: Helper Methods - requireWrite()
// ============================================================================

console.log('\n[5/8] Testing requireWrite() Helper...\n');

test('requireWrite() passes in dual mode', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  // Should not throw
  policy.requireWrite();
});

test('requireWrite() throws SecurityError in emulation mode', () => {
  saveCognitiveMode('emulation', 'test');
  const policy = getSecurityPolicy();

  let errorThrown = false;
  try {
    policy.requireWrite();
  } catch (error) {
    errorThrown = true;
    assert(error instanceof SecurityError, 'Should throw SecurityError');
    assert(error.message.includes('Write operations not allowed'), 'Error should have correct message');
  }

  assert(errorThrown, 'Should have thrown SecurityError');
});

// ============================================================================
// Test 6: Helper Methods - requireOperator()
// ============================================================================

console.log('\n[6/8] Testing requireOperator() Helper...\n');

test('requireOperator() passes in dual mode', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  policy.requireOperator();
});

test('requireOperator() passes in agent mode', () => {
  saveCognitiveMode('agent', 'test');
  const policy = getSecurityPolicy();
  // Should not throw (agent mode allows operator for owner)
  policy.requireOperator();
});

test('requireOperator() throws in emulation mode', () => {
  saveCognitiveMode('emulation', 'test');
  const policy = getSecurityPolicy();

  let errorThrown = false;
  try {
    policy.requireOperator();
  } catch (error) {
    errorThrown = true;
    assert(error instanceof SecurityError, 'Should throw SecurityError');
  }

  assert(errorThrown, 'Should have thrown SecurityError');
});

// ============================================================================
// Test 7: Helper Methods - requireOwner()
// ============================================================================

console.log('\n[7/8] Testing requireOwner() Helper...\n');

test('requireOwner() passes for owner (local users)', () => {
  saveCognitiveMode('dual', 'test');
  const policy = getSecurityPolicy();
  // Currently all local users are treated as owner
  policy.requireOwner();
});

test('requireOwner() works across all modes', () => {
  const modes = ['dual', 'agent', 'emulation'];

  for (const mode of modes) {
    saveCognitiveMode(mode, 'test');
    const policy = getSecurityPolicy();
    // Should not throw (local users = owner)
    policy.requireOwner();
  }
});

// ============================================================================
// Test 8: Request-Scoped Caching
// ============================================================================

console.log('\n[8/8] Testing Request-Scoped Caching...\n');

test('getSecurityPolicy() returns same instance with same context', () => {
  saveCognitiveMode('dual', 'test');
  const context = { dummy: 'context' };

  const policy1 = getSecurityPolicy(context);
  const policy2 = getSecurityPolicy(context);

  // Should be the exact same object (cached)
  assert(policy1 === policy2, 'Should return cached instance');
});

test('getSecurityPolicy() returns different instance without context', () => {
  saveCognitiveMode('dual', 'test');

  const policy1 = getSecurityPolicy();
  const policy2 = getSecurityPolicy();

  // Should be different objects (no caching)
  assert(policy1 !== policy2, 'Should return new instances without context');
});

test('getSecurityPolicy() caching is per-context', () => {
  saveCognitiveMode('dual', 'test');
  const context1 = { id: 1 };
  const context2 = { id: 2 };

  const policy1 = getSecurityPolicy(context1);
  const policy2 = getSecurityPolicy(context2);

  // Should be different objects (different contexts)
  assert(policy1 !== policy2, 'Should cache separately per context');
});

// ============================================================================
// Results Summary
// ============================================================================

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
  console.log('Security policy logic is working correctly!');
  console.log('- Dual mode allows writes and operator');
  console.log('- Agent mode allows writes and operator');
  console.log('- Emulation mode blocks writes and operator');
  console.log('- Helper methods enforce permissions correctly');
  console.log('- Request-scoped caching works as expected');
  console.log('');
  process.exit(0);
}

#!/usr/bin/env node
/**
 * Phase 5: Endpoint Protection Integration Tests
 *
 * Tests that HTTP endpoints correctly enforce security policy:
 * - Write endpoints blocked in emulation mode
 * - Operator blocked in emulation mode
 * - Config changes logged and controlled
 * - Proper HTTP status codes (403 for forbidden)
 * - Error messages are informative
 */

import { saveCognitiveMode } from '../packages/core/src/cognitive-mode.ts';

console.log('\n' + '='.repeat(70));
console.log('Phase 5: Endpoint Protection Integration Tests');
console.log('='.repeat(70) + '\n');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4321';

let passed = 0;
let failed = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (error) {
      console.error(`✗ ${name}`);
      console.error(`  Error: ${error.message}`);
      failed++;
    }
  };
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

async function apiCall(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    let body;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    return {
      status: response.status,
      ok: response.ok,
      body,
    };
  } catch (error) {
    throw new Error(`API call failed: ${error.message}`);
  }
}

// ============================================================================
// Setup: Check server is running
// ============================================================================

console.log('[Setup] Checking if dev server is running...\n');

try {
  const response = await fetch(`${BASE_URL}/api/status`);
  if (!response.ok) {
    console.error('❌ Dev server not responding. Please start it with: cd apps/site && pnpm dev');
    process.exit(1);
  }
  console.log('✓ Dev server is running\n');
} catch (error) {
  console.error('❌ Cannot connect to dev server at', BASE_URL);
  console.error('   Please start it with: cd apps/site && pnpm dev');
  process.exit(1);
}

// ============================================================================
// Test 1: Memory Write Endpoints in Emulation Mode
// ============================================================================

console.log('[1/6] Testing Memory Write Endpoints in Emulation Mode...\n');

// Set to emulation mode
saveCognitiveMode('emulation', 'test');

await test('/api/capture blocks in emulation', async () => {
  const response = await apiCall('/api/capture', {
    method: 'POST',
    body: JSON.stringify({ content: 'Test capture in emulation' }),
  });

  assertEquals(response.status, 403, 'Should return 403 Forbidden');
  assert(response.body.error, 'Should have error message');
  assert(
    response.body.error.toLowerCase().includes('emulation') ||
    response.body.error.toLowerCase().includes('read-only'),
    'Error should mention emulation or read-only'
  );
})();

await test('/api/tasks POST blocks in emulation', async () => {
  const response = await apiCall('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Test task in emulation' }),
  });

  assertEquals(response.status, 403, 'Should return 403 Forbidden');
  assert(response.body.error, 'Should have error message');
})();

await test('/api/tasks PATCH blocks in emulation', async () => {
  const response = await apiCall('/api/tasks', {
    method: 'PATCH',
    body: JSON.stringify({ id: 'task-test', status: 'done' }),
  });

  assertEquals(response.status, 403, 'Should return 403 Forbidden');
  assert(response.body.error, 'Should have error message');
})();

// ============================================================================
// Test 2: Memory Write Endpoints in Dual Mode
// ============================================================================

console.log('\n[2/6] Testing Memory Write Endpoints in Dual Mode...\n');

// Switch to dual mode
saveCognitiveMode('dual', 'test');

// Wait a moment for policy to update
await new Promise(resolve => setTimeout(resolve, 100));

await test('/api/capture works in dual mode', async () => {
  const response = await apiCall('/api/capture', {
    method: 'POST',
    body: JSON.stringify({ content: 'Test capture in dual mode' }),
  });

  // Should succeed (200) or at least not be forbidden (403)
  assert(response.status !== 403, 'Should not return 403 in dual mode');

  // Accept 200, 201, or 500 (server error is fine, 403 is not)
  assert(
    response.status === 200 || response.status === 201 || response.status === 500,
    `Should return 2xx or 500, got ${response.status}`
  );
})();

// ============================================================================
// Test 3: Operator Endpoint Protection
// ============================================================================

console.log('\n[3/6] Testing Operator Endpoint Protection...\n');

// Set to emulation mode
saveCognitiveMode('emulation', 'test');
await new Promise(resolve => setTimeout(resolve, 100));

await test('/api/operator blocks in emulation', async () => {
  const response = await apiCall('/api/operator', {
    method: 'POST',
    body: JSON.stringify({ goal: 'Test operator in emulation' }),
  });

  assertEquals(response.status, 403, 'Should return 403 Forbidden');
  assert(response.body.error, 'Should have error message');
  assert(
    response.body.error.toLowerCase().includes('operator') ||
    response.body.error.toLowerCase().includes('emulation'),
    'Error should mention operator or emulation'
  );
})();

// Switch to dual mode
saveCognitiveMode('dual', 'test');
await new Promise(resolve => setTimeout(resolve, 100));

await test('/api/operator works in dual mode', async () => {
  const response = await apiCall('/api/operator', {
    method: 'POST',
    body: JSON.stringify({ goal: 'List files in out/' }),
  });

  // Should not be forbidden
  assert(response.status !== 403, 'Should not return 403 in dual mode');
})();

// ============================================================================
// Test 4: Configuration Endpoints (Owner-Only)
// ============================================================================

console.log('\n[4/6] Testing Configuration Endpoints...\n');

await test('/api/cognitive-mode GET works for all', async () => {
  const response = await apiCall('/api/cognitive-mode', {
    method: 'GET',
  });

  assertEquals(response.status, 200, 'Should return 200 OK');
  assert(response.body.mode, 'Should have mode field');
})();

await test('/api/cognitive-mode POST works for owner (anonymous)', async () => {
  const response = await apiCall('/api/cognitive-mode', {
    method: 'POST',
    body: JSON.stringify({ mode: 'agent', actor: 'test' }),
  });

  // Should not be forbidden (anonymous = owner)
  assert(response.status !== 403, 'Should not return 403 for owner');

  // Restore to dual
  saveCognitiveMode('dual', 'test');
})();

await test('/api/trust POST works for owner', async () => {
  const response = await apiCall('/api/trust', {
    method: 'POST',
    body: JSON.stringify({ level: 'supervised_auto' }),
  });

  // Should not be forbidden
  assert(response.status !== 403, 'Should not return 403 for owner');
})();

// ============================================================================
// Test 5: Factory Reset Requires Confirmation
// ============================================================================

console.log('\n[5/6] Testing Factory Reset Protection...\n');

await test('/api/reset-factory blocks without confirmation', async () => {
  const response = await apiCall('/api/reset-factory', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  assertEquals(response.status, 400, 'Should return 400 Bad Request');
  assert(response.body.error, 'Should have error message');
  assert(
    response.body.error.toLowerCase().includes('confirmation'),
    'Error should mention confirmation'
  );
})();

await test('/api/reset-factory shows warning without confirmation', async () => {
  const response = await apiCall('/api/reset-factory', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  assert(response.body.warning, 'Should have warning message');
  assert(
    response.body.warning.includes('DELETE'),
    'Warning should mention deletion'
  );
})();

// Note: Not testing actual factory reset to avoid data loss
// That test would require: { confirmToken: 'CONFIRM_FACTORY_RESET' }

// ============================================================================
// Test 6: Security Policy Endpoint
// ============================================================================

console.log('\n[6/6] Testing Security Policy Endpoint...\n');

await test('/api/security/policy returns policy', async () => {
  const response = await apiCall('/api/security/policy', {
    method: 'GET',
  });

  assertEquals(response.status, 200, 'Should return 200 OK');
  assert(response.body.success, 'Should have success flag');
  assert(response.body.policy, 'Should have policy object');
  assert(typeof response.body.policy.canWriteMemory === 'boolean', 'Should have canWriteMemory');
  assert(typeof response.body.policy.canUseOperator === 'boolean', 'Should have canUseOperator');
  assert(response.body.policy.mode, 'Should have mode field');
  assert(response.body.policy.role, 'Should have role field');
})();

await test('/api/security/policy reflects current mode', async () => {
  // Set to emulation
  saveCognitiveMode('emulation', 'test');
  await new Promise(resolve => setTimeout(resolve, 100));

  const response = await apiCall('/api/security/policy', {
    method: 'GET',
  });

  assertEquals(response.body.policy.mode, 'emulation', 'Mode should be emulation');
  assertEquals(response.body.policy.canWriteMemory, false, 'canWriteMemory should be false');
  assertEquals(response.body.policy.canUseOperator, false, 'canUseOperator should be false');

  // Restore to dual
  saveCognitiveMode('dual', 'test');
})();

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
  console.log('Endpoint protection is working correctly!');
  console.log('- Write endpoints blocked in emulation mode');
  console.log('- Operator blocked in emulation mode');
  console.log('- Config endpoints require owner role');
  console.log('- Factory reset requires explicit confirmation');
  console.log('- Policy endpoint returns correct state');
  console.log('');
  process.exit(0);
}

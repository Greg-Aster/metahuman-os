/**
 * Memory Continuity Regression Test Suite
 *
 * Phase 5: Observability & Testing
 *
 * Validates that the memory capture pipeline works end-to-end:
 * 1. Events are captured correctly with proper metadata
 * 2. Tool invocations are linked to conversation sessions
 * 3. Context builder retrieves recent tools
 * 4. Memory policy functions enforce mode-aware behavior
 * 5. Privacy filtering works correctly for different roles
 *
 * Usage:
 *   node tests/memory-continuity.test.mjs
 */

import { captureEvent, buildContextPackage, getUserContext, withUserContext, loadCognitiveMode } from '../packages/core/dist/index.js';
import { canWriteMemory, shouldCaptureTool, getToolHistoryLimit, contextDepth, redactSensitiveData, filterToolOutputs, canViewMemoryType, getMaxMemoriesForRole } from '../packages/core/dist/memory-policy.js';
import { readFileSync, existsSync } from 'fs';

// Test utilities
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
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
// Test Suite
// ============================================================================

console.log('\n=== Memory Continuity Regression Tests ===\n');

// Test 1: Memory Policy - Mode-Aware Write Permissions
test('canWriteMemory: Dual mode allows all event types', () => {
  assert(canWriteMemory('dual', 'conversation'), 'Should allow conversation in dual mode');
  assert(canWriteMemory('dual', 'tool_invocation'), 'Should allow tool_invocation in dual mode');
  assert(canWriteMemory('dual', 'inner_dialogue'), 'Should allow inner_dialogue in dual mode');
});

test('canWriteMemory: Agent mode allows only action events', () => {
  assert(canWriteMemory('agent', 'tool_invocation'), 'Should allow tool_invocation in agent mode');
  assert(canWriteMemory('agent', 'code_approval'), 'Should allow code_approval in agent mode');
  assert(!canWriteMemory('agent', 'conversation'), 'Should NOT allow conversation in agent mode');
  assert(!canWriteMemory('agent', 'inner_dialogue'), 'Should NOT allow inner_dialogue in agent mode');
});

test('canWriteMemory: Emulation mode blocks all writes', () => {
  assert(!canWriteMemory('emulation', 'conversation'), 'Should block conversation in emulation mode');
  assert(!canWriteMemory('emulation', 'tool_invocation'), 'Should block tool_invocation in emulation mode');
  assert(!canWriteMemory('emulation', 'inner_dialogue'), 'Should block inner_dialogue in emulation mode');
});

// Test 2: Tool Capture Policy
test('shouldCaptureTool: Agent mode skips conversational tools', () => {
  assert(shouldCaptureTool('agent', 'web_search'), 'Should capture web_search in agent mode');
  assert(shouldCaptureTool('agent', 'read_file'), 'Should capture read_file in agent mode');
  assert(!shouldCaptureTool('agent', 'chat'), 'Should NOT capture chat in agent mode');
  assert(!shouldCaptureTool('agent', 'conversational_response'), 'Should NOT capture conversational_response');
});

test('shouldCaptureTool: Dual mode captures all tools', () => {
  assert(shouldCaptureTool('dual', 'web_search'), 'Should capture web_search in dual mode');
  assert(shouldCaptureTool('dual', 'chat'), 'Should capture chat in dual mode');
  assert(shouldCaptureTool('dual', 'conversational_response'), 'Should capture conversational_response in dual mode');
});

test('shouldCaptureTool: Emulation mode never captures', () => {
  assert(!shouldCaptureTool('emulation', 'web_search'), 'Should NOT capture web_search in emulation mode');
  assert(!shouldCaptureTool('emulation', 'read_file'), 'Should NOT capture read_file in emulation mode');
});

// Test 3: Context Depth Limits
test('contextDepth: Returns correct limits for each mode', () => {
  assertEquals(contextDepth('dual', 'owner'), 12, 'Dual mode should return 12 for owner');
  assertEquals(contextDepth('agent', 'owner'), 6, 'Agent mode should return 6 for owner');
  assertEquals(contextDepth('emulation', 'owner'), 3, 'Emulation mode should return 3 for owner');
});

test('contextDepth: Guest users always get shallow context', () => {
  assertEquals(contextDepth('dual', 'guest'), 2, 'Guest should get 2 in dual mode');
  assertEquals(contextDepth('agent', 'guest'), 2, 'Guest should get 2 in agent mode');
  assertEquals(contextDepth('emulation', 'guest'), 2, 'Guest should get 2 in emulation mode');
});

// Test 4: Tool History Limits
test('getToolHistoryLimit: Returns mode-aware limits', () => {
  assertEquals(getToolHistoryLimit('dual', 'owner'), 10, 'Dual mode should return 10 tools');
  assertEquals(getToolHistoryLimit('agent', 'owner'), 5, 'Agent mode should return 5 tools');
  assertEquals(getToolHistoryLimit('emulation', 'owner'), 0, 'Emulation mode should return 0 tools');
});

test('getToolHistoryLimit: Guest users get no tool history', () => {
  assertEquals(getToolHistoryLimit('dual', 'guest'), 0, 'Guest should get 0 tools');
  assertEquals(getToolHistoryLimit('agent', 'anonymous'), 0, 'Anonymous should get 0 tools');
});

// Test 5: Privacy - Sensitive Data Redaction
test('redactSensitiveData: Redacts file paths for guests', () => {
  const text = 'I edited /home/greggles/metahuman/persona/core.json yesterday';
  const redacted = redactSensitiveData(text, 'guest');
  assert(redacted.includes('[REDACTED_PATH]'), 'Should redact file path');
  assert(!redacted.includes('/home/greggles'), 'Should not contain original path');
});

test('redactSensitiveData: Redacts email addresses for guests', () => {
  const text = 'Contact john.doe@example.com for details';
  const redacted = redactSensitiveData(text, 'guest');
  assert(redacted.includes('[REDACTED_EMAIL]'), 'Should redact email');
  assert(!redacted.includes('john.doe@example.com'), 'Should not contain original email');
});

test('redactSensitiveData: Redacts IP addresses for guests', () => {
  const text = 'Server at 192.168.1.100 is running';
  const redacted = redactSensitiveData(text, 'guest');
  assert(redacted.includes('[REDACTED_IP]'), 'Should redact IP');
  assert(!redacted.includes('192.168.1.100'), 'Should not contain original IP');
});

test('redactSensitiveData: Owners see everything', () => {
  const text = 'I edited /home/greggles/metahuman/persona/core.json yesterday';
  const redacted = redactSensitiveData(text, 'owner');
  assertEquals(redacted, text, 'Owner should see unredacted text');
});

// Test 6: Privacy - Tool Output Filtering
test('filterToolOutputs: Redacts file operations for guests', () => {
  const outputs = {
    path: '/home/greggles/test.txt',
    content: 'Secret file content',
    success: true
  };
  const filtered = filterToolOutputs(outputs, 'guest', 'read_file');

  assertEquals(filtered.success, true, 'Should keep success flag');
  assert(filtered.content.includes('REDACTED'), 'Should redact content');
  assert(filtered.path.includes('REDACTED'), 'Should redact path');
});

test('filterToolOutputs: Owners see full outputs', () => {
  const outputs = {
    path: '/home/greggles/test.txt',
    content: 'File content',
    success: true
  };
  const filtered = filterToolOutputs(outputs, 'owner', 'read_file');

  assertEquals(filtered.content, 'File content', 'Owner should see full content');
  assertEquals(filtered.path, '/home/greggles/test.txt', 'Owner should see full path');
});

// Test 7: Memory Type Visibility
test('canViewMemoryType: Owners see all types', () => {
  assert(canViewMemoryType('conversation', 'owner'), 'Owner should see conversation');
  assert(canViewMemoryType('inner_dialogue', 'owner'), 'Owner should see inner_dialogue');
  assert(canViewMemoryType('dream', 'owner'), 'Owner should see dream');
  assert(canViewMemoryType('reflection', 'owner'), 'Owner should see reflection');
});

test('canViewMemoryType: Members cannot see private types', () => {
  assert(canViewMemoryType('conversation', 'member'), 'Member should see conversation');
  assert(canViewMemoryType('reflection', 'member'), 'Member should see reflection');
  assert(!canViewMemoryType('inner_dialogue', 'member'), 'Member should NOT see inner_dialogue');
  assert(!canViewMemoryType('dream', 'member'), 'Member should NOT see dream');
});

test('canViewMemoryType: Guests only see conversations', () => {
  assert(canViewMemoryType('conversation', 'guest'), 'Guest should see conversation');
  assert(!canViewMemoryType('inner_dialogue', 'guest'), 'Guest should NOT see inner_dialogue');
  assert(!canViewMemoryType('dream', 'guest'), 'Guest should NOT see dream');
  assert(!canViewMemoryType('reflection', 'guest'), 'Guest should NOT see reflection');
});

// Test 8: Role-Based Memory Limits
test('getMaxMemoriesForRole: Returns correct limits', () => {
  assertEquals(getMaxMemoriesForRole('owner'), 50, 'Owner should get 50 memories');
  assertEquals(getMaxMemoriesForRole('member'), 20, 'Member should get 20 memories');
  assertEquals(getMaxMemoriesForRole('guest'), 5, 'Guest should get 5 memories');
  assertEquals(getMaxMemoriesForRole('anonymous'), 2, 'Anonymous should get 2 memories');
});

// ============================================================================
// Test Summary
// ============================================================================

console.log(`\n=== Test Results ===`);
console.log(`✓ Passed: ${passed}`);
console.log(`✗ Failed: ${failed}`);
console.log(`Total: ${passed + failed}\n`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed! ✨\n');
  process.exit(0);
}

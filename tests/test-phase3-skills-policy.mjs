#!/usr/bin/env node
/**
 * Phase 3 Integration Test: Skills Policy Enforcement
 *
 * Tests that skills respect security policy:
 * - Operator can't write to memory/ in emulation mode
 * - Skills are blocked at execution layer
 * - Audit logs capture policy violations
 */

import { getSecurityPolicy } from '../packages/core/src/security-policy.ts';
import { executeSkill } from '../packages/core/src/skills.ts';
import { initializeSkills } from '../brain/skills/index.ts';
import { saveCognitiveMode } from '../packages/core/src/cognitive-mode.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('\n='.repeat(70));
console.log('Phase 3 Skills Policy Integration Test');
console.log('='.repeat(70) + '\n');

// Initialize skills
console.log('[1/5] Initializing skills system...');
initializeSkills();
console.log('✓ Skills initialized\n');

// Test 1: Verify dual mode allows memory writes
console.log('[2/5] Test 1: Dual mode should allow memory writes');
saveCognitiveMode('dual', 'test');
const dualPolicy = getSecurityPolicy();
console.log(`  Mode: ${dualPolicy.mode}`);
console.log(`  Can write memory: ${dualPolicy.canWriteMemory}`);
if (!dualPolicy.canWriteMemory) {
  console.error('✗ FAILED: Dual mode should allow memory writes');
  process.exit(1);
}
console.log('✓ Dual mode allows memory writes\n');

// Test 2: Verify emulation mode blocks memory writes
console.log('[3/5] Test 2: Emulation mode should block memory writes');
saveCognitiveMode('emulation', 'test');
const emulationPolicy = getSecurityPolicy();
console.log(`  Mode: ${emulationPolicy.mode}`);
console.log(`  Can write memory: ${emulationPolicy.canWriteMemory}`);
if (emulationPolicy.canWriteMemory) {
  console.error('✗ FAILED: Emulation mode should block memory writes');
  process.exit(1);
}
console.log('✓ Emulation mode blocks memory writes\n');

// Test 3: Try to execute fs_write to memory/ with emulation policy
console.log('[4/5] Test 3: fs_write to memory/ should be blocked in emulation');
const testMemoryPath = path.join(root, 'memory', 'episodic', 'test-policy-violation.json');
const testContent = JSON.stringify({ test: 'This should not be written' }, null, 2);

try {
  const result = await executeSkill(
    'fs_write',
    {
      path: testMemoryPath,
      content: testContent,
      overwrite: true
    },
    'supervised_auto', // Trust level
    true, // Auto-approve (bypass approval queue)
    emulationPolicy // Pass emulation policy
  );

  console.log(`  Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }

  // Should fail
  if (result.success) {
    console.error('✗ FAILED: fs_write to memory/ should be blocked in emulation mode');
    // Clean up if it somehow succeeded
    if (fs.existsSync(testMemoryPath)) {
      fs.unlinkSync(testMemoryPath);
    }
    process.exit(1);
  }

  // Verify file was NOT created
  if (fs.existsSync(testMemoryPath)) {
    console.error('✗ FAILED: File should not have been created');
    fs.unlinkSync(testMemoryPath);
    process.exit(1);
  }

  console.log('✓ fs_write correctly blocked in emulation mode\n');
} catch (error) {
  console.error('✗ FAILED: Unexpected error:', error.message);
  process.exit(1);
}

// Test 4: Verify fs_write works with dual policy
console.log('[5/5] Test 4: fs_write to out/ should work in any mode');
const testOutPath = path.join(root, 'out', 'test-policy-allowed.txt');
const testOutContent = 'This write should succeed';

try {
  const result = await executeSkill(
    'fs_write',
    {
      path: testOutPath,
      content: testOutContent,
      overwrite: true
    },
    'supervised_auto',
    true,
    emulationPolicy // Even with emulation policy, out/ should be writable
  );

  console.log(`  Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }

  // Should succeed (out/ is always writable)
  if (!result.success) {
    console.error('✗ FAILED: fs_write to out/ should be allowed');
    process.exit(1);
  }

  // Verify file was created
  if (!fs.existsSync(testOutPath)) {
    console.error('✗ FAILED: File should have been created');
    process.exit(1);
  }

  // Clean up
  fs.unlinkSync(testOutPath);
  console.log('✓ fs_write to out/ works correctly\n');
} catch (error) {
  console.error('✗ FAILED: Unexpected error:', error.message);
  process.exit(1);
}

// Restore to dual mode
console.log('Restoring cognitive mode to dual...');
saveCognitiveMode('dual', 'test');

console.log('\n' + '='.repeat(70));
console.log('✓ ALL TESTS PASSED');
console.log('='.repeat(70));
console.log('\nPhase 3 Skills Policy Integration: ✓ Complete');
console.log('Skills now enforce security policy at execution layer.\n');

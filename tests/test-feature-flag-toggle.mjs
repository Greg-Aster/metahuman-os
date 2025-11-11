/**
 * Feature Flag Toggle Test
 *
 * Tests that the feature flag correctly routes between V1 and V2
 *
 * Run: npx tsx tests/test-feature-flag-toggle.mjs
 */

import fs from 'fs';
import path from 'path';
import { isReactV2Enabled, loadUserConfig, saveUserConfig } from '../packages/core/src/config.js';

const RUNTIME_PATH = path.join(process.cwd(), 'etc', 'runtime.json');

console.log('=== Feature Flag Toggle Test ===\n');

// Save original runtime config
const originalRuntime = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf-8'));
console.log('Original runtime.json:');
console.log(JSON.stringify(originalRuntime, null, 2));
console.log();

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`❌ ${name}`);
    console.error(`   Error: ${error.message}`);
  }
}

// Test 1: Feature flag should default to false
test('Feature flag should default to false', () => {
  const enabled = isReactV2Enabled();
  if (enabled !== false) {
    throw new Error(`Expected false, got ${enabled}`);
  }
});

// Test 2: Enable V2
console.log('\nEnabling V2...');
const runtimeWithV2 = { ...originalRuntime, operator: { reactV2: true } };
fs.writeFileSync(RUNTIME_PATH, JSON.stringify(runtimeWithV2, null, 2));

// Need to reload config by importing fresh
import('../packages/core/src/config.js').then(async (configModule) => {
  // Import fresh to bypass cache
  const { isReactV2Enabled: checkV2 } = configModule;

  test('Feature flag should be enabled after update', () => {
    const enabled = checkV2();
    if (enabled !== true) {
      throw new Error(`Expected true, got ${enabled}`);
    }
  });

  // Test 3: Disable V2 again
  console.log('\nDisabling V2...');
  const runtimeWithV1 = { ...originalRuntime, operator: { reactV2: false } };
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify(runtimeWithV1, null, 2));

  test('Feature flag should be disabled after update', () => {
    const enabled = checkV2();
    if (enabled !== false) {
      throw new Error(`Expected false, got ${enabled}`);
    }
  });

  // Restore original
  console.log('\nRestoring original runtime.json...');
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify(originalRuntime, null, 2));

  test('Feature flag should be restored to original', () => {
    const enabled = checkV2();
    // Should match original value
    const originalValue = originalRuntime.operator?.reactV2 || false;
    if (enabled !== originalValue) {
      throw new Error(`Expected ${originalValue}, got ${enabled}`);
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Total:  ${testsPassed + testsFailed}`);
  console.log(`Passed: ${testsPassed} ✅`);
  console.log(`Failed: ${testsFailed} ❌`);

  if (testsFailed === 0) {
    console.log('\n🎉 Feature flag toggle working correctly!');
  } else {
    console.log('\n⚠️ Some tests failed.');
    process.exit(1);
  }
});

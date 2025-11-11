/**
 * ReasoningEngine + UI Integration Test
 *
 * Tests that the ReasoningEngine emits events compatible with the UI.
 * Validates both raw events and UI-compatible "reasoning" events.
 *
 * Run: npx tsx tests/test-reasoning-ui-integration.mjs
 */

import { runOperatorWithFeatureFlag } from '../brain/agents/operator-react.ts';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

const RUNTIME_CONFIG_PATH = path.join(process.cwd(), 'etc/runtime.json');

// Helper to temporarily enable reasoning service
async function withReasoningService(enabled, fn) {
  // Read current config
  const original = JSON.parse(await readFile(RUNTIME_CONFIG_PATH, 'utf8'));

  // Update config
  const updated = {
    ...original,
    operator: {
      ...original.operator,
      useReasoningService: enabled,
    },
  };
  await writeFile(RUNTIME_CONFIG_PATH, JSON.stringify(updated, null, 2));

  try {
    // Run function
    return await fn();
  } finally {
    // Restore original
    await writeFile(RUNTIME_CONFIG_PATH, JSON.stringify(original, null, 2));
  }
}

console.log('=== ReasoningEngine + UI Integration Test ===\n');

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  testsRun++;
  return fn()
    .then(() => {
      testsPassed++;
      console.log(`✅ ${name}`);
    })
    .catch((error) => {
      testsFailed++;
      console.error(`❌ ${name}`);
      console.error(`   Error: ${error.message}`);
    });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ============================================================================
// Test 1: Verify Event Format
// ============================================================================

console.log('Test Suite 1: Event Format Verification\n');

await test('Should emit both raw and reasoning events', async () => {
  await withReasoningService(true, async () => {
    const rawEvents = [];
    const reasoningEvents = [];

    const onProgress = (event) => {
      if (event.type === 'reasoning') {
        reasoningEvents.push(event);
      } else {
        rawEvents.push(event);
      }
    };

    await runOperatorWithFeatureFlag(
      'List my tasks',
      { memories: [], conversationHistory: [], sessionId: 'test-session' },
      onProgress,
      { userId: 'test-user', cognitiveMode: 'dual' },
      2 // focused depth
    );

    // Verify raw events
    assert(rawEvents.length > 0, 'Should emit raw events');
    assert(
      rawEvents.some((e) => e.type === 'thought'),
      'Should emit thought events'
    );

    // Verify reasoning events
    assert(reasoningEvents.length > 0, 'Should emit reasoning events');
    assert(
      reasoningEvents.every((e) => e.type === 'reasoning'),
      'All reasoning events should have type "reasoning"'
    );
    assert(
      reasoningEvents.every((e) => e.data && typeof e.data.round === 'number'),
      'Reasoning events should have data.round'
    );
    assert(
      reasoningEvents.every((e) => typeof e.data.stage === 'string'),
      'Reasoning events should have data.stage'
    );
    assert(
      reasoningEvents.every((e) => typeof e.data.content === 'string'),
      'Reasoning events should have data.content'
    );

    console.log(`\n   Raw events: ${rawEvents.length}`);
    console.log(`   Reasoning events: ${reasoningEvents.length}`);
    console.log(`   Sample reasoning event:`, JSON.stringify(reasoningEvents[0], null, 2));
  });
});

// ============================================================================
// Test 2: Verify Event Content
// ============================================================================

console.log('\nTest Suite 2: Event Content Verification\n');

await test('Reasoning events should have formatted content', async () => {
  await withReasoningService(true, async () => {
    const reasoningEvents = [];

    const onProgress = (event) => {
      if (event.type === 'reasoning') {
        reasoningEvents.push(event);
      }
    };

    await runOperatorWithFeatureFlag(
      'What is 2+2?',
      { memories: [], conversationHistory: [], sessionId: 'test-session-2' },
      onProgress,
      { userId: 'test-user', cognitiveMode: 'dual' },
      1 // quick depth
    );

    // Check thought formatting
    const thoughtEvents = reasoningEvents.filter((e) => e.data.stage === 'thought');
    assert(thoughtEvents.length > 0, 'Should have thought events');
    assert(
      thoughtEvents.every((e) => e.data.content.startsWith('**Thought:**')),
      'Thought events should start with **Thought:**'
    );

    // Check action formatting
    const actionEvents = reasoningEvents.filter((e) => e.data.stage === 'action');
    if (actionEvents.length > 0) {
      assert(
        actionEvents.every((e) => e.data.content.startsWith('**Action:**')),
        'Action events should start with **Action:**'
      );
    }

    // Check observation formatting
    const obsEvents = reasoningEvents.filter((e) => e.data.stage === 'observation');
    if (obsEvents.length > 0) {
      assert(
        obsEvents.every(
          (e) =>
            e.data.content.startsWith('**Observation:**') ||
            e.data.content.startsWith('**Error:**')
        ),
        'Observation events should start with **Observation:** or **Error:**'
      );
    }

    console.log(`\n   Thought events: ${thoughtEvents.length}`);
    console.log(`   Action events: ${actionEvents.length}`);
    console.log(`   Observation events: ${obsEvents.length}`);
  });
});

// ============================================================================
// Test Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('Test Summary');
console.log('='.repeat(60));
console.log(`Total:  ${testsRun}`);
console.log(`Passed: ${testsPassed} ✅`);
console.log(`Failed: ${testsFailed} ❌`);

if (testsFailed === 0) {
  console.log('\n🎉 All integration tests passed!');
  console.log('\nReasoningEngine is compatible with UI SSE format.');
  console.log('You can safely enable useReasoningService in etc/runtime.json.');
} else {
  console.log('\n⚠️ Some tests failed. Please review the errors above.');
  process.exit(1);
}

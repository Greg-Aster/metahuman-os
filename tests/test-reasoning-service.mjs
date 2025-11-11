/**
 * Reasoning Service Integration Tests
 *
 * Tests the new unified reasoning service.
 *
 * Run: npx tsx tests/test-reasoning-service.mjs
 */

import { ReasoningEngine } from '../packages/core/src/reasoning/index.js';
import { initializeSkills } from '../brain/skills/index.js';

console.log('=== Reasoning Service Integration Tests ===\n');

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  testsRun++;
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ============================================================================
// Test 1: ReasoningEngine Instantiation
// ============================================================================

console.log('Test Suite 1: Engine Instantiation\n');

test('ReasoningEngine should instantiate with default config', () => {
  const engine = new ReasoningEngine();
  assert(engine, 'Engine should exist');
  const config = engine.getConfig();
  assert(config.depth === 'focused', 'Default depth should be focused');
  assert(config.maxSteps === 10, 'Default maxSteps should be 10');
});

test('ReasoningEngine should accept custom config', () => {
  const engine = new ReasoningEngine({
    depth: 'quick',
    maxSteps: 5,
    enableFastPath: false,
  });
  const config = engine.getConfig();
  assert(config.depth === 'quick', 'Depth should be quick');
  assert(config.maxSteps === 5, 'MaxSteps should be 5');
  assert(config.enableFastPath === false, 'FastPath should be disabled');
});

test('ReasoningEngine should validate invalid config', () => {
  try {
    new ReasoningEngine({
      maxSteps: 0, // Invalid
    });
    throw new Error('Should have thrown validation error');
  } catch (error) {
    assert(error.message.includes('Invalid maxSteps'), 'Should validate maxSteps');
  }
});

// ============================================================================
// Test 2: Configuration
// ============================================================================

console.log('\nTest Suite 2: Configuration\n');

test('getMaxStepsForDepth should return correct values', () => {
  const { getMaxStepsForDepth } = await import('../packages/core/src/reasoning/config.js');
  assert(getMaxStepsForDepth('off') === 1, 'Off should be 1');
  assert(getMaxStepsForDepth('quick') === 5, 'Quick should be 5');
  assert(getMaxStepsForDepth('focused') === 10, 'Focused should be 10');
  assert(getMaxStepsForDepth('deep') === 15, 'Deep should be 15');
});

test('getDefaultConfig should populate all fields', () => {
  const { getDefaultConfig } = await import('../packages/core/src/reasoning/config.js');
  const config = getDefaultConfig();
  assert(config.depth, 'Should have depth');
  assert(config.maxSteps, 'Should have maxSteps');
  assert(config.sessionId, 'Should have sessionId');
  assert(typeof config.enableFastPath === 'boolean', 'Should have enableFastPath');
});

// ============================================================================
// Test 3: Scratchpad
// ============================================================================

console.log('\nTest Suite 3: Scratchpad Management\n');

test('formatScratchpadForLLM should handle empty scratchpad', () => {
  const { formatScratchpadForLLM } = await import('../packages/core/src/reasoning/scratchpad.js');
  const result = formatScratchpadForLLM([]);
  assert(result.includes('Empty'), 'Should indicate empty scratchpad');
});

test('formatScratchpadForLLM should format entries correctly', () => {
  const { formatScratchpadForLLM } = await import('../packages/core/src/reasoning/scratchpad.js');
  const scratchpad = [
    {
      step: 1,
      thought: 'Test thought',
      action: { tool: 'task_list', args: {} },
      observation: { mode: 'structured', content: 'Test observation', success: true },
      timestamp: '2025-11-11T00:00:00Z',
    },
  ];
  const result = formatScratchpadForLLM(scratchpad);
  assert(result.includes('Thought 1'), 'Should include thought');
  assert(result.includes('Action 1'), 'Should include action');
  assert(result.includes('Observation 1'), 'Should include observation');
});

test('getObservations should extract observation content', () => {
  const { getObservations } = await import('../packages/core/src/reasoning/scratchpad.js');
  const scratchpad = [
    {
      step: 1,
      thought: 'Test',
      observation: { mode: 'structured', content: 'Observation 1', success: true },
      timestamp: '2025-11-11T00:00:00Z',
    },
    {
      step: 2,
      thought: 'Test',
      observation: { mode: 'structured', content: 'Observation 2', success: true },
      timestamp: '2025-11-11T00:00:00Z',
    },
  ];
  const result = getObservations(scratchpad);
  assert(result.includes('Observation 1'), 'Should include first observation');
  assert(result.includes('Observation 2'), 'Should include second observation');
});

// ============================================================================
// Test 4: Error Analysis
// ============================================================================

console.log('\nTest Suite 4: Error Analysis\n');

test('analyzeError should detect FILE_NOT_FOUND', () => {
  const { analyzeError } = await import('../packages/core/src/reasoning/errors.js');
  const analysis = analyzeError('fs_read', { path: '/test.txt' }, 'File not found: ENOENT');
  assert(analysis.code === 'FILE_NOT_FOUND', 'Should detect FILE_NOT_FOUND');
  assert(analysis.suggestions.length > 0, 'Should have suggestions');
  assert(analysis.suggestions[0].includes('fs_list'), 'Should suggest fs_list');
});

test('analyzeError should detect PERMISSION_DENIED', () => {
  const { analyzeError } = await import('../packages/core/src/reasoning/errors.js');
  const analysis = analyzeError('fs_write', { path: '/test.txt' }, 'Permission denied: EACCES');
  assert(analysis.code === 'PERMISSION_DENIED', 'Should detect PERMISSION_DENIED');
  assert(analysis.suggestions.length > 0, 'Should have suggestions');
});

test('analyzeError should detect NETWORK_ERROR', () => {
  const { analyzeError } = await import('../packages/core/src/reasoning/errors.js');
  const analysis = analyzeError('web_search', {}, 'Network timeout');
  assert(analysis.code === 'NETWORK_ERROR', 'Should detect NETWORK_ERROR');
  assert(analysis.suggestions.length > 0, 'Should have suggestions');
});

// ============================================================================
// Test 5: Failure Loop Detection
// ============================================================================

console.log('\nTest Suite 5: Failure Loop Detection\n');

test('detectFailureLoop should detect repeated failures', () => {
  const { detectFailureLoop } = await import('../packages/core/src/reasoning/validators.js');
  const scratchpad = [
    {
      step: 1,
      thought: 'Test',
      action: { tool: 'fs_read', args: { path: '/test.txt' } },
      observation: {
        mode: 'structured',
        content: 'Error',
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'Not found', context: {} },
      },
      timestamp: '2025-11-11T00:00:00Z',
    },
    {
      step: 2,
      thought: 'Test',
      action: { tool: 'fs_read', args: { path: '/test.txt' } },
      observation: {
        mode: 'structured',
        content: 'Error',
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'Not found', context: {} },
      },
      timestamp: '2025-11-11T00:00:01Z',
    },
  ];

  const result = detectFailureLoop(scratchpad, { tool: 'fs_read', args: { path: '/test.txt' } });
  assert(result.isLoop === true, 'Should detect loop');
  assert(result.suggestion.includes('failed'), 'Should mention failures');
});

test('detectFailureLoop should not trigger on first failure', () => {
  const { detectFailureLoop } = await import('../packages/core/src/reasoning/validators.js');
  const scratchpad = [
    {
      step: 1,
      thought: 'Test',
      action: { tool: 'fs_read', args: { path: '/test.txt' } },
      observation: {
        mode: 'structured',
        content: 'Error',
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'Not found', context: {} },
      },
      timestamp: '2025-11-11T00:00:00Z',
    },
  ];

  const result = detectFailureLoop(scratchpad, { tool: 'fs_read', args: { path: '/test.txt' } });
  assert(result.isLoop === false, 'Should not detect loop on first failure');
});

// ============================================================================
// Test 6: Observation Formatting
// ============================================================================

console.log('\nTest Suite 6: Observation Formatting\n');

test('formatObservationV2 should handle success', () => {
  const { formatObservationV2 } = await import('../packages/core/src/reasoning/observers.js');
  const result = { success: true, outputs: { tasks: [] } };
  const observation = formatObservationV2('task_list', result, 'structured');
  assert(observation.success === true, 'Should be successful');
  assert(observation.mode === 'structured', 'Mode should be structured');
  assert(observation.content.includes('No tasks'), 'Should format empty task list');
});

test('formatObservationV2 should handle errors', () => {
  const { formatObservationV2 } = await import('../packages/core/src/reasoning/observers.js');
  const result = { success: false, error: 'Test error' };
  const observation = formatObservationV2('task_list', result, 'structured');
  assert(observation.success === false, 'Should be unsuccessful');
  assert(observation.content.includes('error'), 'Should mention error');
  assert(observation.error, 'Should have error object');
});

test('detectDataRetrievalIntent should detect data queries', () => {
  const { detectDataRetrievalIntent } = await import('../packages/core/src/reasoning/observers.js');
  assert(detectDataRetrievalIntent('list my tasks'), 'Should detect "list"');
  assert(detectDataRetrievalIntent('show me the files'), 'Should detect "show"');
  assert(detectDataRetrievalIntent('get the data'), 'Should detect "get"');
  assert(!detectDataRetrievalIntent('hello world'), 'Should not detect chat');
});

// ============================================================================
// Test 7: JSON Extraction
// ============================================================================

console.log('\nTest Suite 7: JSON Extraction\n');

test('extractJsonBlock should extract pure JSON', () => {
  const { extractJsonBlock } = await import('../packages/core/src/reasoning/planner.js');
  const json = '{"thought": "test", "respond": true}';
  const result = extractJsonBlock(json);
  assert(result === json, 'Should return pure JSON');
  JSON.parse(result); // Should not throw
});

test('extractJsonBlock should extract JSON from markdown', () => {
  const { extractJsonBlock } = await import('../packages/core/src/reasoning/planner.js');
  const markdown = 'Here is my response:\n\n```json\n{"thought": "test"}\n```';
  const result = extractJsonBlock(markdown);
  assert(result.includes('{'), 'Should extract JSON block');
  JSON.parse(result); // Should not throw
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
  console.log('\n🎉 All tests passed!');
  console.log('\nReasoning service is ready to use. Next steps:');
  console.log('1. Integrate with operator-react.ts');
  console.log('2. Update API endpoints');
  console.log('3. Standardize SSE events');
} else {
  console.log('\n⚠️ Some tests failed. Please review the errors above.');
  process.exit(1);
}

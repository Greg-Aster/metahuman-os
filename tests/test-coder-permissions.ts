/**
 * Permission Enforcement Test: Coder Agent Security
 *
 * Verifies that the coder agent cannot modify protected directories:
 * - memory/
 * - persona/
 * - logs/
 */

import { isCoderWriteAllowed } from '../packages/core/src/skills';

console.log('='.repeat(70));
console.log('TEST: Coder Agent - Permission Enforcement');
console.log('='.repeat(70));
console.log('');

interface TestCase {
  path: string;
  shouldAllow: boolean;
  description: string;
}

const testCases: TestCase[] = [
  // Protected directories (should be blocked)
  { path: 'memory/episodic/2025/test.json', shouldAllow: false, description: 'Block memory/episodic writes' },
  { path: 'persona/core.json', shouldAllow: false, description: 'Block persona writes' },
  { path: 'logs/audit/2025-11-04.ndjson', shouldAllow: false, description: 'Block logs writes' },
  { path: 'node_modules/package/index.js', shouldAllow: false, description: 'Block node_modules writes' },
  { path: '.git/config', shouldAllow: false, description: 'Block .git writes' },

  // Allowed directories (should pass)
  { path: 'packages/core/src/test.ts', shouldAllow: true, description: 'Allow packages/ writes' },
  { path: 'apps/site/src/test.tsx', shouldAllow: true, description: 'Allow apps/ writes' },
  { path: 'brain/agents/test-agent.ts', shouldAllow: true, description: 'Allow brain/ writes' },
  { path: 'docs/dev/test.md', shouldAllow: true, description: 'Allow docs/ writes' },
  { path: 'etc/config.json', shouldAllow: true, description: 'Allow etc/ writes' },
  { path: 'out/test-output.txt', shouldAllow: true, description: 'Allow out/ writes' },
  { path: 'tests/test-example.ts', shouldAllow: true, description: 'Allow tests/ writes' },
];

console.log('Running permission tests...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = isCoderWriteAllowed(testCase.path);
  const success = result === testCase.shouldAllow;

  if (success) {
    console.log(`✓ ${testCase.description}`);
    console.log(`  Path: ${testCase.path}`);
    console.log(`  Expected: ${testCase.shouldAllow ? 'ALLOW' : 'BLOCK'}, Got: ${result ? 'ALLOW' : 'BLOCK'}`);
    passed++;
  } else {
    console.log(`✗ ${testCase.description}`);
    console.log(`  Path: ${testCase.path}`);
    console.log(`  Expected: ${testCase.shouldAllow ? 'ALLOW' : 'BLOCK'}, Got: ${result ? 'ALLOW' : 'BLOCK'}`);
    failed++;
  }
  console.log('');
}

console.log('='.repeat(70));
console.log('RESULTS');
console.log('='.repeat(70));
console.log(`Total tests: ${testCases.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log('');

if (failed === 0) {
  console.log('✓ All permission tests passed!');
  console.log('');
  console.log('Security verified:');
  console.log('  - Coder CANNOT modify memory/ (user data protected)');
  console.log('  - Coder CANNOT modify persona/ (identity protected)');
  console.log('  - Coder CANNOT modify logs/ (audit trail protected)');
  console.log('  - Coder CAN modify code directories (packages/, apps/, brain/, etc.)');
  process.exit(0);
} else {
  console.log('✗ Some permission tests failed!');
  process.exit(1);
}

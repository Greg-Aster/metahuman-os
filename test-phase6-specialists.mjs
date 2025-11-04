import { detectSpecialistType } from './packages/core/src/specialist-broker.js';

console.log('Testing Phase 6 - Specialist Detection\n');

const tests = [
  { desc: 'implement a binary search function in python', expected: 'coder' },
  { desc: 'write code to parse JSON', expected: 'coder' },
  { desc: 'create a roadmap for the project', expected: 'planner' },
  { desc: 'break down this task into steps', expected: 'planner' },
  { desc: 'summarize this document into key points', expected: 'summarizer' },
  { desc: 'give me a brief overview', expected: 'summarizer' },
  { desc: 'curate training dataset from memories', expected: 'curator' },
  { desc: 'prepare clean data for training', expected: 'curator' },
];

let passed = 0;
for (const test of tests) {
  const detected = detectSpecialistType(test.desc);
  const match = detected === test.expected;
  const icon = match ? '✓' : '✗';
  console.log(`${icon} "${test.desc}"`);
  console.log(`  Expected: ${test.expected}, Got: ${detected || 'null'}\n`);
  if (match) passed++;
}

console.log(`\n${passed}/${tests.length} tests passed`);
console.log(passed === tests.length ? '\n✅ All specialist detection tests passed!' : '\n⚠️  Some tests failed');

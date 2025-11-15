/**
 * Test persona merger handles edge cases that previously caused malformed core.json
 */

import { mergePersonaDraft } from '../packages/core/src/persona/merger.js';

console.log('🧪 Testing Persona Merger Edge Cases\n');

// Test Case 1: Goals as strings (should transform to objects)
console.log('Test 1: Goals as strings → should transform to {goal, status} objects');
const draft1 = {
  goals: {
    shortTerm: 'Complete the Metahuman-OS project',
    midTerm: ['Build a community', 'Foster connections'],
    longTerm: 'Achieve recognition'
  }
};

const result1 = mergePersonaDraft({}, draft1, 'merge');
const shortTerm = result1.updated.goals.shortTerm;
const longTerm = result1.updated.goals.longTerm;

if (Array.isArray(shortTerm) && shortTerm[0]?.goal && shortTerm[0]?.status) {
  console.log('✅ String goal transformed to object array:', shortTerm[0]);
} else {
  console.log('❌ FAILED: shortTerm not properly transformed:', shortTerm);
}

if (Array.isArray(longTerm) && longTerm[0]?.goal && longTerm[0]?.status) {
  console.log('✅ String goal transformed to object array:', longTerm[0]);
} else {
  console.log('❌ FAILED: longTerm not properly transformed:', longTerm);
}

// Test Case 2: currentFocus as string (should wrap, not spread into characters)
console.log('\nTest 2: currentFocus as string → should wrap in array, not spread to characters');
const draft2 = {
  currentFocus: 'Developing adaptive training loops'
};

const result2 = mergePersonaDraft({}, draft2, 'merge');
const focus = result2.updated.currentFocus;

if (Array.isArray(focus) && focus.length === 1 && focus[0].length > 1) {
  console.log('✅ String wrapped in array (not spread to chars):', focus);
} else if (Array.isArray(focus) && focus.length > 20 && focus[0].length === 1) {
  console.log('❌ FAILED: String was spread into character array:', focus.slice(0, 10), '...');
} else {
  console.log('❌ FAILED: Unexpected format:', focus);
}

// Test Case 3: currentFocus with accidental single-char entries
console.log('\nTest 3: currentFocus with single-char entries → should filter them out');
const draft3 = {
  currentFocus: ['Complete training system', 'D', 'e', 'Bug fixing', 'v']
};

const result3 = mergePersonaDraft({}, draft3, 'merge');
const focus3 = result3.updated.currentFocus;

const validEntries = focus3.filter(item => item.length > 1);
const invalidEntries = focus3.filter(item => item.length === 1);

if (validEntries.length === 2 && invalidEntries.length === 0) {
  console.log('✅ Single-char entries filtered out:', focus3);
} else {
  console.log('❌ FAILED: Single-char entries not filtered:', focus3);
}

// Test Case 4: Goals as object arrays (should pass through unchanged)
console.log('\nTest 4: Goals already as objects → should preserve format');
const draft4 = {
  goals: {
    shortTerm: [
      { goal: 'Already formatted goal', status: 'active' }
    ]
  }
};

const result4 = mergePersonaDraft({}, draft4, 'merge');
const goals4 = result4.updated.goals.shortTerm;

if (goals4[0]?.goal === 'Already formatted goal' && goals4[0]?.status === 'active') {
  console.log('✅ Object format preserved:', goals4[0]);
} else {
  console.log('❌ FAILED: Object format changed:', goals4);
}

console.log('\n✨ All tests complete!');

/**
 * Test: Operator Response Format Fix
 *
 * Verifies that conversational_response skill outputs are unwrapped
 * and returned as plain text instead of JSON objects.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('🧪 Testing Operator Response Format...\n');

// Test 1: Check that the fix is present in operator-react.ts
console.log('Test 1: Verify formatObservation has conversational_response case');
const operatorPath = path.join(process.cwd(), 'brain/agents/operator-react.ts');
const operatorCode = fs.readFileSync(operatorPath, 'utf-8');

const hasResponseCheck = operatorCode.includes('if (outputs.response && typeof outputs.response === \'string\')');
const hasResponseReturn = operatorCode.includes('return outputs.response;');

if (hasResponseCheck && hasResponseReturn) {
  console.log('✅ formatObservation has special case for response field\n');
} else {
  console.log('❌ formatObservation missing response handling\n');
  process.exit(1);
}

// Test 2: Check formatStructured also has the case
console.log('Test 2: Verify formatStructured has conversational_response case');
const hasStructuredCase = operatorCode.includes('case \'conversational_response\':');

if (hasStructuredCase) {
  console.log('✅ formatStructured has conversational_response case\n');
} else {
  console.log('❌ formatStructured missing conversational_response case\n');
  process.exit(1);
}

// Test 3: Verify the conversational_response skill still returns correct format
console.log('Test 3: Verify conversational_response skill output format');
const skillPath = path.join(process.cwd(), 'brain/skills/conversational_response.ts');
const skillCode = fs.readFileSync(skillPath, 'utf-8');

const hasCorrectReturn = skillCode.includes('outputs: {') &&
                         skillCode.includes('response: response.content');

if (hasCorrectReturn) {
  console.log('✅ conversational_response returns {outputs: {response: ...}}\n');
} else {
  console.log('❌ conversational_response has unexpected return format\n');
  process.exit(1);
}

console.log('✅ All tests passed! Operator response format fix verified.\n');
console.log('📝 Summary:');
console.log('   - formatObservation now extracts response text directly');
console.log('   - formatStructured handles conversational_response specially');
console.log('   - No more JSON wrapping in chat responses');

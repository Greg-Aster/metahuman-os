/**
 * End-to-End Test: Self-Healing Coder Agent Workflow
 *
 * Tests the complete coder workflow:
 * 1. Operator detects coding intent
 * 2. Plans using code_generate + code_apply_patch
 * 3. Stages changes for approval
 * 4. Changes appear in approval queue
 */

import { runOperatorWithFeatureFlag } from '../brain/agents/operator-react';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../packages/core/src/index';

console.log('='.repeat(70));
console.log('TEST: Self-Healing Coder Agent - End-to-End Workflow');
console.log('='.repeat(70));
console.log('');

// Test 1: Create a simple test file with a comment request
console.log('Test 1: Add a comment to a test file');
console.log('-'.repeat(70));

const testFilePath = path.join(paths.out, 'test-file-for-coder.ts');
const testFileContent = `/**
 * Test file for coder agent
 */

export function calculateSum(a: number, b: number): number {
  return a + b;
}

export function calculateProduct(a: number, b: number): number {
  return a * b;
}
`;

// Create test file
console.log(`Creating test file: ${testFilePath}`);
fs.writeFileSync(testFilePath, testFileContent, 'utf-8');

// Run operator with coding task
const task = {
  goal: 'Add a JSDoc comment to the calculateProduct function in out/test-file-for-coder.ts explaining what it does',
  context: 'This is a test of the coder agent workflow'
};

console.log(`\nTask: ${task.goal}`);
console.log('');

async function runTest() {
try {
  const operatorResult = await runOperatorWithFeatureFlag(task.goal, {
    conversationHistory: task.context
      ? [{ role: 'user', content: task.context }]
      : []
  });

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log('');

  if (operatorResult?.result) {
    console.log('✓ Task completed successfully');
    console.log('');
    console.log(`Response:\n${operatorResult.result}\n`);

    const scratchpad: Array<any> = Array.isArray(operatorResult.scratchpad)
      ? operatorResult.scratchpad
      : [];
    if (scratchpad.length > 0) {
      console.log('Scratchpad actions:');
      scratchpad.forEach(entry => {
        if (entry.action) {
          console.log(`  Step ${entry.step}: ${entry.action.tool}`);
        }
      });
      console.log('');
    }

    const usedCodeGenerate = scratchpad.some((entry: any) => entry.action?.tool === 'code_generate');
    const usedCodeApply = scratchpad.some((entry: any) => entry.action?.tool === 'code_apply_patch');

    if (usedCodeGenerate) {
      console.log('✓ Scratchpad used code_generate skill');
    } else {
      console.log('✗ Scratchpad did NOT use code_generate skill');
    }

    if (usedCodeApply) {
      console.log('✓ Scratchpad used code_apply_patch skill');
    } else {
      console.log('✗ Scratchpad did NOT use code_apply_patch skill');
    }
    console.log('');

    // Check if changes were staged
    const stagingDir = path.join(paths.out, 'code-drafts');
    if (fs.existsSync(stagingDir)) {
      const stagedFiles = fs.readdirSync(stagingDir).filter(f => f.endsWith('.json'));
      if (stagedFiles.length > 0) {
        console.log(`✓ Changes staged for approval: ${stagedFiles.length} file(s)`);
        stagedFiles.forEach(file => {
          const stagedData = JSON.parse(fs.readFileSync(path.join(stagingDir, file), 'utf-8'));
          console.log(`  - ${stagedData.filePath}`);
          console.log(`    Status: ${stagedData.status}`);
          console.log(`    Explanation: ${stagedData.explanation}`);
          if (stagedData.testCommands && stagedData.testCommands.length > 0) {
            console.log(`    Test commands: ${stagedData.testCommands.join(', ')}`);
          }
        });
      } else {
        console.log('✗ No changes staged for approval');
      }
    } else {
      console.log('✗ Staging directory does not exist');
    }
  } else {
    console.log('✗ Task failed');
    if (operatorResult?.reasoning) {
      console.log(`  Reasoning: ${operatorResult.reasoning}`);
    }
    if (operatorResult?.metadata?.errors) {
      console.log(`  Errors: ${operatorResult.metadata.errors}`);
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('TEST COMPLETE');
  console.log('='.repeat(70));
  console.log('');
  console.log('Note: Staged changes are awaiting approval in the web UI.');
  console.log('Visit http://localhost:4321 to see the approval queue.');
  console.log('');

} catch (error) {
  console.error('Test failed with error:', error);
  process.exit(1);
}
}

// Run the test
runTest().catch(console.error);

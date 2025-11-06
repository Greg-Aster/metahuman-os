/**
 * Test the ReAct Operator
 *
 * This test reproduces the original failure case:
 * - Task: "List all files in docs/user-guide"
 * - Expected: fs_list → observe actual filenames → report them
 * - NOT: hallucinate filenames like "01-intro.md", "02-setup.md"
 */

import { runReActLoop } from '../brain/agents/operator-react.ts';
import { initializeSkills } from '../brain/skills/index.ts';

console.log('=== ReAct Operator Test ===\n');

// Initialize skills
console.log('Initializing skills...');
initializeSkills();

// Test task
const task = {
  id: 'test-001',
  goal: 'List all files in the docs/user-guide directory and summarize their purpose',
  status: 'in_progress',
  created: new Date().toISOString(),
};

console.log(`Goal: ${task.goal}\n`);
console.log('Starting ReAct loop...\n');

try {
  const context = await runReActLoop(task, (step) => {
    // Log each step as it happens
    console.log(`\n--- Step ${step.iteration} ---`);
    console.log(`Thought: ${step.thought}`);
    console.log(`Action: ${step.action}(${JSON.stringify(step.actionInput)})`);
    console.log(`Observation: ${step.observation.substring(0, 300)}${step.observation.length > 300 ? '...' : ''}`);
  });

  console.log('\n\n=== FINAL RESULT ===');
  console.log(`Completed: ${context.completed}`);
  console.log(`Iterations: ${context.steps.length}`);
  console.log(`Error: ${context.error || 'None'}`);
  console.log(`\nResult:\n${context.result}`);

  // Verify it didn't hallucinate filenames
  console.log('\n\n=== VERIFICATION ===');
  const hasHallucinatedFilenames = context.steps.some(step =>
    step.actionInput?.path?.includes('01-intro.md') ||
    step.actionInput?.path?.includes('02-setup.md')
  );

  if (hasHallucinatedFilenames) {
    console.log('❌ FAILED: Operator hallucinated filenames');
    process.exit(1);
  } else {
    console.log('✅ PASSED: No hallucinated filenames detected');
  }

  // Verify it actually listed files
  const usedFsList = context.steps.some(step => step.action === 'fs_list');
  if (usedFsList) {
    console.log('✅ PASSED: Operator used fs_list to get actual filenames');
  } else {
    console.log('❌ FAILED: Operator did not use fs_list');
    process.exit(1);
  }

  console.log('\n✅ All tests passed!');
  process.exit(0);

} catch (error) {
  console.error('\n❌ TEST FAILED');
  console.error(error);
  process.exit(1);
}

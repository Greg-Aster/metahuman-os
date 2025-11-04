/**
 * Test Actual Skill Execution
 */
import { deepInitializeSkills } from './deep_debug.ts';
import { executeSkill, loadTrustLevel, getAvailableSkills, listSkills } from '../../packages/core/src/skills.js';

async function testActualExecution() {
  console.log('=== Test Actual Skill Execution ===');
  
  // Initialize skills
  console.log('Initializing skills...');
  deepInitializeSkills();
  
  const trustLevel = loadTrustLevel();
  console.log('Trust level:', trustLevel);
  
  // List available skills
  const availableSkills = getAvailableSkills(trustLevel);
  console.log('Available skills count:', availableSkills.length);
  console.log('Available skills:', availableSkills.map(s => s.id));
  
  // Test fs_write skill
  console.log('\\n--- Testing fs_write skill ---');
  const writeResult = await executeSkill('fs_write', {
    path: './out/test_execution.txt',
    content: 'Hello from MetaHuman OS - Actual Skill Execution Test'
  }, trustLevel);
  
  console.log('Write Result:', JSON.stringify(writeResult, null, 2));
  
  // Test fs_read skill if write succeeded
  if (writeResult.success) {
    console.log('\\n--- Testing fs_read skill ---');
    const readResult = await executeSkill('fs_read', {
      path: './out/test_execution.txt'
    }, trustLevel);
    
    console.log('Read Result:', JSON.stringify(readResult, null, 2));
    
    // Show the actual file content
    if (readResult.success && readResult.outputs?.content) {
      console.log('Actual file content:', readResult.outputs.content);
    }
  }
  
  // Test shell_safe skill
  console.log('\\n--- Testing shell_safe skill ---');
  const shellResult = await executeSkill('shell_safe', {
    command: 'echo',
    args: ['Hello from shell command']
  }, trustLevel);
  
  console.log('Shell Result:', JSON.stringify(shellResult, null, 2));
}

testActualExecution().catch(console.error);
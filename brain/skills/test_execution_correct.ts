/**
 * Test Actual Skill Execution with Correct Paths
 */
import { deepInitializeSkills } from './deep_debug.ts';
import { executeSkill, loadTrustLevel, getAvailableSkills, listSkills } from '../../packages/core/src/skills.js';
import { paths } from '../../packages/core/src/paths.js';
import path from 'node:path';

async function testActualExecution() {
  console.log('=== Test Actual Skill Execution with Correct Paths ===');
  
  // Initialize skills
  console.log('Initializing skills...');
  deepInitializeSkills();
  
  const trustLevel = loadTrustLevel();
  console.log('Trust level:', trustLevel);
  console.log('Project root:', paths.root);
  
  // List available skills
  const availableSkills = getAvailableSkills(trustLevel);
  console.log('Available skills count:', availableSkills.length);
  console.log('Available skills:', availableSkills.map(s => s.id));
  
  // Test fs_write skill with correct absolute path
  const testFilePath = path.join(paths.root, 'out', 'test_execution_correct.txt');
  console.log('\\n--- Testing fs_write skill with correct path ---');
  console.log('Writing to:', testFilePath);
  
  const writeResult = await executeSkill('fs_write', {
    path: testFilePath,
    content: 'Hello from MetaHuman OS - Correct Path Test'
  }, trustLevel);
  
  console.log('Write Result:', JSON.stringify(writeResult, null, 2));
  
  // Test fs_read skill if write succeeded
  if (writeResult.success) {
    console.log('\\n--- Testing fs_read skill ---');
    const readResult = await executeSkill('fs_read', {
      path: testFilePath
    }, trustLevel);
    
    console.log('Read Result:', JSON.stringify(readResult, null, 2));
    
    // Show the actual file content
    if (readResult.success && readResult.outputs?.content) {
      console.log('Actual file content:', readResult.outputs.content);
    }
  }
  
  // Test with a relative path within out/
  console.log('\\n--- Testing fs_write with relative path ---');
  const relativePath = path.join(paths.root, 'out', 'test_relative.txt');
  console.log('Relative path:', relativePath);
  
  const relativeWriteResult = await executeSkill('fs_write', {
    path: relativePath,
    content: 'Hello from MetaHuman OS - Relative Path Test'
  }, trustLevel);
  
  console.log('Relative Write Result:', JSON.stringify(relativeWriteResult, null, 2));
}

testActualExecution().catch(console.error);
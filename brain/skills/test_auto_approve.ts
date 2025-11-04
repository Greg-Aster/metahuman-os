/**
 * Test Actual Skill Execution with Auto Approval
 */
import { deepInitializeSkills } from './deep_debug.ts';
import { executeSkill, loadTrustLevel, getAvailableSkills, listSkills } from '../../packages/core/src/skills.js';
import { paths } from '../../packages/core/src/paths.js';
import path from 'node:path';

async function testActualExecution() {
  console.log('=== Test Actual Skill Execution with Auto Approval ===');
  
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
  
  // Test fs_write skill with auto approval
  const testFilePath = path.join(paths.root, 'out', 'test_auto_approved.txt');
  console.log('\\n--- Testing fs_write skill with auto approval ---');
  console.log('Writing to:', testFilePath);
  
  const writeResult = await executeSkill('fs_write', {
    path: testFilePath,
    content: 'Hello from MetaHuman OS - Auto Approved Test'
  }, trustLevel, true); // autoApprove = true
  
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
  
  // Test creating a directory and writing to it
  console.log('\\n--- Testing nested directory creation ---');
  const nestedFilePath = path.join(paths.root, 'out', 'nested', 'test_nested.txt');
  console.log('Writing to nested path:', nestedFilePath);
  
  const nestedWriteResult = await executeSkill('fs_write', {
    path: nestedFilePath,
    content: 'Hello from MetaHuman OS - Nested Directory Test'
  }, trustLevel, true); // autoApprove = true
  
  console.log('Nested Write Result:', JSON.stringify(nestedWriteResult, null, 2));
}

testActualExecution().catch(console.error);
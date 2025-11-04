/**
 * Test Skills System from Within the Packages Directory
 */

// This will be run from within the packages/core directory
import { initializeSkills } from '../../brain/skills/index.ts';
import { executeSkill, loadTrustLevel, getAvailableSkills, listSkills } from './src/skills.js';
import { paths } from './src/paths.js';
import path from 'node:path';

async function testSkills() {
  console.log('=== Testing Skills System ===');
  
  // Initialize skills
  console.log('Initializing skills...');
  initializeSkills();
  
  const trustLevel = loadTrustLevel();
  console.log('Trust level:', trustLevel);
  
  // List all skills
  console.log('All skills:', listSkills().map(s => s.id));
  
  // List available skills
  const availableSkills = getAvailableSkills(trustLevel);
  console.log('Available skills:', availableSkills.map(s => s.id));
  
  // Test fs_write skill
  console.log('\n--- Testing fs_write skill ---');
  const testPath = path.join(paths.root, 'out', 'skills_test.txt');
  console.log('Writing to:', testPath);
  
  const writeResult = await executeSkill('fs_write', {
    path: testPath,
    content: 'Hello from MetaHuman OS - Skills System Test!'
  }, trustLevel, true); // Auto-approve
  
  console.log('Write Result:', JSON.stringify(writeResult, null, 2));
  
  // Test fs_read skill if write succeeded
  if (writeResult.success) {
    console.log('\n--- Testing fs_read skill ---');
    const readResult = await executeSkill('fs_read', {
      path: testPath
    }, trustLevel);
    
    console.log('Read Result:', JSON.stringify(readResult, null, 2));
    
    // Show actual content
    if (readResult.success && readResult.outputs?.content) {
      console.log('Actual content:', readResult.outputs.content);
    }
  }
}

testSkills().catch(console.error);
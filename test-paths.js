import { systemPaths, listAvailableAgents } from '@metahuman/core';
import fs from 'node:fs';

console.log('=== Testing Path Resolution ===');
console.log('Root:', systemPaths.root);
console.log('Agents dir:', systemPaths.agents);
console.log('Agents dir exists:', fs.existsSync(systemPaths.agents));

console.log('\n=== Directory contents ===');
if (fs.existsSync(systemPaths.agents)) {
  const entries = fs.readdirSync(systemPaths.agents, { withFileTypes: true });
  console.log('Number of entries:', entries.length);
  entries.slice(0, 5).forEach(entry => {
    console.log(`  ${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`);
  });
}

console.log('\n=== Testing listAvailableAgents ===');
try {
  const agents = listAvailableAgents();
  console.log('Available agents:', agents.length);
  console.log('First 5 agents:', agents.slice(0, 5));
} catch (error) {
  console.error('Error listing agents:', error);
}
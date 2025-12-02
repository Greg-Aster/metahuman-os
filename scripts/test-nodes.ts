/**
 * Test script for new node registry
 */

import { allNodes, getRegistryStats, getNodeExecutor } from '../packages/core/src/nodes/index.js';

console.log('Registry loaded successfully!');
console.log('Total nodes:', allNodes.length);
console.log('By category:', JSON.stringify(getRegistryStats().byCategory, null, 2));
console.log('');
console.log('Sample nodes:');
for (const node of allNodes.slice(0, 8)) {
  console.log(`  - ${node.id} (${node.category}): ${node.name}`);
}
console.log('');
console.log('Testing getNodeExecutor:');
console.log('  user_input:', getNodeExecutor('user_input') ? '✓' : '✗');
console.log('  persona_llm:', getNodeExecutor('persona_llm') ? '✓' : '✗');
console.log('  cognitive/user_input:', getNodeExecutor('cognitive/user_input') ? '✓' : '✗');
console.log('  react_planner:', getNodeExecutor('react_planner') ? '✓' : '✗');
console.log('  skill_executor:', getNodeExecutor('skill_executor') ? '✓' : '✗');
console.log('  response_synthesizer:', getNodeExecutor('response_synthesizer') ? '✓' : '✗');
console.log('  big_brother:', getNodeExecutor('big_brother') ? '✓' : '✗');

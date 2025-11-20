/**
 * Test Agent Graph Executor
 *
 * Validates that:
 * 1. Agent templates can be loaded from disk
 * 2. Templates can be validated
 * 3. Templates can be executed
 */

import {
  listAgentTemplates,
  loadAgentTemplate,
  validateAgentTemplate,
  executeAgentTemplate,
} from '@metahuman/core';

console.log('=== Agent Graph Executor Test ===\n');

// Test 1: List available templates
console.log('Test 1: Listing available agent templates...');
const templates = listAgentTemplates();
console.log(`Found ${templates.length} templates:`);
templates.forEach(t => {
  console.log(`  - ${t.name}: ${t.description}`);
});
console.log();

// Test 2: Load organizer template
console.log('Test 2: Loading organizer-agent template...');
const organizerTemplate = loadAgentTemplate('organizer-agent');

if (organizerTemplate) {
  console.log('✓ Template loaded successfully');
  console.log(`  Name: ${organizerTemplate.name}`);
  console.log(`  Description: ${organizerTemplate.description}`);
  console.log(`  Nodes: ${organizerTemplate.nodes.length}`);
  console.log(`  Links: ${organizerTemplate.links.length}`);
  console.log();
} else {
  console.error('✗ Failed to load template');
  process.exit(1);
}

// Test 3: Validate template
console.log('Test 3: Validating organizer-agent template...');
const validation = validateAgentTemplate('organizer-agent');

if (validation.valid) {
  console.log('✓ Template is valid');
} else {
  console.error('✗ Template validation failed:');
  validation.errors.forEach(err => console.error(`  - ${err}`));
  process.exit(1);
}
console.log();

// Test 4: Execute template (dry run)
console.log('Test 4: Executing organizer-agent template...');
try {
  const result = await executeAgentTemplate('organizer-agent', {
    cognitiveMode: 'dual',
  });

  console.log('✓ Template executed successfully');
  console.log(`  Status: ${result.status}`);
  console.log(`  Duration: ${result.endTime - result.startTime}ms`);
  console.log(`  Nodes executed: ${result.nodes.size}`);

  // Show node execution details
  console.log('\n  Node execution details:');
  result.nodes.forEach((nodeState, nodeId) => {
    const duration = nodeState.endTime && nodeState.startTime
      ? nodeState.endTime - nodeState.startTime
      : 'N/A';
    console.log(`    Node ${nodeId}: ${nodeState.status} (${duration}ms)`);

    if (nodeState.error) {
      console.log(`      Error: ${nodeState.error.message}`);
    }
  });

  console.log();

} catch (error) {
  console.error('✗ Template execution failed:');
  console.error(error);
  process.exit(1);
}

console.log('=== All Tests Passed ===');

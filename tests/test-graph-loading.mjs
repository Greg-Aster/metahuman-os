/**
 * Test Graph Loading for Chat API
 *
 * Validates that graph templates can be loaded and executed
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateCognitiveGraph, executeGraph } from '@metahuman/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

console.log('=== Graph Loading Test ===\n');

// Test 1: Load emulation mode graph
console.log('Test 1: Loading emulation-mode.json...');
const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'emulation-mode.json');
console.log(`  Path: ${graphPath}`);

try {
  const raw = readFileSync(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  console.log(`  ✓ JSON parsed successfully`);
  console.log(`    Nodes: ${parsed.nodes?.length || 0}`);
  console.log(`    Links: ${parsed.links?.length || 0}`);

  // Test 2: Validate graph
  console.log('\nTest 2: Validating graph structure...');
  const validated = validateCognitiveGraph(parsed);

  if (validated) {
    console.log('  ✓ Graph validation passed');
    console.log(`    Graph name: ${validated.name}`);
    console.log(`    Cognitive mode: ${validated.cognitiveMode}`);
    console.log(`    Nodes: ${validated.nodes.length}`);
    console.log(`    Links: ${validated.links.length}`);
  } else {
    console.error('  ✗ Graph validation FAILED - validateCognitiveGraph returned null');
    process.exit(1);
  }

  // Test 3: Check node types
  console.log('\nTest 3: Checking node types...');
  const nodeTypes = validated.nodes.map(n => n.type);
  console.log('  Node types in graph:');
  nodeTypes.forEach((type, i) => {
    console.log(`    ${i + 1}. ${type}`);
  });

  // Test 4: Verify graph can be executed (dry run)
  console.log('\nTest 4: Attempting graph execution...');
  const testContext = {
    sessionId: 'test-session',
    userMessage: 'Hello, this is a test',
    cognitiveMode: 'emulation',
    userId: 'test-user',
    username: 'testuser',
    conversationHistory: [],
    allowMemoryWrites: false,
  };

  const startTime = Date.now();
  const result = await executeGraph(validated, testContext, event => {
    if (event.type === 'node_started') {
      console.log(`    → Node ${event.nodeId} (${event.data.type}) started`);
    }
    if (event.type === 'node_completed') {
      console.log(`    ✓ Node ${event.nodeId} completed`);
    }
    if (event.type === 'node_error') {
      console.error(`    ✗ Node ${event.nodeId} error: ${event.data?.error}`);
    }
  });

  const duration = Date.now() - startTime;

  console.log(`\n  ✓ Graph executed in ${duration}ms`);
  console.log(`    Status: ${result.status}`);
  console.log(`    Nodes executed: ${result.nodes.size}`);

  if (result.status === 'error') {
    console.error('  ✗ Graph execution had errors:');
    for (const [nodeId, state] of result.nodes) {
      if (state.status === 'error') {
        console.error(`    Node ${nodeId}: ${state.error}`);
      }
    }
    process.exit(1);
  }

} catch (error) {
  console.error('✗ Test failed:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
}

console.log('\n=== All Tests Passed ===');
console.log('Graph loading system is operational');

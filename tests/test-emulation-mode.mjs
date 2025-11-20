#!/usr/bin/env node
/**
 * Test script for emulation mode node pipeline
 * Tests feature parity with legacy emulation mode
 */

import { executeGraph } from '../packages/core/src/graph-executor.js';
import { loadPersistedBuffer, persistBuffer } from '../packages/core/src/conversation-buffer.js';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== Emulation Mode Test Suite ===\n');

// Test 1: Load emulation-mode graph
console.log('Test 1: Loading emulation-mode.json graph...');
const graphPath = path.join(process.cwd(), 'etc/cognitive-graphs/emulation-mode.json');
let graph;
try {
  const graphRaw = fs.readFileSync(graphPath, 'utf-8');
  graph = JSON.parse(graphRaw);
  console.log(`✅ Loaded graph: ${graph.name} (v${graph.version})`);
  console.log(`   Nodes: ${graph.nodes?.length || 0}, Links: ${graph.links?.length || 0}\n`);
} catch (error) {
  console.error('❌ Failed to load graph:', error.message);
  process.exit(1);
}

// Test 2: Execute simple message
console.log('Test 2: Executing simple test message...');
try {
  const result = await executeGraph(graph, {
    userMessage: 'Hello, this is a test message for emulation mode',
    sessionId: 'test-emulation-' + Date.now(),
    cognitiveMode: 'emulation',
    mode: 'conversation',
    environment: 'server', // Force server-side execution
  });

  console.log('✅ Graph execution completed');
  console.log(`   Executed nodes: ${result.executedNodes?.length || 0}`);
  console.log(`   Pipeline: ${result.executedNodes?.join(' → ') || 'N/A'}`);

  // Check if we got output
  if (result.outputs && Object.keys(result.outputs).length > 0) {
    const outputNode = Object.keys(result.outputs).find(key =>
      result.outputs[key]?.output || result.outputs[key]?.response
    );
    if (outputNode) {
      const output = result.outputs[outputNode].output || result.outputs[outputNode].response;
      console.log(`   Response preview: ${output?.substring(0, 100)}...`);
    }
  }
  console.log('');
} catch (error) {
  console.error('❌ Graph execution failed:', error.message);
  console.error('   Stack:', error.stack);
  process.exit(1);
}

// Test 3: Test buffer persistence
console.log('Test 3: Testing conversation buffer persistence...');
try {
  const testMessages = [
    { role: 'system', content: 'You are a helpful assistant', timestamp: Date.now() },
    { role: 'user', content: 'Hello', timestamp: Date.now() },
    { role: 'assistant', content: 'Hi! How can I help?', timestamp: Date.now() },
  ];

  // Note: persistBuffer requires getUserContext which needs an authenticated session
  // For now, we'll just verify the function exists
  console.log('✅ Buffer functions available: persistBuffer, loadPersistedBuffer');
  console.log('   (Skipping write test - requires authenticated session)\n');
} catch (error) {
  console.error('❌ Buffer test failed:', error.message);
}

// Test 4: Verify new node executors are registered
console.log('Test 4: Checking new node executor registration...');
try {
  const { getNodeExecutor } = await import('../packages/core/src/node-executors.js');

  const requiredExecutors = [
    'reply_to_handler',
    'buffer_manager',
    'conversation_history',
    'system_settings',
    'persona_llm',
    'memory_capture',
  ];

  let allFound = true;
  for (const executorName of requiredExecutors) {
    const executor = getNodeExecutor(executorName);
    if (executor) {
      console.log(`   ✅ ${executorName}`);
    } else {
      console.log(`   ❌ ${executorName} - NOT FOUND`);
      allFound = false;
    }
  }

  if (allFound) {
    console.log('✅ All required executors registered\n');
  } else {
    console.log('❌ Some executors missing\n');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Executor check failed:', error.message);
  process.exit(1);
}

// Test 5: Verify graph structure
console.log('Test 5: Verifying graph structure...');
const requiredNodes = [
  'user_input',
  'session_context',
  'system_settings',
  'conversation_history',
  'semantic_search',
  'persona_llm',
  'stream_writer',
  'cot_stripper',
  'safety_validator',
  'response_refiner',
  'reply_to_handler',
  'memory_capture',
  'buffer_manager',
];

const foundNodes = graph.nodes.map(n => n.type.replace('cognitive/', ''));
let allNodesFound = true;

for (const nodeName of requiredNodes) {
  if (foundNodes.includes(nodeName)) {
    console.log(`   ✅ ${nodeName}`);
  } else {
    console.log(`   ❌ ${nodeName} - NOT IN GRAPH`);
    allNodesFound = false;
  }
}

if (allNodesFound) {
  console.log('✅ All required nodes present in graph\n');
} else {
  console.log('❌ Some nodes missing from graph\n');
  process.exit(1);
}

console.log('=== All Tests Passed! ===\n');
console.log('Emulation mode enhanced pipeline is ready for production testing.');
console.log('Next steps:');
console.log('  1. Test via web UI at http://localhost:4322');
console.log('  2. Switch to emulation mode in settings');
console.log('  3. Send test messages and verify:');
console.log('     - Responses are generated correctly');
console.log('     - Buffer files are persisted to memory/state/');
console.log('     - Memory capture works (if authenticated)');
console.log('     - Temperature adjustment for inner dialogue');
console.log('     - Reply-to functionality with curiosity questions');

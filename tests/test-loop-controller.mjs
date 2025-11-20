/**
 * Loop Controller Integration Test
 *
 * Tests the node-based ReAct loop controller implementation to verify:
 * 1. Multi-step iteration execution
 * 2. Scratchpad state persistence
 * 3. Completion detection (early and max iterations)
 * 4. Stuck state handling
 * 5. Tool invocation memory capture
 * 6. End-to-end graph execution
 */

import { executeGraph } from '@metahuman/core/graph-executor';
import { searchMemory } from '@metahuman/core';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load the dual-mode graph
const graphPath = join(process.cwd(), 'etc/cognitive-graphs/dual-mode.json');
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));

console.log('🧪 Loop Controller Integration Test\n');
console.log('━'.repeat(80));

/**
 * Test 1: Simple single-iteration task (early completion)
 */
async function testEarlyCompletion() {
  console.log('\n📝 Test 1: Early Completion Detection');
  console.log('Task: "What is 2+2?"');

  const context = {
    environment: 'server',
    userMessage: 'What is 2+2?',
    sessionId: 'test-session-1',
    conversationId: 'test-conv-1',
    cognitiveMode: 'dual',
    allowMemoryWrites: false, // Disable memory writes for testing
  };

  const startTime = Date.now();

  try {
    const result = await executeGraph(graph, context);
    const duration = Date.now() - startTime;

    console.log(`✅ Test completed in ${duration}ms`);
    console.log(`Status: ${result.status}`);

    // Check loop controller output
    const loopNode = result.nodes.get(9); // Loop controller is node 9
    if (loopNode?.outputs) {
      console.log(`Iterations: ${loopNode.outputs.iterationCount}`);
      console.log(`Completed: ${loopNode.outputs.completed}`);
      console.log(`Stuck: ${loopNode.outputs.stuck}`);

      if (loopNode.outputs.iterationCount <= 2) {
        console.log('✅ PASS: Task completed efficiently (≤2 iterations)');
      } else {
        console.log('⚠️  WARN: Task took more iterations than expected');
      }
    }
  } catch (error) {
    console.error('❌ FAIL:', error.message);
  }
}

/**
 * Test 2: Multi-step task requiring iteration
 */
async function testMultiStepTask() {
  console.log('\n📝 Test 2: Multi-Step Task Execution');
  console.log('Task: "List my active tasks and count them"');

  const context = {
    environment: 'server',
    userMessage: 'List my active tasks and count them',
    sessionId: 'test-session-2',
    conversationId: 'test-conv-2',
    cognitiveMode: 'dual',
    allowMemoryWrites: false,
  };

  const startTime = Date.now();

  try {
    const result = await executeGraph(graph, context);
    const duration = Date.now() - startTime;

    console.log(`✅ Test completed in ${duration}ms`);
    console.log(`Status: ${result.status}`);

    const loopNode = result.nodes.get(9);
    if (loopNode?.outputs) {
      console.log(`Iterations: ${loopNode.outputs.iterationCount}`);
      console.log(`Completed: ${loopNode.outputs.completed}`);
      console.log(`Scratchpad entries: ${loopNode.outputs.scratchpad?.length || 0}`);

      // Verify scratchpad structure
      if (loopNode.outputs.scratchpad && loopNode.outputs.scratchpad.length > 0) {
        const firstStep = loopNode.outputs.scratchpad[0];
        if (firstStep.thought && firstStep.action && firstStep.observation) {
          console.log('✅ PASS: Scratchpad has proper structure (thought/action/observation)');
        } else {
          console.log('❌ FAIL: Scratchpad missing expected fields');
        }
      }

      // Verify multi-step execution
      if (loopNode.outputs.iterationCount >= 2) {
        console.log('✅ PASS: Multi-step execution verified (≥2 iterations)');
      } else {
        console.log('⚠️  WARN: Task completed in single step');
      }
    }
  } catch (error) {
    console.error('❌ FAIL:', error.message);
  }
}

/**
 * Test 3: Scratchpad trimming (token management)
 */
async function testScratchpadTrimming() {
  console.log('\n📝 Test 3: Scratchpad Trimming (Token Management)');
  console.log('Task: Complex query to trigger multiple iterations');

  const context = {
    environment: 'server',
    userMessage: 'Search my memories for "test", then list tasks, then count them, then summarize',
    sessionId: 'test-session-3',
    conversationId: 'test-conv-3',
    cognitiveMode: 'dual',
    allowMemoryWrites: false,
  };

  const startTime = Date.now();

  try {
    const result = await executeGraph(graph, context);
    const duration = Date.now() - startTime;

    console.log(`✅ Test completed in ${duration}ms`);

    const loopNode = result.nodes.get(9);
    if (loopNode?.outputs?.scratchpad) {
      const scratchpadSize = loopNode.outputs.scratchpad.length;
      console.log(`Scratchpad entries: ${scratchpadSize}`);
      console.log(`Total iterations: ${loopNode.outputs.iterationCount}`);

      if (scratchpadSize <= 10) {
        console.log('✅ PASS: Scratchpad properly trimmed (≤10 entries)');
      } else {
        console.log(`❌ FAIL: Scratchpad exceeded limit (${scratchpadSize} > 10)`);
      }

      // Verify field truncation
      const lastStep = loopNode.outputs.scratchpad[scratchpadSize - 1];
      if (lastStep.thought && lastStep.thought.length <= 500) {
        console.log('✅ PASS: Fields truncated for token efficiency (≤500 chars)');
      }
    }
  } catch (error) {
    console.error('❌ FAIL:', error.message);
  }
}

/**
 * Test 4: Stuck state detection (max iterations)
 */
async function testMaxIterations() {
  console.log('\n📝 Test 4: Max Iteration Limit');
  console.log('Note: This test may take ~30-60 seconds');

  const context = {
    environment: 'server',
    userMessage: 'Keep searching for "nonexistent-impossible-query-12345" until you find something',
    sessionId: 'test-session-4',
    conversationId: 'test-conv-4',
    cognitiveMode: 'dual',
    allowMemoryWrites: false,
  };

  const startTime = Date.now();

  try {
    const result = await executeGraph(graph, context);
    const duration = Date.now() - startTime;

    console.log(`✅ Test completed in ${duration}ms`);

    const loopNode = result.nodes.get(9);
    if (loopNode?.outputs) {
      console.log(`Iterations: ${loopNode.outputs.iterationCount}`);
      console.log(`Stuck: ${loopNode.outputs.stuck}`);
      console.log(`Stuck reason: ${loopNode.outputs.stuckReason || 'N/A'}`);

      if (loopNode.outputs.stuck && loopNode.outputs.iterationCount >= 10) {
        console.log('✅ PASS: Max iteration limit enforced (10 iterations)');
      } else if (loopNode.outputs.completed) {
        console.log('⚠️  WARN: Task completed unexpectedly');
      } else {
        console.log('❌ FAIL: Stuck state not properly detected');
      }
    }
  } catch (error) {
    console.error('❌ FAIL:', error.message);
  }
}

/**
 * Test 5: Tool invocation memory capture
 */
async function testToolMemoryCapture() {
  console.log('\n📝 Test 5: Tool Invocation Memory Capture');
  console.log('Task: "List my tasks" (with memory capture enabled)');

  const context = {
    environment: 'server',
    userMessage: 'List my active tasks',
    sessionId: 'test-session-5',
    conversationId: 'test-conv-5',
    cognitiveMode: 'dual',
    allowMemoryWrites: true, // Enable memory capture
  };

  const startTime = Date.now();

  try {
    const result = await executeGraph(graph, context);
    const duration = Date.now() - startTime;

    console.log(`✅ Test completed in ${duration}ms`);

    // Wait a moment for memory write to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Search for tool_invocation events
    const toolEvents = await searchMemory('tool_invocation', {
      type: 'tool_invocation',
      limit: 5,
    });

    if (toolEvents.length > 0) {
      console.log(`✅ PASS: Found ${toolEvents.length} tool_invocation event(s)`);

      const latestEvent = toolEvents[0];
      if (latestEvent.metadata?.toolName && latestEvent.metadata?.executionTimeMs !== undefined) {
        console.log(`   Tool: ${latestEvent.metadata.toolName}`);
        console.log(`   Execution time: ${latestEvent.metadata.executionTimeMs}ms`);
        console.log(`   Success: ${latestEvent.metadata.success}`);
        console.log('✅ PASS: Tool invocation metadata captured correctly');
      }
    } else {
      console.log('⚠️  WARN: No tool_invocation events found (may be expected if memory policies restrict)');
    }
  } catch (error) {
    console.error('❌ FAIL:', error.message);
  }
}

/**
 * Test 6: End-to-end pipeline execution
 */
async function testEndToEndPipeline() {
  console.log('\n📝 Test 6: End-to-End Pipeline Execution');
  console.log('Task: Realistic user query');

  const context = {
    environment: 'server',
    userMessage: 'What tasks do I have pending and what should I focus on?',
    sessionId: 'test-session-6',
    conversationId: 'test-conv-6',
    cognitiveMode: 'dual',
    allowMemoryWrites: false,
  };

  const startTime = Date.now();

  try {
    const result = await executeGraph(graph, context);
    const duration = Date.now() - startTime;

    console.log(`✅ Test completed in ${duration}ms`);
    console.log(`Status: ${result.status}`);

    // Verify all pipeline nodes executed
    const expectedNodes = [1, 2, 3, 6, 7, 8, 9, 13, 17, 18, 19, 14, 15, 16];
    let allNodesExecuted = true;

    for (const nodeId of expectedNodes) {
      const nodeState = result.nodes.get(nodeId);
      if (!nodeState || nodeState.status !== 'completed') {
        console.log(`⚠️  Node ${nodeId} did not complete successfully`);
        allNodesExecuted = false;
      }
    }

    if (allNodesExecuted) {
      console.log('✅ PASS: All pipeline nodes executed successfully');
    } else {
      console.log('❌ FAIL: Some pipeline nodes failed');
    }

    // Check for final response
    const streamWriter = result.nodes.get(16);
    if (streamWriter?.outputs) {
      console.log('✅ PASS: Final response generated');
    } else {
      console.log('❌ FAIL: No final response generated');
    }

  } catch (error) {
    console.error('❌ FAIL:', error.message);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n🚀 Starting Loop Controller Integration Tests');
  console.log(`Graph: ${graph.name} (v${graph.version})`);
  console.log(`Nodes: ${graph.nodes.length}`);
  console.log('━'.repeat(80));

  try {
    await testEarlyCompletion();
    await testMultiStepTask();
    await testScratchpadTrimming();
    await testMaxIterations();
    await testToolMemoryCapture();
    await testEndToEndPipeline();

    console.log('\n━'.repeat(80));
    console.log('✅ All tests completed!');
    console.log('\nNext steps:');
    console.log('1. Review test output for any failures or warnings');
    console.log('2. Test with dev server: pnpm dev');
    console.log('3. Send real user messages via web UI');
    console.log('4. Check logs/graph-traces.ndjson for execution traces');
    console.log('5. Verify memory/episodic/ for tool_invocation events');

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(console.error);

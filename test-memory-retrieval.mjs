#!/usr/bin/env node
/**
 * Test memory retrieval with and without semantic index
 */

import { buildContextPackage } from './packages/core/src/context-builder.ts';
import { getIndexStatus } from './packages/core/src/vector-index.ts';

async function testMemoryRetrieval() {
  console.log('=== Memory Retrieval Test ===\n');

  // Check index status
  const indexStatus = await getIndexStatus();
  console.log('Index status:', indexStatus.exists ? 'EXISTS' : 'NOT BUILT');
  if (indexStatus.exists) {
    console.log('Index info:', indexStatus);
  }
  console.log();

  // Test 1: Ask about a memory topic that exists in the index
  const testQuery = "What are my fears about creativity?";
  console.log(`Test Query: "${testQuery}"\n`);

  try {
    const contextPackage = await buildContextPackage(testQuery, 'dual', {
      searchDepth: 'normal',
      maxMemories: 3,
      similarityThreshold: 0.6,
      filterInnerDialogue: true,
      filterReflections: false,  // Don't filter reflections for this test
      includePersonaCache: true,
      forceSemanticSearch: true
    });

    console.log('Context Package Results:');
    console.log('- Index Status:', contextPackage.indexStatus);
    console.log('- Fallback Used:', contextPackage.fallbackUsed);
    console.log('- Memory Count:', contextPackage.memoryCount);
    console.log('- Active Tasks:', contextPackage.activeTasks.length);
    console.log();

    if (contextPackage.memoryCount > 0) {
      console.log('Retrieved Memories:');
      contextPackage.memories.forEach((mem, idx) => {
        console.log(`\n${idx + 1}. [Score: ${mem.score?.toFixed(3)}]`);
        console.log(`   Content: ${mem.content?.substring(0, 100)}...`);
        console.log(`   Timestamp: ${mem.timestamp}`);
        console.log(`   Tags: ${mem.tags?.join(', ') || 'none'}`);
      });
    } else {
      console.log('⚠️  No memories retrieved!');
      if (contextPackage.indexStatus === 'missing') {
        console.log('\nReason: Semantic index not built.');
        console.log('The context builder is falling back to empty memories.');
        console.log('\nTo fix: Run `./bin/mh index build` to create the vector index.');
      }
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testMemoryRetrieval();

#!/usr/bin/env tsx
/**
 * Test Function Retrieval
 *
 * Tests that the operator retrieves and uses function guides from the vector index.
 */

import { buildContextPackage } from '@metahuman/core/context-builder';

async function testFunctionRetrieval() {
  console.log('🧪 Testing function retrieval...\n');

  const testQueries = [
    'what tasks do I have?',
    'can you list my tasks?',
    'search my memories for project X',
    'create a new task for testing',
  ];

  for (const query of testQueries) {
    console.log(`\n📝 Query: "${query}"`);
    console.log('━'.repeat(80));

    try {
      const context = await buildContextPackage(
        query,
        'dual', // cognitive mode
        {
          maxMemories: 5,
          userId: 'test-user',
        }
      );

      console.log(`✓ Function guides retrieved: ${context.functionGuides.length}`);

      if (context.functionGuides.length > 0) {
        console.log('\n🔧 Matching functions:');
        for (const guide of context.functionGuides) {
          console.log(`   - ${guide.title} (${(guide.score * 100).toFixed(1)}% match)`);
          console.log(`     ${guide.summary.substring(0, 80)}...`);
        }
      } else {
        console.log('   ⚠️  No function guides retrieved (may be below 60% threshold)');
      }

      console.log(`\n📊 Context stats:`);
      console.log(`   - Memories: ${context.memoryCount}`);
      console.log(`   - Active tasks: ${context.activeTasks.length}`);
      console.log(`   - Recent tools: ${context.recentTools.length}`);
      console.log(`   - Retrieval time: ${context.retrievalTime}ms`);
    } catch (error) {
      console.error('❌ Error:', (error as Error).message);
    }
  }

  console.log('\n\n✨ Test complete!\n');
}

testFunctionRetrieval().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

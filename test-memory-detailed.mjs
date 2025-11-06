#!/usr/bin/env node
/**
 * Detailed test of memory retrieval with debug info
 */

import { queryIndex } from './packages/core/dist/vector-index.js';

async function testDetailedRetrieval() {
  console.log('=== Detailed Memory Retrieval Test ===\n');

  const testQueries = [
    "What are my fears about creativity?",
    "Tell me about my self-doubt",
    "What have I been reflecting on lately?"
  ];

  for (const query of testQueries) {
    console.log(`\nQuery: "${query}"`);
    console.log('-'.repeat(60));

    try {
      // Test with very low threshold to see ALL results
      const hits = await queryIndex(query, { topK: 5 });

      console.log(`Found ${hits.length} results\n`);

      hits.forEach((hit, idx) => {
        console.log(`${idx + 1}. [Score: ${hit.score.toFixed(4)}]`);
        console.log(`   Content: ${hit.content?.substring(0, 150)}...`);
        console.log(`   Type: ${hit.type || 'unknown'}`);
        console.log(`   Tags: ${hit.tags?.join(', ') || 'none'}`);
        console.log(`   File: ${hit.item?.path?.split('/').pop() || 'unknown'}`);
        console.log();
      });

      // Check if filtering is the issue
      const innerDialogueCount = hits.filter(h => h.type === 'inner_dialogue').length;
      const reflectionCount = hits.filter(h => h.tags?.includes('reflection')).length;
      const dreamCount = hits.filter(h => h.tags?.includes('dream')).length;

      console.log(`Breakdown:`);
      console.log(`  - Inner dialogue: ${innerDialogueCount}`);
      console.log(`  - Reflections: ${reflectionCount}`);
      console.log(`  - Dreams: ${dreamCount}`);
      console.log(`  - Other: ${hits.length - innerDialogueCount - reflectionCount - dreamCount}`);

    } catch (error) {
      console.error('Error:', error);
    }
  }
}

testDetailedRetrieval();

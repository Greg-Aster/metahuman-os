#!/usr/bin/env node
/**
 * Test dream boosting to ensure dreams rank higher than chat conversations
 */

import { buildContextPackage } from './packages/core/src/context-builder.ts';

const query = "Can you tell me about your dreams last night?";

console.log('=== Dream Boosting Test ===\n');
console.log(`Query: "${query}"\n`);

// Build context with smart filtering AND dream boosting
const contextPackage = await buildContextPackage(query, 'dual', {
  searchDepth: 'normal',
  similarityThreshold: 0.55,
  maxMemories: 2,
  filterInnerDialogue: true,
  filterReflections: false,  // Don't filter dreams when asking about them
  forceSemanticSearch: true
});

console.log(`Results:`);
console.log(`  - Memory count: ${contextPackage.memoryCount}`);
console.log(`  - Index used: ${contextPackage.indexStatus === 'available'}`);
console.log();

if (contextPackage.memoryCount > 0) {
  console.log('Retrieved memories (with boosting):');
  for (const mem of contextPackage.memories) {
    console.log(`  - [${mem.type}] Score: ${mem.score?.toFixed(3)}`);
    console.log(`    ${mem.content?.substring(0, 100)}...`);
  }
  console.log();

  const hasDreams = contextPackage.memories.some(m => m.type === 'dream');
  if (hasDreams) {
    console.log('✅ SUCCESS: Dreams are now ranking higher than chat conversations!');
  } else {
    console.log('❌ ISSUE: Still not retrieving dreams');
  }
} else {
  console.log('❌ No memories retrieved');
}

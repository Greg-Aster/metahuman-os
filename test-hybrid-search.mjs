#!/usr/bin/env node
/**
 * Test hybrid search with metadata filters
 */

import { buildContextPackage } from './packages/core/src/context-builder.ts';

const query = "Can you tell me about your dreams last night?";

console.log('=== Hybrid Search Test ===\n');
console.log(`Query: "${query}"\n`);

// Build context WITH metadata filter (proper hybrid search)
const contextPackage = await buildContextPackage(query, 'dual', {
  searchDepth: 'normal',
  similarityThreshold: 0.0,  // Skip threshold when using metadata filter
  maxMemories: 2,
  filterInnerDialogue: true,
  filterReflections: false,  // Don't filter dreams
  metadataFilters: {
    type: ['dream']  // HYBRID SEARCH: Only return dream memories
  },
  forceSemanticSearch: true
});

console.log(`Results:`);
console.log(`  - Memory count: ${contextPackage.memoryCount}`);
console.log(`  - Index used: ${contextPackage.indexStatus === 'available'}`);
console.log();

if (contextPackage.memoryCount > 0) {
  console.log('Retrieved memories (hybrid search with type filter):');
  for (const mem of contextPackage.memories) {
    console.log(`  - [${mem.type}] Score: ${mem.score?.toFixed(3)}`);
    console.log(`    ${mem.content?.substring(0, 100)}...`);
  }
  console.log();

  const hasDreams = contextPackage.memories.every(m => m.type === 'dream');
  if (hasDreams) {
    console.log('✅ SUCCESS: Hybrid search returns ONLY dreams!');
    console.log('Semantic search finds relevant results, metadata filter ensures correct type.');
  } else {
    console.log('❌ ISSUE: Non-dream memories still present');
  }
} else {
  console.log('❌ No memories retrieved - check if dreams pass similarity threshold');
}

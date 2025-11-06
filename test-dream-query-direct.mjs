#!/usr/bin/env node
/**
 * Direct test of dream query to see what's happening
 */

import { buildContextPackage, formatContextForPrompt } from './packages/core/src/context-builder.ts';

const query = "Can you tell me what you dreamed about last night?";

console.log('=== Direct Dream Query Test ===\n');
console.log(`Query: "${query}"\n`);

// Simulate what getRelevantContext does
const askingAboutDreams = /\b(dream|dreams|dreamed|dreaming|nightmare)\b/i.test(query);
const askingAboutReflections = /\b(reflect|reflection|reflections|thought about|thinking about)\b/i.test(query);
const shouldFilterReflections = !askingAboutDreams && !askingAboutReflections;
const threshold = (askingAboutDreams || askingAboutReflections) ? 0.55 : 0.62;

console.log(`Smart filtering:`);
console.log(`  - askingAboutDreams: ${askingAboutDreams}`);
console.log(`  - askingAboutReflections: ${askingAboutReflections}`);
console.log(`  - shouldFilterReflections: ${shouldFilterReflections}`);
console.log(`  - threshold: ${threshold}`);
console.log();

// Build context package
const contextPackage = await buildContextPackage(query, 'dual', {
  searchDepth: 'normal',
  similarityThreshold: threshold,
  maxMemories: 2,
  filterInnerDialogue: true,
  filterReflections: shouldFilterReflections,
  includeShortTermState: true,
  includePersonaCache: true,
  forceSemanticSearch: true
});

console.log(`Context package results:`);
console.log(`  - Index status: ${contextPackage.indexStatus}`);
console.log(`  - Memory count: ${contextPackage.memoryCount}`);
console.log(`  - Fallback used: ${contextPackage.fallbackUsed}`);
console.log();

if (contextPackage.memoryCount > 0) {
  console.log(`Retrieved memories:`);
  for (const mem of contextPackage.memories) {
    console.log(`  - [${mem.type}] Score: ${mem.score?.toFixed(3)}`);
    console.log(`    ${mem.content?.substring(0, 100)}...`);
  }
  console.log();

  // Format for prompt
  const formatted = formatContextForPrompt(contextPackage, {
    maxChars: 900,
    includePersona: true
  });

  console.log(`Formatted context (${formatted.length} chars):`);
  console.log('─'.repeat(60));
  console.log(formatted.substring(0, 500));
  console.log('─'.repeat(60));
  console.log();

  console.log('✅ Dreams should now be retrievable in chat!');
} else {
  console.log('❌ No memories retrieved');
  console.log('\nPossible causes:');
  console.log('1. Index not available');
  console.log('2. All results filtered out');
  console.log('3. All results below threshold');
}

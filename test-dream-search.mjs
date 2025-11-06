#!/usr/bin/env node
/**
 * Test searching for dream memories
 */

import { queryIndex } from './packages/core/src/vector-index.ts';
import { readFileSync } from 'fs';

async function testDreamSearch() {
  console.log('=== Dream Memory Search Test ===\n');

  const queries = [
    "Can you tell me about what you dreamed about last night?",
    "Tell me about your dreams",
    "What did you dream about?",
    "dreams"
  ];

  for (const query of queries) {
    console.log(`Query: "${query}"`);
    console.log('─'.repeat(60));

    const hits = await queryIndex(query, { topK: 10 });
    console.log(`Found ${hits.length} results\n`);

    // Check how many have 'dream' tag
    let dreamCount = 0;
    for (const hit of hits) {
      try {
        const content = readFileSync(hit.item.path, 'utf-8');
        const data = JSON.parse(content);
        if (data.tags && data.tags.includes('dream')) {
          dreamCount++;
        }
      } catch {}
    }

    console.log(`Results with 'dream' tag: ${dreamCount}/${hits.length}\n`);

    // Show top 3 results
    for (let i = 0; i < Math.min(3, hits.length); i++) {
      const hit = hits[i];

      // Load the full file to check tags
      let tags = [];
      try {
        const content = readFileSync(hit.item.path, 'utf-8');
        const data = JSON.parse(content);
        tags = data.tags || [];
      } catch {}

      console.log(`${i+1}. Score: ${hit.score.toFixed(4)} ${tags.includes('dream') ? '🌙' : ''}`);
      console.log(`   Type: ${hit.item.type}`);
      console.log(`   Tags: ${tags.join(', ')}`);
      console.log(`   Text: ${hit.item.text.substring(0, 100)}...`);
      console.log(`   File: ${hit.item.path.split('/').pop()}`);
      console.log();
    }

    console.log();
  }

  // Now check if dream memories even exist in the index
  console.log('=== Checking for dream memories in index ===\n');

  const allHits = await queryIndex('dream nightmare surreal', { topK: 50 });
  let dreamMemoriesFound = 0;

  for (const hit of allHits) {
    try {
      const content = readFileSync(hit.item.path, 'utf-8');
      const data = JSON.parse(content);
      if (data.tags && data.tags.includes('dream')) {
        dreamMemoriesFound++;
        if (dreamMemoriesFound <= 3) {
          console.log(`Dream memory ${dreamMemoriesFound}:`);
          console.log(`  Score: ${hit.score.toFixed(4)}`);
          console.log(`  Tags: ${data.tags.join(', ')}`);
          console.log(`  Content: ${data.content?.substring(0, 150)}...`);
          console.log();
        }
      }
    } catch {}
  }

  console.log(`\nTotal dream memories in index: ${dreamMemoriesFound}\n`);

  if (dreamMemoriesFound === 0) {
    console.log('❌ NO DREAM MEMORIES FOUND IN INDEX');
    console.log('Possible causes:');
    console.log('1. Dream memories exist but aren\'t indexed yet');
    console.log('2. Dream memories don\'t exist in memory/reflections/');
    console.log('3. Index needs to be rebuilt\n');
    console.log('Action: Check memory/reflections/ for files with "dream" tag');
  } else {
    console.log(`✅ Found ${dreamMemoriesFound} dream memories in index`);
    console.log('\nPossible issue with retrieval:');
    console.log('- filterReflections setting may be filtering out dreams');
    console.log('- Check context-builder.ts line 270-280 for filtering logic');
  }
}

testDreamSearch();

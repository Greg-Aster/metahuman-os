#!/usr/bin/env node
/**
 * Check raw semantic search results to see where dreams rank
 */

import { queryIndex } from './packages/core/src/vector-index.ts';
import { readFileSync } from 'fs';

const query = "Can you tell me about your dreams last night?";

console.log('=== Raw Semantic Search Results ===\n');
console.log(`Query: "${query}"\n`);

const hits = await queryIndex(query, { topK: 20 });

console.log(`Total hits: ${hits.length}\n`);

let dreamCount = 0;
let dreamRank = -1;

for (let i = 0; i < Math.min(20, hits.length); i++) {
  const hit = hits[i];

  try {
    const raw = readFileSync(hit.item.path, 'utf-8');
    const data = JSON.parse(raw);
    const type = data.type || 'unknown';
    const isDream = type === 'dream';

    if (isDream) {
      dreamCount++;
      if (dreamRank === -1) dreamRank = i + 1;
    }

    console.log(`${i+1}. Score: ${hit.score.toFixed(4)} | Type: ${type} ${isDream ? '🌙' : ''}`);
    console.log(`   ${hit.item.text.substring(0, 80)}...`);
  } catch (err) {
    console.log(`${i+1}. Score: ${hit.score.toFixed(4)} | [Error reading file]`);
  }
}

console.log(`\nSummary:`);
console.log(`- Dreams found in top 20: ${dreamCount}`);
console.log(`- First dream rank: ${dreamRank > 0 ? `#${dreamRank}` : 'Not found'}`);
console.log(`- Problem: Chat conversations have higher similarity than dream content!`);
console.log(`- Solution: Need to boost dreams BEFORE filtering by maxMemories`);

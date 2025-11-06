#!/usr/bin/env node
import { queryIndex } from './packages/core/src/vector-index.ts';
import { readFileSync } from 'fs';

const query = 'Can you tell me about what you dreamed about last night?';
console.log('Query:', query);
console.log('Threshold: 0.62');
console.log('');

const hits = await queryIndex(query, { topK: 10 });
console.log(`Total hits: ${hits.length}\n`);

let dreamCount = 0;
let dreamsBelowThreshold = 0;

// Check each hit
for (let i = 0; i < hits.length; i++) {
  const hit = hits[i];
  const raw = readFileSync(hit.item.path, 'utf-8');
  const data = JSON.parse(raw);

  const isDream = data.type === 'dream';
  if (isDream) {
    dreamCount++;
    if (hit.score < 0.62) {
      dreamsBelowThreshold++;
    }
  }

  console.log(`${i+1}. Score: ${hit.score.toFixed(4)} | Type: ${data.type || 'none'} ${isDream ? '🌙' : ''}`);
  console.log(`   Content: ${hit.item.text.substring(0, 80)}...`);
  console.log(`   Pass threshold? ${hit.score >= 0.62 ? '✅' : '❌'}`);
  console.log('');
}

console.log(`\nSummary:`);
console.log(`- Total dreams found: ${dreamCount}`);
console.log(`- Dreams below threshold (0.62): ${dreamsBelowThreshold}`);
console.log(`- Dreams above threshold: ${dreamCount - dreamsBelowThreshold}`);

if (dreamsBelowThreshold === dreamCount && dreamCount > 0) {
  console.log(`\n❌ PROBLEM: All dreams are below similarity threshold!`);
  console.log(`Possible solutions:`);
  console.log(`1. Lower threshold to 0.55 for dream queries`);
  console.log(`2. Improve query phrasing detection`);
  console.log(`3. Index needs better embeddings for dreams`);
}

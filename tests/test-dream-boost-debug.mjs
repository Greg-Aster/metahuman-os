#!/usr/bin/env node
/**
 * Debug dream boosting to see exactly what's happening
 */

import { queryIndex } from './packages/core/src/vector-index.ts';
import { readFileSync } from 'fs';

const query = "Can you tell me about your dreams last night?";

console.log('=== Dream Boosting Debug ===\n');
console.log(`Query: "${query}"\n`);

// Get raw hits
let hits = await queryIndex(query, { topK: 20 });

console.log('BEFORE BOOSTING:');
console.log(`Dream at #16 with score ${hits[15].score.toFixed(4)}`);
console.log();

// Apply boosting (mimicking what context-builder.ts should do)
hits = hits.map((hit) => {
  try {
    const raw = readFileSync(hit.item.path, 'utf-8');
    const obj = JSON.parse(raw);
    const type = obj?.type ? String(obj.type) : '';
    const tags = Array.isArray(obj?.tags) ? obj.tags.map((x) => String(x)) : [];

    hit._metadata = { type, tags };

    if (type === 'dream' || tags.includes('dream') || tags.includes('reflection')) {
      console.log(`🌙 Boosting ${type} memory from ${hit.score.toFixed(4)} to ${Math.min(1.0, hit.score + 0.4).toFixed(4)}`);
      return { ...hit, score: Math.min(1.0, hit.score + 0.4) };
    }
    return hit;
  } catch {
    return hit;
  }
});

// Re-sort
hits.sort((a, b) => b.score - a.score);

console.log();
console.log('AFTER BOOSTING:');
for (let i = 0; i < 5; i++) {
  const hit = hits[i];
  const type = hit._metadata?.type || 'unknown';
  console.log(`${i+1}. Score: ${hit.score.toFixed(4)} | Type: ${type} ${type === 'dream' ? '🌙' : ''}`);
}

console.log();
const dreamInTop2 = hits.slice(0, 2).some(h => h._metadata?.type === 'dream');
console.log(dreamInTop2 ? '✅ Dream now in top 2!' : '❌ Dream still not in top 2');

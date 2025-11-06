#!/usr/bin/env node
/**
 * Debug why context builder returns 0 memories
 */

import { queryIndex } from './packages/core/dist/vector-index.js';
import { readFileSync } from 'fs';

async function debugMemoryRetrieval() {
  console.log('=== Debug Memory Retrieval ===\n');

  const query = "What are my fears about creativity?";
  const topK = 8;
  const similarityThreshold = 0.62;
  const filterInnerDialogue = true;
  const filterReflections = true;

  console.log('Query:', query);
  console.log('TopK:', topK);
  console.log('Similarity Threshold:', similarityThreshold);
  console.log('Filter Inner Dialogue:', filterInnerDialogue);
  console.log('Filter Reflections:', filterReflections);
  console.log();

  // Step 1: Query index
  const hits = await queryIndex(query, { topK });
  console.log(`Step 1: Query returned ${hits.length} hits\n`);

  // Step 2: Filter by threshold
  let filtered = hits.filter(hit => hit.score >= similarityThreshold);
  console.log(`Step 2: After threshold filter: ${filtered.length} hits\n`);

  // Step 3: Apply content filters
  const beforeFilterCount = filtered.length;
  filtered = filtered.filter((hit) => {
    try {
      const raw = readFileSync(hit.item.path, 'utf-8');
      const obj = JSON.parse(raw);
      const type = obj?.type ? String(obj.type) : '';
      const tags = Array.isArray(obj?.tags) ? obj.tags.map((x) => String(x)) : [];

      console.log(`  File: ${hit.item.path.split('/').pop()}`);
      console.log(`    Type: ${type || 'none'}`);
      console.log(`    Tags: ${tags.join(', ') || 'none'}`);

      // Check filters
      if (filterInnerDialogue && type === 'inner_dialogue') {
        console.log(`    ❌ FILTERED: inner_dialogue`);
        return false;
      }

      if (filterReflections && (tags.includes('reflection') || tags.includes('dream'))) {
        console.log(`    ❌ FILTERED: reflection/dream tag`);
        return false;
      }

      console.log(`    ✅ KEPT`);
      return true;
    } catch (err) {
      console.log(`    ⚠️  Error reading file: ${err.message}`);
      return true;
    }
  });

  console.log(`\nStep 3: After content filters: ${filtered.length} hits (removed ${beforeFilterCount - filtered.length})\n`);

  if (filtered.length > 0) {
    console.log('✅ Memories should be retrieved!');
    filtered.forEach((hit, idx) => {
      console.log(`\n${idx + 1}. Score: ${hit.score.toFixed(4)}`);
      console.log(`   Content: ${hit.item.text?.substring(0, 100)}...`);
    });
  } else {
    console.log('❌ All memories were filtered out!');
  }
}

debugMemoryRetrieval();

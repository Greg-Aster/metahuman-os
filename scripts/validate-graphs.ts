#!/usr/bin/env tsx
/**
 * Validate all cognitive graphs
 *
 * This script validates all .json files in etc/cognitive-graphs/
 * to ensure they conform to the schema and have valid cognitiveMode values.
 *
 * Run: pnpm tsx scripts/validate-graphs.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { validateSvelteFlowGraph, type SvelteFlowGraph } from '../packages/core/src/cognitive-graph-schema.js';

const GRAPHS_DIR = 'etc/cognitive-graphs';
const VALID_MODES = ['dual', 'agent', 'emulation'];

console.log('🔍 Validating cognitive graphs...\n');

let totalGraphs = 0;
let validGraphs = 0;
let errors: Array<{ file: string; errors: string[] }> = [];

// Get all .json files (excluding backups directory)
const files = readdirSync(GRAPHS_DIR, { withFileTypes: true })
  .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'))
  .map(dirent => dirent.name);

for (const file of files) {
  totalGraphs++;
  const filePath = join(GRAPHS_DIR, file);
  console.log(`Validating: ${file}`);

  try {
    const content = readFileSync(filePath, 'utf-8');
    const graph = JSON.parse(content);

    // Run schema validation
    validateSvelteFlowGraph(graph);

    // Additional checks
    if (graph.cognitiveMode && !VALID_MODES.includes(graph.cognitiveMode)) {
      throw new Error(`Invalid cognitiveMode: "${graph.cognitiveMode}". Must be one of: ${VALID_MODES.join(', ')}, or omit the field for cross-mode graphs.`);
    }

    console.log(`  ✅ Valid (cognitiveMode: ${graph.cognitiveMode || 'not specified'})\n`);
    validGraphs++;
  } catch (error: any) {
    console.log(`  ❌ Invalid\n`);
    if (error.errors) {
      // GraphValidationError
      errors.push({ file, errors: error.errors });
    } else {
      errors.push({ file, errors: [error.message || String(error)] });
    }
  }
}

// Print summary
console.log('\n' + '='.repeat(60));
console.log('VALIDATION SUMMARY');
console.log('='.repeat(60));
console.log(`Total graphs: ${totalGraphs}`);
console.log(`Valid: ${validGraphs}`);
console.log(`Invalid: ${errors.length}`);

if (errors.length > 0) {
  console.log('\n' + '='.repeat(60));
  console.log('ERRORS');
  console.log('='.repeat(60));
  for (const { file, errors: fileErrors } of errors) {
    console.log(`\n${file}:`);
    for (const error of fileErrors) {
      console.log(`  - ${error}`);
    }
  }
  process.exit(1);
}

console.log('\n✅ All graphs are valid!');
process.exit(0);

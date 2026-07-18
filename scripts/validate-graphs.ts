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
import { join } from 'node:path';
import { validateSvelteFlowGraph, type SvelteFlowGraph } from '../packages/core/src/cognitive-graph-schema.js';
import { getNode } from '../packages/core/src/nodes/index.js';

const GRAPHS_DIR = 'etc/cognitive-graphs';
const VALID_MODES = ['dual', 'agent', 'emulation', 'environment'];

console.log('🔍 Validating cognitive graphs...\n');

let totalGraphs = 0;
let validGraphs = 0;
let errors: Array<{ file: string; errors: string[] }> = [];

function validateRegisteredNodeContracts(graph: SvelteFlowGraph): void {
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));

  for (const node of graph.nodes) {
    const definition = getNode(node.data.nodeType);
    if (!definition) {
      throw new Error(`Node ${node.id} uses unregistered type "${node.data.nodeType}"`);
    }

    const declaredProperties = definition.propertySchemas || {};
    for (const property of Object.keys(node.data.properties || {})) {
      if (!(property in declaredProperties)) {
        throw new Error(`Node ${node.id} (${definition.id}) persists undeclared property "${property}"`);
      }
    }
  }

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      throw new Error(`Edge ${edge.id} references a missing node`);
    }

    const sourceDefinition = getNode(source.data.nodeType)!;
    const targetDefinition = getNode(target.data.nodeType)!;
    if (!sourceDefinition.outputs.some(output => output.name === edge.sourceHandle)) {
      throw new Error(`Edge ${edge.id} uses undeclared output ${sourceDefinition.id}.${edge.sourceHandle}`);
    }
    if (!targetDefinition.inputs.some(input => input.name === edge.targetHandle)) {
      throw new Error(`Edge ${edge.id} uses undeclared input ${targetDefinition.id}.${edge.targetHandle}`);
    }
  }
}

function validateDualArtifacts(graph: SvelteFlowGraph): void {
  const artifactPaths = [
    join('apps', 'site', 'public', 'cognitive-graphs', 'dual-mode.json'),
    join('apps', 'react-native', 'nodejs-assets', 'nodejs-project', 'etc', 'cognitive-graphs', 'dual-mode.json'),
  ];
  const canonical = JSON.stringify(graph);

  for (const artifactPath of artifactPaths) {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    if (JSON.stringify(artifact) !== canonical) {
      throw new Error(`${artifactPath} has drifted from etc/cognitive-graphs/dual-mode.json; run pnpm sync:graph-artifacts dual-mode`);
    }
  }
}

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

    // Maintained conversational graphs use strict runtime wiring: every handle
    // and persisted property must match a registered node contract.
    if (file === 'dual-mode.json' || file === 'environment-mode.json') {
      validateRegisteredNodeContracts(graph);
    }

    if (file === 'dual-mode.json') {
      validateDualArtifacts(graph);
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

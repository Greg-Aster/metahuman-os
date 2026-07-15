import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../packages/core/src/path-builder.js';
import { eventBus } from '../packages/core/src/infrastructure/event-bus/client.js';
import { getAllNodes, getAllSchemas, getNodeSchema } from '../packages/core/src/nodes/index.js';
import { materializeNodeProperties } from '../packages/core/src/nodes/types.js';

const graphsDir = path.join(ROOT, 'etc', 'cognitive-graphs');

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function listGraphFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'backups') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listGraphFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function validateRegistry(): void {
  const nodes = getAllNodes();
  const seen = new Set<string>();

  for (const node of nodes) {
    assert(!seen.has(node.id), `Duplicate node id: ${node.id}`);
    seen.add(node.id);

    const materialized = materializeNodeProperties(node);
    for (const [key, schema] of Object.entries(node.propertySchemas || {})) {
      if ('default' in schema) {
        assert(key in materialized, `Missing materialized default ${node.id}.${key}`);
      }
    }
  }

  const schemas = getAllSchemas();
  assert(schemas.length === nodes.length, `Expected one schema per node (${nodes.length}), got ${schemas.length}`);
  assert(getNodeSchema('cot_stripper')?.id === 'thinking_stripper', 'cot_stripper alias did not resolve to thinking_stripper');
}

async function validateGraphs(): Promise<void> {
  const files = await listGraphFiles(graphsDir);
  const strictGraphs = process.argv.includes('--strict-graphs');
  const issues: string[] = [];

  for (const file of files) {
    const graph = JSON.parse(await fs.readFile(file, 'utf8'));
    if (graph.format !== 'svelte-flow') continue;

    for (const node of graph.nodes || []) {
      const data = node.data || {};
      if ('schema' in data) issues.push(`${path.relative(ROOT, file)} node ${node.id} persists editor-only schema data`);
      if ('executionState' in data) issues.push(`${path.relative(ROOT, file)} node ${node.id} persists executionState`);
      if ('executionOutput' in data) issues.push(`${path.relative(ROOT, file)} node ${node.id} persists executionOutput`);
      assert(typeof data.nodeType === 'string', `${path.relative(ROOT, file)} node ${node.id} missing data.nodeType`);
      assert(typeof data.properties === 'object' && data.properties !== null, `${path.relative(ROOT, file)} node ${node.id} missing data.properties`);
    }
  }

  if (issues.length > 0) {
    if (strictGraphs) {
      throw new Error(`Graph persistence issues:\n${issues.join('\n')}`);
    }
    console.warn(`Graph persistence migration debt: ${issues.length} editor-only fields remain in existing graph JSON. Re-run with --strict-graphs after graph migration.`);
  }
}

async function main(): Promise<void> {
  validateRegistry();
  await validateGraphs();
  console.log('Node defaults validation passed');
}

main()
  .then(() => {
    eventBus.disconnect();
    process.exit(0);
  })
  .catch((error) => {
    eventBus.disconnect();
    console.error(error);
    process.exit(1);
  });

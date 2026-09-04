import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../packages/core/src/path-builder.js';
import { eventBus } from '../packages/core/src/infrastructure/event-bus/client.js';
import { getAllNodes, getAllSchemas, getNodeSchema } from '../packages/core/src/nodes/index.js';
import {
  materializeNodeProperties,
  validatePropertyValue,
} from '../packages/core/src/nodes/types.js';

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
  const aliases = new Set<string>();
  const documentationIssues: string[] = [];

  for (const node of nodes) {
    assert(!seen.has(node.id), `Duplicate node id: ${node.id}`);
    seen.add(node.id);
    assert(Boolean(node.name.trim()), `Node ${node.id} has no display name`);
    assert(Boolean(node.description.trim()), `Node ${node.id} has no purpose description`);
    assert(node.execution.requiredInputs.every(input => node.inputs.some(slot => slot.name === input)), `Node ${node.id} declares an unknown required input`);

    const inputNames = new Set<string>();
    for (const input of node.inputs) {
      assert(!inputNames.has(input.name), `Node ${node.id} has duplicate input ${input.name}`);
      inputNames.add(input.name);
      if (!input.description?.trim()) documentationIssues.push(`${node.id}.${input.name} input`);
    }
    const outputNames = new Set<string>();
    for (const output of node.outputs) {
      assert(!outputNames.has(output.name), `Node ${node.id} has duplicate output ${output.name}`);
      outputNames.add(output.name);
      if (!output.description?.trim()) documentationIssues.push(`${node.id}.${output.name} output`);
      if (output.enabledBy) {
        assert(Boolean(node.propertySchemas?.[output.enabledBy.property]), `Node ${node.id}.${output.name} references unknown enablement property ${output.enabledBy.property}`);
      }
    }

    for (const alias of node.aliases || []) {
      assert(!seen.has(alias) && !aliases.has(alias), `Duplicate node alias: ${alias}`);
      aliases.add(alias);
    }
    if (node.version !== undefined) assert(Boolean(node.version.trim()), `Node ${node.id} has an empty schema version`);
    if (node.tags !== undefined) assert(node.tags.every(tag => Boolean(tag.trim())), `Node ${node.id} has an empty search tag`);

    const materialized = materializeNodeProperties(node);
    for (const [key, schema] of Object.entries(node.propertySchemas || {})) {
      assert(Boolean(schema.label?.trim()), `Missing property label ${node.id}.${key}`);
      if (schema.min !== undefined && schema.max !== undefined) {
        assert(schema.min <= schema.max, `Invalid numeric range ${node.id}.${key}`);
      }
      if (schema.validation?.minLength !== undefined && schema.validation?.maxLength !== undefined) {
        assert(schema.validation.minLength <= schema.validation.maxLength, `Invalid text length range ${node.id}.${key}`);
      }
      if (schema.validation?.pattern) {
        try {
          new RegExp(schema.validation.pattern);
        } catch {
          throw new Error(`Invalid validation pattern ${node.id}.${key}`);
        }
      }
      if ('default' in schema) {
        assert(key in materialized, `Missing materialized default ${node.id}.${key}`);
      }
      const propertyError = validatePropertyValue(materialized[key], schema);
      assert(!propertyError, `Invalid default ${node.id}.${key}: ${propertyError}`);
      if (!schema.description?.trim()) documentationIssues.push(`${node.id}.${key} setting`);
    }

    for (const statusField of node.presentation?.statusFields || []) {
      assert(node.outputs.some(output => output.name === statusField.output), `Node ${node.id} status field references unknown output ${statusField.output}`);
    }
  }

  const schemas = getAllSchemas();
  assert(schemas.length === nodes.length, `Expected one schema per node (${nodes.length}), got ${schemas.length}`);
  assert(getNodeSchema('cot_stripper')?.id === 'thinking_stripper', 'cot_stripper alias did not resolve to thinking_stripper');
  const strictDocs = process.argv.includes('--strict-docs');
  if (documentationIssues.length > 0) {
    if (strictDocs) throw new Error(`Node schema documentation gaps:\n${documentationIssues.join('\n')}`);
    console.warn(`Node schema documentation gaps: ${documentationIssues.length}. The editor reports these per graph; run with --strict-docs for the complete list.`);
  }
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

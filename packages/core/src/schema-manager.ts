/**
 * Schema Manager - Apply model-family-specific wrappers
 *
 * Wraps formatted training samples with model-specific tokens
 * (Qwen, LLaMA, Phi, GPT-J, etc.) without modifying content.
 *
 * CRITICAL: Only wraps content, never modifies it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './paths.js';

export interface ModelSchema {
  family: string;
  description: string;
  user_prefix: string;
  user_suffix: string;
  assistant_prefix: string;
  assistant_suffix: string;
  separator: string;
  eos_token: string;
  notes?: string;
}

export interface FormattedSample {
  mode: 'dual' | 'emulation' | 'agent';
  input: string;
  output: string;
  metadata: {
    original_id: string;
    source_type: string;
    [key: string]: any;
  };
}

export interface SchemaAppliedSample {
  mode: 'dual' | 'emulation' | 'agent';
  input: string; // Wrapped input
  output: string; // Wrapped output
  raw_input: string; // Original unwrapped input
  raw_output: string; // Original unwrapped output
  schema_family: string;
  metadata: {
    original_id: string;
    source_type: string;
    [key: string]: any;
  };
}

/**
 * Detect model family from base model string
 */
export function detectModelFamily(baseModel: string): string {
  const lower = baseModel.toLowerCase();

  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('llama')) return 'llama';
  if (lower.includes('phi')) return 'phi';
  if (lower.includes('gpt-j') || lower.includes('gptj')) return 'gptj';

  return 'qwen'; // Default fallback
}

/**
 * Load schema file for a model family
 */
export function loadSchema(family: string): ModelSchema {
  const schemaPath = path.join(systemPaths.etc, 'schemas', `${family}.json`);

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found for family: ${family} (${schemaPath})`);
  }

  try {
    const content = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(content) as ModelSchema;

    // Validate required fields
    if (!schema.family || !schema.user_prefix || !schema.assistant_prefix) {
      throw new Error(`Invalid schema file: ${schemaPath} (missing required fields)`);
    }

    return schema;
  } catch (error) {
    throw new Error(`Failed to load schema ${family}: ${(error as Error).message}`);
  }
}

/**
 * Apply schema to a single formatted sample
 *
 * CRITICAL: Only wraps content, never modifies it
 */
export function applySchema(
  sample: FormattedSample,
  schema: ModelSchema
): SchemaAppliedSample {
  // Wrap input with user tokens
  const wrappedInput = `${schema.user_prefix}${sample.input}${schema.user_suffix}`;

  // Wrap output with assistant tokens
  const wrappedOutput = `${schema.assistant_prefix}${sample.output}${schema.assistant_suffix}`;

  return {
    mode: sample.mode,
    input: wrappedInput,
    output: wrappedOutput,
    raw_input: sample.input,
    raw_output: sample.output,
    schema_family: schema.family,
    metadata: sample.metadata,
  };
}

/**
 * Apply schema to all samples in a batch
 */
export function applySchemaBatch(
  samples: FormattedSample[],
  baseModel: string
): SchemaAppliedSample[] {
  const family = detectModelFamily(baseModel);
  const schema = loadSchema(family);

  console.log(`[schema-manager] Applying ${family} schema to ${samples.length} samples`);
  console.log(`[schema-manager] User wrapper: "${schema.user_prefix}...${schema.user_suffix}"`);
  console.log(`[schema-manager] Assistant wrapper: "${schema.assistant_prefix}...${schema.assistant_suffix}"`);

  return samples.map(sample => applySchema(sample, schema));
}

/**
 * List all available schema families
 */
export function listAvailableSchemas(): string[] {
  const schemasDir = path.join(systemPaths.etc, 'schemas');

  if (!fs.existsSync(schemasDir)) {
    return [];
  }

  return fs
    .readdirSync(schemasDir)
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace('.json', ''));
}

/**
 * Validate schema file structure
 */
export function validateSchema(schema: ModelSchema): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!schema.family) errors.push('Missing required field: family');
  if (!schema.description) errors.push('Missing required field: description');
  if (schema.user_prefix === undefined) errors.push('Missing required field: user_prefix');
  if (schema.user_suffix === undefined) errors.push('Missing required field: user_suffix');
  if (schema.assistant_prefix === undefined) errors.push('Missing required field: assistant_prefix');
  if (schema.assistant_suffix === undefined) errors.push('Missing required field: assistant_suffix');
  if (!schema.separator && schema.separator !== '') errors.push('Missing required field: separator');
  if (!schema.eos_token) errors.push('Missing required field: eos_token');

  return {
    valid: errors.length === 0,
    errors,
  };
}

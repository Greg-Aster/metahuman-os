/**
 * Dreamer Memory Curator Node
 * Curates a bounded, weighted sample through the canonical episodic reader.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { scanEpisodicMemoryRecords } from '../../memory.js';

interface Memory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

const MIN_SAMPLE_SIZE = 3;
const DEFAULT_SAMPLE_SIZE = 15;
const MAX_SAMPLE_SIZE = 100;
const DEFAULT_DECAY_DAYS = 227;
const MAX_DECAY_DAYS = 36_500;
const DEFAULT_MAX_CANDIDATE_FILES = 2_000;
const MAX_CANDIDATE_FILES = 10_000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_MEMORY_CHARS = 4_000;
const MAX_MEMORY_CHARS = 100_000;

export function isGeneratedInnerMemory(type: string | undefined): boolean {
  return type === 'dream'
    || type === 'daydream'
    || type === 'reflection'
    || type === 'inner_dialogue';
}

function integerProperty(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || (resolved as number) < minimum || (resolved as number) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return resolved as number;
}

function numberProperty(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return resolved;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Dream memory curation cancelled', 'AbortError');
}

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const username = typeof context.username === 'string' && context.username.trim()
    ? context.username.trim()
    : typeof context.userId === 'string'
      ? context.userId.trim()
      : '';
  if (!username) throw new Error('Dreamer memory curator requires an authenticated username');

  const sampleSize = integerProperty(
    properties?.sampleSize,
    DEFAULT_SAMPLE_SIZE,
    'Dreamer memory curator sampleSize',
    MIN_SAMPLE_SIZE,
    MAX_SAMPLE_SIZE,
  );
  const decayDays = numberProperty(
    properties?.decayDays,
    DEFAULT_DECAY_DAYS,
    'Dreamer memory curator decayDays',
    1,
    MAX_DECAY_DAYS,
  );
  const maxCandidateFiles = integerProperty(
    properties?.maxCandidateFiles,
    DEFAULT_MAX_CANDIDATE_FILES,
    'Dreamer memory curator maxCandidateFiles',
    sampleSize,
    MAX_CANDIDATE_FILES,
  );
  const maxFileSizeBytes = integerProperty(
    properties?.maxFileSizeBytes,
    DEFAULT_MAX_FILE_SIZE_BYTES,
    'Dreamer memory curator maxFileSizeBytes',
    1,
    MAX_FILE_SIZE_BYTES,
  );
  const maxMemoryChars = integerProperty(
    properties?.maxMemoryChars,
    DEFAULT_MAX_MEMORY_CHARS,
    'Dreamer memory curator maxMemoryChars',
    1,
    MAX_MEMORY_CHARS,
  );
  const signal = context.signal ?? context.abortSignal;
  const now = new Date();
  const memories: Array<Memory & { weight: number; age: number }> = [];
  const failures: Array<{ relativePath: string; error: string }> = [];
  let filesConsidered = 0;
  let excludedCount = 0;
  let truncatedMemoryCount = 0;

  audit({
    level: 'info',
    category: 'action',
    event: 'dream_curation_started',
    details: { sampleSize, decayDays, maxCandidateFiles, username },
    actor: 'dreamer',
  });

  for (const outcome of scanEpisodicMemoryRecords(username, {
    maxFiles: maxCandidateFiles,
    maxFileSizeBytes,
    newestFirst: true,
  })) {
    throwIfAborted(signal);
    filesConsidered += 1;
    if (outcome.status === 'failed') {
      failures.push({ relativePath: outcome.relativePath, error: outcome.error });
      continue;
    }

    const event = outcome.record.event;
    const content = event.content.trim();
    const type = event.type || (typeof event.metadata?.type === 'string' ? event.metadata.type : undefined);
    if (!content || isGeneratedInnerMemory(type)) {
      excludedCount += 1;
      continue;
    }

    const memoryDate = new Date(event.timestamp);
    const ageInMs = now.getTime() - memoryDate.getTime();
    const ageInDays = Math.max(0, Math.floor(ageInMs / (1000 * 60 * 60 * 24)));
    const boundedContent = content.slice(0, maxMemoryChars);
    if (boundedContent.length < content.length) truncatedMemoryCount += 1;
    memories.push({
      ...event,
      content: boundedContent,
      weight: Math.exp(-ageInDays / decayDays),
      age: ageInDays,
    });
  }

  if (failures.length > 0) {
    audit({
      level: 'warn',
      category: 'data',
      event: 'dream_curation_memory_scan_partial',
      details: { failedCount: failures.length, filesConsidered, username },
      actor: 'dreamer',
    });
  }

  const diagnostics = {
    candidateCount: memories.length,
    filesConsidered,
    failedCount: failures.length,
    failures,
    excludedCount,
    truncatedMemoryCount,
  };
  if (memories.length < MIN_SAMPLE_SIZE) {
    return {
      memories: [],
      count: 0,
      avgAgeDays: 0,
      oldestAgeDays: 0,
      invalidMemoryCount: failures.length,
      ...diagnostics,
      ...(failures.length > 0
        ? { error: `Only ${memories.length} usable memories remained after ${failures.length} episodic read failure(s)` }
        : {}),
    };
  }

  const curated: Memory[] = [];
  const tempMemories = [...memories];
  while (curated.length < sampleSize && tempMemories.length > 0) {
    throwIfAborted(signal);
    const totalWeight = tempMemories.reduce((sum, memory) => sum + memory.weight, 0);
    let random = Math.random() * totalWeight;
    let selectedIndex = tempMemories.length - 1;
    for (let index = 0; index < tempMemories.length; index += 1) {
      random -= tempMemories[index].weight;
      if (random <= 0) {
        selectedIndex = index;
        break;
      }
    }
    const [{ weight: _weight, age: _age, ...memory }] = tempMemories.splice(selectedIndex, 1);
    curated.push(memory);
  }

  const ages = curated.map(memory => Math.max(
    0,
    Math.floor((now.getTime() - new Date(memory.timestamp).getTime()) / (1000 * 60 * 60 * 24)),
  ));
  const avgAgeDays = Math.floor(ages.reduce((sum, age) => sum + age, 0) / ages.length);

  return {
    memories: curated,
    count: curated.length,
    avgAgeDays,
    oldestAgeDays: Math.max(...ages),
    invalidMemoryCount: failures.length,
    ...diagnostics,
  };
};

export const DreamerMemoryCuratorNode: NodeDefinition = defineNode({
  id: 'dreamer_memory_curator',
  name: 'Dreamer Memory Curator',
  category: 'dreamer',
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Curated memories' },
    { name: 'count', type: 'number' },
    { name: 'avgAgeDays', type: 'number' },
    { name: 'oldestAgeDays', type: 'number' },
    { name: 'invalidMemoryCount', type: 'number' },
    { name: 'candidateCount', type: 'number' },
    { name: 'filesConsidered', type: 'number' },
    { name: 'failedCount', type: 'number' },
    { name: 'failures', type: 'array' },
    { name: 'excludedCount', type: 'number' },
    { name: 'truncatedMemoryCount', type: 'number' },
    { name: 'error', type: 'string', optional: true },
  ],
  properties: {
    sampleSize: DEFAULT_SAMPLE_SIZE,
    decayDays: DEFAULT_DECAY_DAYS,
    maxCandidateFiles: DEFAULT_MAX_CANDIDATE_FILES,
    maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
    maxMemoryChars: DEFAULT_MAX_MEMORY_CHARS,
  },
  propertySchemas: {
    sampleSize: {
      type: 'number',
      default: DEFAULT_SAMPLE_SIZE,
      label: 'Sample Size',
      min: MIN_SAMPLE_SIZE,
      max: MAX_SAMPLE_SIZE,
      step: 1,
    },
    decayDays: {
      type: 'number',
      default: DEFAULT_DECAY_DAYS,
      label: 'Decay Days',
      description: 'Days for exponential decay weighting',
      min: 1,
      max: MAX_DECAY_DAYS,
    },
    maxCandidateFiles: {
      type: 'number',
      default: DEFAULT_MAX_CANDIDATE_FILES,
      label: 'Maximum Candidate Files',
      description: 'Maximum episodic records read during one finite execution',
      min: MIN_SAMPLE_SIZE,
      max: MAX_CANDIDATE_FILES,
      step: 1,
      advanced: true,
    },
    maxFileSizeBytes: {
      type: 'number',
      default: DEFAULT_MAX_FILE_SIZE_BYTES,
      label: 'Maximum File Bytes',
      min: 1,
      max: MAX_FILE_SIZE_BYTES,
      step: 1,
      advanced: true,
    },
    maxMemoryChars: {
      type: 'number',
      default: DEFAULT_MAX_MEMORY_CHARS,
      label: 'Maximum Memory Characters',
      min: 1,
      max: MAX_MEMORY_CHARS,
      step: 1,
      advanced: true,
    },
  },
  description: 'Curates a bounded, encryption-aware weighted sample of episodic memories',
  execute,
});

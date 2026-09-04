/**
 * Dreamer Continuation Generator Node
 * Generates continuation dreams that build on previous dream narrative
 */

import { createHash } from 'node:crypto';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { audit } from '../../audit.js';
import { recordSystemActivity } from '../../system-activity.js';
import { parseThinkingBlocks } from '../output/thinking-stripper.node.js';
import { renderPromptTemplate } from '../prompt-template.js';

function markBackgroundActivity() {
  try {
    recordSystemActivity();
  } catch (error) {
    console.warn('[DreamerContinuation] Could not record background activity:', (error as Error).message);
  }
}

export interface DreamContinuation {
  dream: string;
  thinking?: string;
  index: number;
}

const MAX_CONTINUATIONS = 20;
const MAX_DELAY_SECONDS = 3_600;
const MAX_TOKENS = 32_768;

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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Dream continuation cancelled', 'AbortError');
}

export function resolveContinuationLimit(
  configuredMax: unknown,
  runDreamLimit: unknown,
): number {
  const propertyLimit = integerProperty(
    configuredMax,
    4,
    'Dreamer maxContinuations',
    0,
    MAX_CONTINUATIONS,
  );
  const totalLimit = integerProperty(
    runDreamLimit,
    propertyLimit + 1,
    'Dreamer maxDreams',
    1,
    Number.MAX_SAFE_INTEGER,
  );
  return Math.min(propertyLimit, totalLimit - 1);
}

export function resolveContinuationRoll(
  executionKey: unknown,
  continuationIndex: number,
  fallback: () => number = Math.random,
): number {
  const key = typeof executionKey === 'string' ? executionKey.trim() : '';
  if (!key) return fallback();
  const digest = createHash('sha256')
    .update(`${key}:dream-continuation:${continuationIndex}`)
    .digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

async function waitForDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return;
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Dream continuation cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

const DEFAULT_SYSTEM_PROMPT = `You are continuing a surreal dream sequence. You only see the previous dream fragment - use it as inspiration,
but feel free to drift, fracture, merge, or completely transform. No coherence required.
Let the symbols mutate, emotions shift unexpectedly, logic dissolve. Dreams don't follow rules.
Do not summarize; let one dream bleed into another. No length limits.`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Previous Dream Fragment:
{{lastDream}}

Let the dream continue, building on this fragment alone.`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  // inputs is an object keyed by handle name, not an array
  const previousDreamInput = inputs.previousDream;
  let lastDream = previousDreamInput?.dream || previousDreamInput;
  const username = context.userId || context.username;
  const temperature = numberProperty(properties?.temperature, 1.0, 'Dreamer temperature', 0, 2);
  const continuationChance = numberProperty(
    properties?.continuationChance,
    0.75,
    'Dreamer continuationChance',
    0,
    1,
  );
  const maxContinuations = resolveContinuationLimit(properties?.maxContinuations, context.maxDreams);
  const delaySeconds = numberProperty(
    properties?.delaySeconds,
    60,
    'Dreamer delaySeconds',
    0,
    MAX_DELAY_SECONDS,
  );
  const maxTokens = integerProperty(
    properties?.maxTokens,
    800,
    'Dreamer maxTokens',
    1,
    MAX_TOKENS,
  );
  const role = properties?.role ?? 'persona';
  const systemPrompt = properties?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const userPromptTemplate = properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE;

  if (!lastDream || typeof lastDream !== 'string') {
    return {
      dreams: [],
      count: 0,
      error: 'No initial dream provided',
    };
  }

  const dreams: DreamContinuation[] = [];
  let continuationIndex = 0;

  while (continuationIndex < maxContinuations) {
    throwIfAborted(context.signal);
    const roll = resolveContinuationRoll(context.idempotencyKey, continuationIndex + 1);

    if (roll >= continuationChance) break;

    await waitForDelay(delaySeconds * 1000, context.signal);
    markBackgroundActivity();

    const userPrompt = renderPromptTemplate(userPromptTemplate, { lastDream });

    const messages: RouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await callLLM({
      role,
      messages,
      userId: username,
      options: { temperature, maxTokens },
    });

    throwIfAborted(context.signal);
    const rawContinuation = response.content.trim();
    if (!rawContinuation) throw new Error('LLM returned an empty dream continuation');

    const { stripped: continuation, thinking } = parseThinkingBlocks(rawContinuation);
    if (!continuation) throw new Error('Dream continuation contained reasoning but no dream content');

    lastDream = continuation;
    continuationIndex++;
    dreams.push({
      dream: continuation,
      ...(thinking ? { thinking } : {}),
      index: continuationIndex,
    });

    audit({
      level: 'info',
      category: 'decision',
      event: 'dream_continuation_generated',
      details: {
        continuationIndex,
        length: continuation.length,
        username,
      },
      actor: 'dreamer',
    });
  }

  return {
    dreams,
    count: dreams.length,
    username,
  };
};

export const DreamerContinuationGeneratorNode: NodeDefinition = defineNode({
  id: 'dreamer_continuation_generator',
  name: 'Dreamer Continuation Generator',
  category: 'dreamer',
  inputs: [
    { name: 'previousDream', type: 'object', description: 'Previous dream data' },
  ],
  outputs: [
    { name: 'dreams', type: 'array', description: 'Continuation dreams' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    temperature: 1.0,
    continuationChance: 0.75,
    maxContinuations: 4,
    delaySeconds: 60,
    maxTokens: 800,
    role: 'persona',
    timeout: 300000,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 1.0,
      label: 'Temperature',
      min: 0,
      max: 2,
      step: 0.1,
    },
    continuationChance: {
      type: 'number',
      default: 0.75,
      label: 'Continuation Chance',
      description: 'Probability to continue (0-1)',
      min: 0,
      max: 1,
      step: 0.05,
    },
    maxContinuations: {
      type: 'number',
      default: 4,
      label: 'Max Continuations',
      min: 0,
      max: MAX_CONTINUATIONS,
      step: 1,
    },
    delaySeconds: {
      type: 'number',
      default: 60,
      label: 'Delay (seconds)',
      min: 0,
      max: MAX_DELAY_SECONDS,
      step: 1,
    },
    maxTokens: {
      type: 'number',
      default: 800,
      label: 'Max Tokens',
      description: 'Maximum tokens for each continuation response',
      min: 1,
      max: MAX_TOKENS,
      step: 1,
    },
    role: {
      type: 'string',
      default: 'persona',
      label: 'LLM Role',
    },
    timeout: {
      type: 'number',
      default: 300000,
      label: 'Execution Timeout (ms)',
      description: 'Maximum time allowed for this model node.',
      min: 1000,
      max: 900000,
      step: 1000,
      advanced: true,
    },
    systemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT,
      label: 'System Prompt',
      description: 'Instructions for dream continuation.',
      rows: 8,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Template variables: {{lastDream}}.',
      rows: 6,
    },
  },
  description: 'Generates continuation dreams that build on previous narrative',
  execute,
});

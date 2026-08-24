import type { ProviderResponse } from './types.js';

type ProviderUsage = NonNullable<ProviderResponse['usage']>;

export interface ParsedRunPodOutput {
  content?: string;
  usage?: ProviderUsage;
}

const RUNPOD_JOB_STATUSES = new Set([
  'IN_QUEUE',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
] as const);

export type RunPodJobStatusValue =
  | 'IN_QUEUE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export interface RunPodJobStatus {
  id: string;
  status: RunPodJobStatusValue;
  output?: unknown;
  error?: string;
}

function parsedOutput(content?: string, usage?: ProviderUsage): ParsedRunPodOutput {
  return {
    ...(content ? { content } : {}),
    ...(usage ? { usage } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseRunPodJobStatus(value: unknown): RunPodJobStatus {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) {
    throw new TypeError('RunPod response is missing a job ID');
  }
  if (typeof record.status !== 'string' || !RUNPOD_JOB_STATUSES.has(record.status as RunPodJobStatusValue)) {
    throw new TypeError('RunPod response has an unsupported job status');
  }

  return {
    id: record.id,
    status: record.status as RunPodJobStatusValue,
    ...(record.output !== undefined ? { output: record.output } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}

function parseUsage(value: unknown): ProviderUsage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;

  const promptTokens = numberValue(usage.input) ?? numberValue(usage.prompt_tokens) ?? 0;
  const completionTokens = numberValue(usage.output) ?? numberValue(usage.completion_tokens) ?? 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens: numberValue(usage.total_tokens) ?? promptTokens + completionTokens,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function extractRunPodOutput(output: unknown): ParsedRunPodOutput {
  const envelope = asRecord(Array.isArray(output) ? output[0] : output);
  if (!envelope) return {};

  if (Array.isArray(output)) {
    const choices = Array.isArray(envelope.choices) ? envelope.choices : [];
    const choice = asRecord(choices[0]);
    const message = asRecord(choice?.message);
    const tokens = choice?.tokens;
    const tokenText = Array.isArray(tokens) && tokens.every(token => typeof token === 'string')
      ? tokens.join('')
      : stringValue(tokens);

    return parsedOutput(
      tokenText ?? stringValue(choice?.text) ?? stringValue(message?.content),
      parseUsage(envelope.usage),
    );
  }

  const message = asRecord(envelope.message);
  return parsedOutput(
    stringValue(envelope.response) ?? stringValue(envelope.content) ?? stringValue(message?.content),
    parseUsage(envelope.usage),
  );
}

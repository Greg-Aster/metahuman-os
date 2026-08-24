import assert from "node:assert/strict";
import test from 'node:test';
import { extractRunPodOutput, parseRunPodJobStatus } from './runpod-output.js';

test('validates RunPod job envelopes at the transport boundary', () => {
  assert.deepEqual(parseRunPodJobStatus({
    id: 'job-1',
    status: 'COMPLETED',
    output: { response: 'done' },
  }), {
    id: 'job-1',
    status: 'COMPLETED',
    output: { response: 'done' },
  });
  assert.throws(() => parseRunPodJobStatus({ status: 'COMPLETED' }), /job ID/);
  assert.throws(() => parseRunPodJobStatus({ id: 'job-1', status: 'UNKNOWN' }), /job status/);
});

test('extracts standard RunPod output and explicit token totals', () => {
  assert.deepEqual(extractRunPodOutput({
    response: 'standard response',
    usage: {
      prompt_tokens: 4,
      completion_tokens: 6,
      total_tokens: 10,
    },
  }), {
    content: 'standard response',
    usage: {
      promptTokens: 4,
      completionTokens: 6,
      totalTokens: 10,
    },
  });
});

test('extracts vLLM token arrays and derives missing totals', () => {
  assert.deepEqual(extractRunPodOutput([{
    choices: [{ tokens: ['array', ' response'] }],
    usage: { input: 3, output: 2 },
  }]), {
    content: 'array response',
    usage: {
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
    },
  });
});

test('rejects malformed output without coercing it', () => {
  assert.deepEqual(extractRunPodOutput({ content: 42 }), {});
  assert.deepEqual(extractRunPodOutput([{ choices: [{ tokens: ['valid', 42] }] }]), {});
});

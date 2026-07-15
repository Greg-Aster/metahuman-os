import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveVLLMTokenizerReference } from './vllm-tokenizer.js'

const stableReference = resolveVLLMTokenizerReference('Qwen/Qwen3-14B-AWQ')
assert.deepEqual(stableReference, {
  reference: 'Qwen/Qwen3-14B-AWQ',
  recoveredFromStaleCachePath: false,
})

const existingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-tokenizer-'))
try {
  assert.deepEqual(resolveVLLMTokenizerReference(existingDirectory), {
    reference: existingDirectory,
    recoveredFromStaleCachePath: false,
  })
} finally {
  fs.rmSync(existingDirectory, { recursive: true })
}

const staleSnapshot = path.join(
  os.homedir(),
  '.cache',
  'huggingface',
  'hub',
  'models--Qwen--Qwen3-14B-AWQ',
  'snapshots',
  'deleted-revision',
)
assert.deepEqual(resolveVLLMTokenizerReference(staleSnapshot), {
  reference: 'Qwen/Qwen3-14B-AWQ',
  recoveredFromStaleCachePath: true,
})

assert.throws(
  () => resolveVLLMTokenizerReference('/missing/custom-tokenizer'),
  /Use a stable Hugging Face model ID/,
)

console.log('vLLM tokenizer reference checks passed')

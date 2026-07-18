import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveVLLMTokenizerReference } from './vllm-tokenizer.js'

const stableReference = resolveVLLMTokenizerReference('sanskar003/Qwen3.5-9B-AWQ')
assert.deepEqual(stableReference, {
  reference: 'sanskar003/Qwen3.5-9B-AWQ',
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
  'models--sanskar003--Qwen3.5-9B-AWQ',
  'snapshots',
  'deleted-revision',
)
assert.deepEqual(resolveVLLMTokenizerReference(staleSnapshot), {
  reference: 'sanskar003/Qwen3.5-9B-AWQ',
  recoveredFromStaleCachePath: true,
})

assert.throws(
  () => resolveVLLMTokenizerReference('/missing/custom-tokenizer'),
  /Use a stable Hugging Face model ID/,
)

console.log('vLLM tokenizer reference checks passed')

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildOllamaLoraModelfile,
  buildOllamaLoraModelName,
  discoverOllamaLoraAdapters,
  isOllamaSafetensorsAdapterFamilySupported,
} from './ollama-lora.js'

assert.equal(isOllamaSafetensorsAdapterFamilySupported('meta-llama/Llama-3.1-8B'), true)
assert.equal(isOllamaSafetensorsAdapterFamilySupported('mistralai/Mistral-7B-v0.3'), true)
assert.equal(isOllamaSafetensorsAdapterFamilySupported('Qwen/Qwen3-14B'), false)
assert.equal(buildOllamaLoraModelName('llama3.1:8b', 'persona-2026-07-15'), 'llama3.1-persona-2026-07-15:latest')
assert.equal(buildOllamaLoraModelfile('llama3.1:8b', '/tmp/example adapter', {
  numCtx: 8192,
  numPredict: 2048,
  temperature: 0.7,
  seed: null,
}), 'FROM llama3.1:8b\nADAPTER "/tmp/example adapter"\nPARAMETER num_ctx 8192\nPARAMETER num_predict 2048\nPARAMETER temperature 0.7\n')

const profileOut = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-ollama-lora-spec-'))
try {
  const adapterDir = path.join(profileOut, 'adapters', '2026-07-15', 'run-1', 'adapter')
  fs.mkdirSync(adapterDir, { recursive: true })
  fs.writeFileSync(path.join(adapterDir, 'adapter_model.safetensors'), 'adapter')
  fs.writeFileSync(path.join(adapterDir, 'adapter_config.json'), JSON.stringify({
    base_model_name_or_path: 'Qwen/Qwen3-14B',
    r: 64,
  }))

  const compatibleButUnsupported = await discoverOllamaLoraAdapters(profileOut, 'qwen3:14b')
  assert.equal(compatibleButUnsupported.length, 1)
  assert.equal(compatibleButUnsupported[0].compatibleWithTarget, true)
  assert.equal(compatibleButUnsupported[0].supportedByOllama, false)
  assert.match(compatibleButUnsupported[0].unavailableReason || '', /not supported by Ollama/)

  const mismatched = await discoverOllamaLoraAdapters(profileOut, 'qwen3.5:9b')
  assert.equal(mismatched[0].compatibleWithTarget, false)
  assert.match(mismatched[0].unavailableReason || '', /not qwen3.5:9b/)
} finally {
  fs.rmSync(profileOut, { recursive: true, force: true })
}

console.log('Ollama LoRA packaging checks passed')

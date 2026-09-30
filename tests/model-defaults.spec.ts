import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_OLLAMA_CHAT_MODEL as CORE_OLLAMA_MODEL,
  DEFAULT_TRAINING_MODEL as CORE_TRAINING_MODEL,
  DEFAULT_VLLM_CHAT_MODEL as CORE_VLLM_MODEL,
  DEFAULT_VLLM_TRAINING_MODEL as CORE_VLLM_TRAINING_MODEL,
} from '../packages/core/src/model-defaults.js'
import {
  DEFAULT_OLLAMA_CHAT_MODEL as SITE_OLLAMA_MODEL,
  DEFAULT_TRAINING_MODEL as SITE_TRAINING_MODEL,
  DEFAULT_VLLM_CHAT_MODEL as SITE_VLLM_MODEL,
  DEFAULT_VLLM_TRAINING_MODEL as SITE_VLLM_TRAINING_MODEL,
} from '../apps/site/src/lib/client/model-defaults.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const retiredModelIds = [
  ['qwen3', ':', '14b'].join(''),
  ['Qwen', '/', 'Qwen3', '-', '14B'].join(''),
  ['unsloth', '/', 'Qwen3', '-', '14B'].join(''),
]

function walkFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return []
    if (entry.isDirectory() && ['node_modules', 'dist', 'build'].includes(entry.name)) return []
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return walkFiles(absolutePath)
    return [absolutePath]
  })
}

assert.equal(CORE_OLLAMA_MODEL, 'qwen3.5:9b')
assert.equal(CORE_VLLM_MODEL, 'sanskar003/Qwen3.5-9B-AWQ')
assert.equal(CORE_TRAINING_MODEL, 'unsloth/Qwen3.5-4B')
assert.equal(CORE_VLLM_TRAINING_MODEL, 'Qwen/Qwen3.5-4B')
assert.equal(SITE_OLLAMA_MODEL, CORE_OLLAMA_MODEL)
assert.equal(SITE_VLLM_MODEL, CORE_VLLM_MODEL)
assert.equal(SITE_TRAINING_MODEL, CORE_TRAINING_MODEL)
assert.equal(SITE_VLLM_TRAINING_MODEL, CORE_VLLM_TRAINING_MODEL)

for (const relativeRoot of [
  'etc',
  'packages/core/src',
  'apps/site/src',
  'brain',
  'docker/runpod-trainer',
  'scripts',
  'tests',
  'docs/technical',
  'docs/user-guide',
]) {
  for (const absolutePath of walkFiles(path.join(ROOT, relativeRoot))) {
    const contents = fs.readFileSync(absolutePath, 'utf8')
    for (const retiredId of retiredModelIds) {
      assert.equal(contents.toLowerCase().includes(retiredId.toLowerCase()), false, `${absolutePath} reintroduced a retired model ID`)
    }
  }
}

for (const relativePath of ['etc/models.json']) {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
  assert.equal(Object.hasOwn(registry.globalSettings ?? {}, 'useAdapter'), false, `${relativePath} must not recreate the retired adapter toggle`)
  assert.equal(Object.hasOwn(registry.globalSettings ?? {}, 'activeAdapter'), false, `${relativePath} must not recreate a second model-selection pointer`)
  assert.equal(registry.models?.['ollama.qwen3.5:9b']?.model, CORE_OLLAMA_MODEL)

  for (const modelId of Object.values(registry.defaults) as string[]) {
    const model = registry.models[modelId]
    if (model?.provider === 'ollama') {
      assert.equal(model.model, CORE_OLLAMA_MODEL, `${relativePath}:${modelId} drifted from the default`)
    }
  }
}

for (const relativePath of ['etc/llm-backend.json']) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
  assert.equal(config.ollama.defaultModel, CORE_OLLAMA_MODEL, `${relativePath} Ollama default drifted`)
  assert.equal(config.vllm.model, CORE_VLLM_MODEL, `${relativePath} vLLM default drifted`)
}

const trainingConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/training.json'), 'utf8'))
assert.equal(trainingConfig.base_model, CORE_TRAINING_MODEL)
assert.equal(trainingConfig.load_in_4bit, false)
assert.equal(trainingConfig.load_in_16bit, true)
assert.equal(trainingConfig.lora_dropout, 0)

const trainerDockerfile = fs.readFileSync(path.join(ROOT, 'docker/runpod-trainer/Dockerfile'), 'utf8')
assert.match(trainerDockerfile, /trainer-requirements.txt/)
const requirements = fs.readFileSync(path.join(ROOT, 'docker/runpod-trainer/requirements.txt'), 'utf8')
assert.match(requirements, /^transformers==5\./m)
assert.match(requirements, /^torchvision==/m)
assert.match(requirements, /^pillow==/m)
assert.doesNotMatch(trainerDockerfile, /facebookresearch\/xformers/)

for (const removedPath of [
  'docker/runpod-trainer/train_full_finetune.py',
  'etc/training-local.json',
  'etc/fine-tune-config.json',
  'etc/modes/dual-config.json',
  'etc/modes/emulation-config.json',
  'etc/modes/agent-config.json',
  'scripts/update-models-json.ts',
  'etc/model_map.json',
  'etc/models-qwen-coder-30b-bu.json',
  'etc/agent -quen-coder.json',
  'etc/agent.json.template',
]) {
  assert.equal(fs.existsSync(path.join(ROOT, removedPath)), false, `${removedPath} should remain deleted`)
}

console.log('model default contracts passed')

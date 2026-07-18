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
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return walkFiles(absolutePath)
    return [absolutePath]
  })
}

assert.equal(CORE_OLLAMA_MODEL, 'qwen3.5:9b')
assert.equal(CORE_VLLM_MODEL, 'sanskar003/Qwen3.5-9B-AWQ')
assert.equal(CORE_TRAINING_MODEL, 'unsloth/Qwen3.5-9B')
assert.equal(CORE_VLLM_TRAINING_MODEL, 'Qwen/Qwen3.5-9B')
assert.equal(SITE_OLLAMA_MODEL, CORE_OLLAMA_MODEL)
assert.equal(SITE_VLLM_MODEL, CORE_VLLM_MODEL)
assert.equal(SITE_TRAINING_MODEL, CORE_TRAINING_MODEL)
assert.equal(SITE_VLLM_TRAINING_MODEL, CORE_VLLM_TRAINING_MODEL)

for (const relativeRoot of [
  'etc',
  'packages/core/src',
  'apps/site/src',
  'apps/react-native/nodejs-assets/nodejs-project/etc',
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

const unslothTrainer = fs.readFileSync(path.join(ROOT, 'docker/runpod-trainer/train_unsloth.py'), 'utf8')
assert.match(unslothTrainer, /from unsloth import FastLanguageModel/)
assert.match(unslothTrainer, /"load_in_4bit": False/)
assert.match(unslothTrainer, /"load_in_16bit": True/)
assert.match(unslothTrainer, /"gate_proj", "up_proj", "down_proj"/)

const fullTrainer = fs.readFileSync(path.join(ROOT, 'docker/runpod-trainer/train_full_finetune.py'), 'utf8')
assert.match(fullTrainer, /AutoModelForMultimodalLM/)
assert.match(fullTrainer, /AutoProcessor/)
assert.match(fullTrainer, /transformers>=5/)

for (const relativePath of [
  'etc/models.json',
  'apps/react-native/nodejs-assets/nodejs-project/etc/models.json',
]) {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
  assert.equal(registry.globalSettings?.useAdapter, false, `${relativePath} must not enable a personal adapter`)
  assert.equal(registry.globalSettings?.activeAdapter, null, `${relativePath} must not copy personal adapter state`)
  assert.equal(registry.models?.['ollama.qwen3.5:9b']?.model, CORE_OLLAMA_MODEL)

  for (const modelId of Object.values(registry.defaults) as string[]) {
    const model = registry.models[modelId]
    if (model?.provider === 'ollama') {
      assert.equal(model.model, CORE_OLLAMA_MODEL, `${relativePath}:${modelId} drifted from the default`)
    }
  }
}

for (const relativePath of [
  'etc/llm-backend.json',
  'apps/react-native/nodejs-assets/nodejs-project/etc/llm-backend.json',
]) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
  assert.equal(config.ollama.defaultModel, CORE_OLLAMA_MODEL, `${relativePath} Ollama default drifted`)
  assert.equal(config.vllm.model, CORE_VLLM_MODEL, `${relativePath} vLLM default drifted`)
}

const localTrainingConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/training-local.json'), 'utf8'))
assert.equal(localTrainingConfig.base_model, CORE_TRAINING_MODEL)
assert.equal(localTrainingConfig.load_in_4bit, false)
assert.equal(localTrainingConfig.load_in_16bit, true)
assert.equal(localTrainingConfig.lora_dropout, 0)
for (const relativePath of [
  'etc/training.json',
  'etc/fine-tune-config.json',
  'etc/modes/dual-config.json',
  'etc/modes/emulation-config.json',
  'etc/modes/agent-config.json',
]) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
  assert.equal(config.base_model, CORE_VLLM_TRAINING_MODEL, `${relativePath} training base drifted`)
}

const remoteTrainingConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/training.json'), 'utf8'))
assert.equal(remoteTrainingConfig.load_in_4bit, false)
assert.equal(remoteTrainingConfig.load_in_16bit, true)

const trainerDockerfile = fs.readFileSync(path.join(ROOT, 'docker/runpod-trainer/Dockerfile'), 'utf8')
assert.match(trainerDockerfile, /"transformers>=5"/)
assert.match(trainerDockerfile, /torchvision/)
assert.match(trainerDockerfile, /pillow/)
assert.doesNotMatch(trainerDockerfile, /facebookresearch\/xformers/)

for (const removedPath of [
  'scripts/update-models-json.ts',
  'etc/model_map.json',
  'etc/models-qwen-coder-30b-bu.json',
  'etc/agent -quen-coder.json',
  'etc/agent.json.template',
]) {
  assert.equal(fs.existsSync(path.join(ROOT, removedPath)), false, `${removedPath} should remain deleted`)
}

console.log('model default contracts passed')

import assert from 'node:assert/strict'
import {
  buildVLLMLoraArgs,
  buildVLLMMemoryArgs,
  parseVLLMPreflightOutput,
  calculateVLLMMemoryPlan,
  type VLLMConfig,
} from './vllm.js'
import {
  getVllmLoraModelCompatibilityKey,
  isVllmLoraCompatibleWithModel,
} from './vllm-lora.js'

const automaticPlan = calculateVLLMMemoryPlan({
  freeGB: 14.5,
  usedGB: 1.5,
  totalGB: 16,
  headroomGB: 1.5,
  maxUtilization: 0.95,
})
assert.equal(automaticPlan.utilization, 0.8125)
assert.equal(automaticPlan.allocatedGB, 13)
assert.match(automaticPlan.recommendation, /leave 1\.5 GiB free/)

const cappedPlan = calculateVLLMMemoryPlan({
  freeGB: 16,
  totalGB: 16,
  headroomGB: 0.5,
  maxUtilization: 0.9,
})
assert.equal(cappedPlan.utilization, 0.9)
assert.equal(cappedPlan.allocatedGB, 14.4)

const config: VLLMConfig = {
  endpoint: 'http://localhost:8000',
  model: 'Example/Model',
  gpuMemoryUtilization: 0.9,
  maxModelLen: 'auto',
  kvCacheMemoryGiB: 2.5,
  cpuOffloadGiB: 4,
  kvOffloadingGiB: 8,
  kvOffloadingBackend: 'native',
  loraModules: [
    { name: 'operator-style', path: '/adapters/operator-style' },
    { name: 'robot-domain', path: '/adapters/robot-domain' },
  ],
  maxLoraRank: 128,
  maxLoras: 2,
  maxCpuLoras: 6,
  loraDtype: 'bfloat16',
}

assert.deepEqual(buildVLLMMemoryArgs(config), [
  '--max-model-len', 'auto',
  '--kv-cache-memory-bytes', String(2.5 * 1024 ** 3),
  '--cpu-offload-gb', '4',
  '--kv-offloading-size', '8',
  '--kv-offloading-backend', 'native',
])

assert.deepEqual(buildVLLMLoraArgs(config, 'safetensors'), [
  '--enable-lora',
  '--lora-modules',
  'operator-style=/adapters/operator-style',
  'robot-domain=/adapters/robot-domain',
  '--max-lora-rank', '128',
  '--max-loras', '2',
  '--max-cpu-loras', '6',
  '--lora-dtype', 'bfloat16',
])
assert.deepEqual(buildVLLMLoraArgs(config, 'gguf'), [])

assert.deepEqual(
  parseVLLMPreflightOutput<{ ok: boolean }>(
    'INFO vLLM model registry initialized\n{"ok":true}\n',
  ),
  { ok: true },
)

assert.equal(
  getVllmLoraModelCompatibilityKey('unsloth/qwen3-14b-unsloth-bnb-4bit'),
  'qwen3:14b',
)
assert.equal(
  isVllmLoraCompatibleWithModel(
    'unsloth/qwen3-14b-unsloth-bnb-4bit',
    'Qwen/Qwen3-14B-AWQ',
  ),
  true,
)
assert.equal(
  isVllmLoraCompatibleWithModel(
    'unsloth/qwen3-14b-unsloth-bnb-4bit',
    'Qwen/Qwen3.5-9B',
  ),
  false,
)

console.log('vLLM runtime memory, context, offload, and LoRA checks passed')

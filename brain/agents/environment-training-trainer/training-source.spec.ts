import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { readSelectedTrainingSource } from './cli.js'

test('native comparison follows exact selected final, nested and successive reviewed exports', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'selected-specialist-'))
  try {
    for (const [layout, baseModel] of [
      ['nested/intent-fit/final/adapter-export', 'unsloth/Qwen3.5-0.8B'],
      ['intent/final/merged-gguf', 'unsloth/Qwen3.5-2B'],
      ['review-one/reviewed/merged-gguf', 'unsloth/Qwen3.5-2B'],
      ['review-two/reviewed/merged-gguf', 'unsloth/Qwen3.5-2B'],
    ]) {
      const stage = resolve(root, layout, '..')
      await mkdir(resolve(stage, 'adapter'), { recursive: true })
      for (const [file, value] of Object.entries({
        'run-provenance.json': { baseModel },
        'training-config.json': { base_model: baseModel },
        'adapter/adapter_config.json': { base_model_name_or_path: baseModel },
      })) await writeFile(resolve(stage, file), JSON.stringify(value))
      const selected = { baseModel, adapters: [resolve(root, layout, 'adapter-gguf/adapter.F16.gguf')] }
      assert.deepEqual(await readSelectedTrainingSource(selected), { baseModel, adapter: resolve(stage, 'adapter') })
      await assert.rejects(readSelectedTrainingSource({ ...selected, baseModel: 'wrong-base' }), /provenance disagree/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

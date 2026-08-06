import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  discoverEnvironmentClassifierArtifacts,
  environmentClassifierRegistryDefinition,
} from './environment-classifier-runtime.js'

function writeFixture(root: string, options: { heldOutUsed?: boolean } = {}): string {
  const runId = 'qwen3.5-0.8b-cv-test'
  const runPath = path.join(root, runId)
  const adapterPath = path.join(runPath, 'fold-2', 'adapter', 'checkpoint-513')
  fs.mkdirSync(adapterPath, { recursive: true })
  fs.writeFileSync(path.join(adapterPath, 'adapter_config.json'), JSON.stringify({
    base_model_name_or_path: 'unsloth/Qwen3.5-0.8B',
    r: 16,
  }))
  fs.writeFileSync(path.join(adapterPath, 'adapter_model.safetensors'), 'weights')
  fs.writeFileSync(path.join(adapterPath, 'tokenizer.json'), '{}')
  fs.writeFileSync(path.join(adapterPath, 'chat_template.jinja'), '{{ messages }}')
  fs.writeFileSync(path.join(runPath, 'development-validation-checkpoint-513.json'), JSON.stringify({
    owner: 'environment-classifier',
    heldOutUsed: options.heldOutUsed ?? false,
    model: 'unsloth/Qwen3.5-0.8B:fold-2:checkpoint-513',
    folds: [{
      fold: 2,
      summary: {
        caseCount: 100,
        jsonValid: { count: 100, rate: 1 },
        contractValid: { count: 99, rate: 0.99 },
        exactRoute: { count: 89, rate: 0.89 },
        unsafeActionErrors: 0,
        unnecessaryVisionAdmissions: 0,
        missedActions: 3,
        latencyMs: { wallMedian: 420 },
      },
    }],
  }))
  return runId
}

test('discovers only scored, held-out-clean Environment Classifier checkpoints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-classifier-discovery-'))
  try {
    const runId = writeFixture(root)
    const artifacts = discoverEnvironmentClassifierArtifacts(root)
    assert.equal(artifacts.length, 1)
    assert.equal(artifacts[0].runId, runId)
    assert.equal(artifacts[0].fold, 2)
    assert.equal(artifacts[0].checkpoint, 513)
    assert.equal(artifacts[0].quality.exactRouteRate, 0.89)

    const definition = environmentClassifierRegistryDefinition(artifacts[0])
    assert.equal(definition.provider, 'vllm')
    assert.deepEqual(definition.roles, ['environmentRouter'])
    assert.equal(definition.metadata.purpose, 'environment-router')
    assert.equal(definition.metadata.adapterPath, artifacts[0].relativeAdapterPath)
    assert.equal(definition.options.contextWindow, 2048)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('does not expose a checkpoint whose report used locked held-out cases', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-classifier-held-out-'))
  try {
    writeFixture(root, { heldOutUsed: true })
    assert.deepEqual(discoverEnvironmentClassifierArtifacts(root), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('discovers each scored checkpoint from an aggregate fold report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-classifier-aggregate-'))
  try {
    const runId = writeFixture(root)
    const runPath = path.join(root, runId)
    fs.cpSync(
      path.join(runPath, 'fold-2', 'adapter', 'checkpoint-513'),
      path.join(runPath, 'fold-1', 'adapter', 'checkpoint-510'),
      { recursive: true },
    )
    fs.writeFileSync(path.join(runPath, 'development-validation-final-epoch.json'), JSON.stringify({
      owner: 'environment-classifier',
      heldOutUsed: false,
      model: 'unsloth/Qwen3.5-0.8B:four-fold:final-epoch',
      folds: [
        {
          fold: 1,
          summary: {
            model: 'unsloth/Qwen3.5-0.8B:fold-1:checkpoint-510',
            caseCount: 80,
            jsonValid: { count: 80, rate: 1 },
            contractValid: { count: 80, rate: 1 },
            exactRoute: { count: 60, rate: 0.75 },
            unsafeActionErrors: 1,
            unnecessaryVisionAdmissions: 0,
            missedActions: 4,
          },
        },
        {
          fold: 2,
          summary: {
            model: 'unsloth/Qwen3.5-0.8B:fold-2:checkpoint-513',
            caseCount: 100,
            jsonValid: { count: 100, rate: 1 },
            contractValid: { count: 99, rate: 0.99 },
            exactRoute: { count: 89, rate: 0.89 },
            unsafeActionErrors: 0,
            unnecessaryVisionAdmissions: 0,
            missedActions: 3,
          },
        },
      ],
    }))

    const artifacts = discoverEnvironmentClassifierArtifacts(root)
    assert.deepEqual(
      artifacts.map(artifact => [artifact.fold, artifact.checkpoint]),
      [[2, 513], [1, 510]],
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
